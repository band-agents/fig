import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { basicReply } from '@/lib/concierge/basic';
import { conciergeChannel, storeKnowledge } from '@/lib/concierge/catalog';
import { verifyCustomer, type Identity } from '@/lib/concierge/orders';
import { houseFor, persona, visitContext } from '@/lib/concierge/persona';
import { runTool, TOOLS, type UiEvent } from '@/lib/concierge/tools';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = 'claude-opus-5-5';

/**
 * The shopping concierge on the storefront. Public, like the returns portal: no session.
 *
 * The browser sends the conversation so far as plain text (plus the handles of any products it was
 * shown), and gets back a stream of server-sent events: the advisor's words as they are written,
 * and the cards, choices and WhatsApp hand-off as the advisor puts them on screen.
 *
 * Every fact the advisor gives comes from a tool call made in this request. Nothing the browser
 * sends is trusted beyond being the shopper's own words — except a signed-in customer's identity,
 * and only once its signature from the storefront checks out.
 *
 * Without a Claude key (or when Claude fails) the basic mode in `basic.ts` answers instead.
 */

const Body = z.object({
  store: z.string().max(40).optional(),
  page: z
    .object({ url: z.string().max(500).optional(), title: z.string().max(200).optional(), productHandle: z.string().max(200).optional() })
    .nullish(),
  /** A customer signed in on the storefront, as the theme signed them. Checked before it is believed. */
  customer: z.object({ email: z.string().max(200), id: z.union([z.string().max(40), z.number()]), sig: z.string().max(128) }).nullish(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(2000),
        /** Handles of the product cards this assistant turn showed, so "the second one" still means something. */
        shown: z.array(z.string().max(200)).max(12).optional(),
      }),
    )
    .min(1)
    .max(60),
});

type Event = { t: 'text'; d: string } | { t: 'status'; d: string } | { t: 'done' } | { t: 'error'; d: string } | UiEvent;

const STATUS: Record<string, string> = {
  search_products: 'Looking through the collection…',
  get_product: 'Checking the details…',
  find_pairings: 'Finding what goes with it…',
  get_order: 'Checking your order…',
  my_orders: 'Looking up your orders…',
  my_profile: 'Looking up your account…',
};

export async function POST(req: Request) {
  const limit = await rateLimit(req, 'concierge', { max: 40, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: 'too_many', message: 'You have sent a lot of messages in a short time. Give it a few minutes, or reach us on WhatsApp.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });

  const channel = conciergeChannel(parsed.data.store);
  const house = houseFor(channel.brand);
  const who = verifyCustomer(parsed.data.customer);
  /* The conversation must open with the shopper and alternate; anything else is not from our widget. */
  const history = parsed.data.messages.slice(-24);
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') return Response.json({ error: 'bad_request' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await converse({ channel, house, who, history, page: parsed.data.page ?? null, send, signal: req.signal });
      } catch (e) {
        console.error('[relay] concierge failed', e);
        /* Claude could not answer; the basic mode still can, so the shopper is not left with nothing. */
        try {
          await basicReply({ text: history[history.length - 1].text, channel, house, who, send });
        } catch {
          send({ t: 'error', d: 'I’m sorry — something interrupted me. Could you ask that again?' });
        }
      } finally {
        send({ t: 'done' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
}

type Ctx = {
  channel: ReturnType<typeof conciergeChannel>;
  house: ReturnType<typeof houseFor>;
  who: Identity | null;
  history: z.infer<typeof Body>['messages'];
  page: z.infer<typeof Body>['page'];
  send: (e: Event) => void;
  signal: AbortSignal;
};

async function converse({ channel, house, who, history, page, send, signal }: Ctx) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    /* No Claude: the basic mode answers the common questions and shows pieces from the store. */
    await basicReply({ text: history[history.length - 1].text, channel, house, who, send });
    return;
  }

  const knowledge = await storeKnowledge(channel);
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.role === 'assistant' && m.shown?.length ? `${m.text}\n\n[Product cards shown: ${m.shown.join(', ')}]` : m.text,
  }));

  for (let turn = 0; turn < 8; turn++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        /* A conversation, not a research task: low effort keeps replies quick and short. */
        output_config: { effort: 'low' },
        system: [
          { type: 'text', text: persona(house) },
          /* The store's own words, fixed for fifteen minutes at a time, so this prefix caches. */
          { type: 'text', text: `# Store information (from the live website)\n\n${knowledge.text}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: visitContext(house, page ?? null, who) },
        ],
        tools: TOOLS,
        messages,
      },
      { signal },
    );
    stream.on('text', (d) => send({ t: 'text', d }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (e) {
      /* A tool input that could not be parsed at all: try the turn once more. API errors go up. */
      if (e instanceof Anthropic.APIError || signal.aborted || turn > 0) throw e;
      continue;
    }

    if (message.stop_reason === 'refusal') {
      send({ t: 'text', d: 'I’m afraid I can’t help with that here. Is there something from the collection I can help you find?' });
      return;
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!calls.length) return;
    if (message.stop_reason === 'max_tokens') throw new Error('The reply ran too long.');

    messages.push({ role: 'assistant', content: message.content });
    const status = calls.map((c) => STATUS[c.name]).find(Boolean);
    if (status) send({ t: 'status', d: status });

    const results = await Promise.all(
      calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const out = await runTool(c.name, c.input, { channel, house, who, emit: send });
          return { type: 'tool_result', tool_use_id: c.id, content: out.content.slice(0, 40_000), is_error: out.isError };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: c.id, content: e instanceof Error ? e.message : 'The store did not answer.', is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: results });
  }
  send({ t: 'text', d: 'That took me longer than it should. Could you tell me a little more about what you are looking for?' });
}

