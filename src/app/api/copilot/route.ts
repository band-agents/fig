import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { AREA_LABEL, AREAS, LEVEL_LABEL, ROLES } from '@/lib/domain/perms';
import { channelLabel } from '@/lib/channels';
import { runTool, TOOLS, type Found } from '@/lib/copilot/tools';
import { stageCounts } from '@/lib/queries';
import { insightsFor } from '@/lib/insights';
import { ORDER_STAGE, type OrderStage } from '@/lib/domain/stages';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = 'claude-opus-5-5';

// Stable across every request, so it caches. Who is asking and when goes in a second block after it.
const SYSTEM = `You are Ask Relay, the assistant inside Relay: the order-fulfilment and returns console FIG's teams use across its storefronts (FIG website and app, Women'secret Egypt and Kuwait, Labesny website and app). FIG ships from a warehouse in New Cairo; Labesny and Women'secret Kuwait ship from the D&H warehouse in Kuwait. Aramex is the courier.

Every order moves through stages, each owned by a department: New → Confirming (Customer care calls cash customers) → Finance check → Ready to pick → Picking → Packed (Fulfilment) → Shipped → Out for delivery (Shipping) → Delivered (cash with the courier) → Settled (Finance reconciles the courier's remittance). Off the main track: Cancelled, Returning to origin (refused at the door), RTO closed. Returns: Requested → Approved → Pickup booked → In transit → Received → Inspected → Refund pending → Refunded (or Closed for exchanges, Rejected). Each stage has a target time; an order past it is "late". Holds pause the clock. Autopilot clears hand-offs that need no judgement (paid online orders skip the call, trusted cash customers skip it, low-risk cash orders inside a value limit clear finance) and every step it takes is on the timeline. Each order has a delivery-risk score (0–100) with named reasons, learned from this floor's own refusals and returns.

How to answer:
- Use the tools for every fact. Never invent order numbers, names, counts or money. If the tools don't show something, say so.
- Lead with the answer in one or two sentences, then the specifics. Short bullet lists are fine; no headings, no tables wider than four columns.
- Write order numbers exactly as the tools return them (e.g. FIG-24518) so they become links.
- Say what to do next and who should do it when it's useful ("Finance has 6 waiting; the oldest is 5h late").
- Respect access: if a value comes back masked or missing, it's hidden for this person on purpose. Don't speculate about it.
- Plain English, warm and direct, as a sharp operations colleague would speak. Times are Cairo time.`;

const body = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).min(1).max(30) });

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'You are signed out.' }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Bad request.' }, { status: 400 });
  const history = parsed.data.messages;

  if (!process.env.ANTHROPIC_API_KEY) return Response.json(await offline(user));

  const access = AREAS.map((a) => `${AREA_LABEL[a]}: ${LEVEL_LABEL[a][user.scopes[a] ?? 0]}`).join('; ');
  const who = `Asking: ${user.name}, ${ROLES[user.role]?.label ?? user.role}${user.title ? ` (${user.title})` : ''}. Access: ${access}. Stores: ${user.channels.length ? user.channels.map(channelLabel).join(', ') : 'all'}. Now: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date())} Cairo.`;

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.text }));
  const found: Found[] = [];
  const used: string[] = [];

  try {
    for (let turn = 0; turn < 8; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: who },
        ],
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'refusal') return Response.json({ text: 'I can’t help with that one. Try asking about orders, stages, returns or cash.' });
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !calls.length) {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return Response.json({ text: text || 'I couldn’t put an answer together. Try rephrasing.', links: linksFor(text, found), tools: [...new Set(used)].map(pretty) });
      }
      messages.push({ role: 'assistant', content: response.content });
      const results = await Promise.all(
        calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          used.push(c.name);
          try {
            const out = await runTool(user, c.name, c.input, found);
            return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 60_000) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: c.id, content: e instanceof Error ? e.message : 'Tool failed', is_error: true };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
    }
    return Response.json({ text: 'That took more digging than I’m allowed in one go. Try a narrower question.', links: linksFor('', found) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return Response.json({ text: 'The Claude API key on the server was rejected. An admin needs to update ANTHROPIC_API_KEY.' });
    if (e instanceof Anthropic.RateLimitError) return Response.json({ text: 'Too many questions at once. Give it a few seconds and ask again.' });
    if (e instanceof Anthropic.APIError) return Response.json({ text: `Claude is unavailable right now (${e.status}). The dashboards still work.` });
    console.error('[relay] copilot failed', e);
    return Response.json({ text: 'Something went wrong while I was reading the floor.' });
  }
}

const pretty = (n: string) => n.replace(/_/g, ' ');

function linksFor(text: string, found: Found[]) {
  const seen = new Set<string>();
  return found
    .filter((f) => (text ? text.includes(f.number) : true))
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .slice(0, 12)
    .map((f) => ({ href: f.kind === 'return' ? `/returns/${f.id}` : `/orders/${f.id}`, label: f.number }));
}

/** Without a Claude key, still answer something useful: today's findings and where the work sits. */
async function offline(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const [stages, insights] = await Promise.all([stageCounts(user), insightsFor(user)]);
  const late = stages.filter((s) => s.late > 0).sort((a, b) => b.late - a.late);
  const lines = [
    'Ask Relay needs a Claude API key on the server (ANTHROPIC_API_KEY) to answer free-form questions. Here’s what I can tell you without it:',
    '',
    ...insights.slice(0, 4).map((i) => `• ${i.title}. ${i.body}`),
    late.length ? `• Late right now: ${late.map((s) => `${s.late} in ${ORDER_STAGE[s.stage as OrderStage]?.label.toLowerCase()}`).join(', ')}.` : '• Nothing is late right now.',
  ];
  return { text: lines.join('\n'), tools: ['floor snapshot'] };
}
