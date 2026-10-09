import 'server-only';
import { eq } from 'drizzle-orm';
import { CHANNELS, channelConfigured, type ChannelDef } from './channels';
import { draftProduct, publishProduct, searchProducts } from './connectors/shopify';
import { cannotDraft, cannotPublish, OOS_TAG, type RuleMode } from './domain/stock-rule';
import { getDb, schema } from './db';
import { publish } from './bus';

/**
 * Sold out comes off the shop; back in stock goes back on.
 *
 * A product with nothing left is worse than no product at all: it takes a place in the grid, it
 * takes a click, and it ends in a page that cannot be bought from. So when a product's stock reaches
 * zero the rule drafts it, and when stock arrives again it publishes it.
 *
 * Three things keep it from doing harm, and all three matter:
 *
 *   It only publishes what it drafted. Every product it takes down is tagged `relay:oos`, and
 *   nothing without that tag is ever put live — otherwise the first delivery of the season would
 *   publish every unreleased product, every half-finished draft and every line that was pulled on
 *   purpose.
 *
 *   It leaves alone what it cannot judge. A product whose inventory is not tracked reads as zero in
 *   Shopify whether there are none or a thousand, and a product set to keep selling at zero is
 *   meant to be bought at zero. Neither is touched.
 *
 *   It does nothing at all unless it is switched on. `RELAY_STOCK_RULE` is `off` by default; `dry`
 *   reports what it would do and changes nothing; `on` is the only setting that writes.
 */

export type { RuleMode } from './domain/stock-rule';

export const ruleMode = (): RuleMode => {
  const v = (process.env.RELAY_STOCK_RULE ?? 'off').trim().toLowerCase();
  return v === 'on' || v === 'dry' ? v : 'off';
};

export type RuleAction = { id: string; title: string; did: 'drafted' | 'published' };
export type ChannelResult = {
  channelId: string;
  ok: boolean;
  note: string;
  drafted: RuleAction[];
  published: RuleAction[];
  /** Looked at but deliberately left alone, with the reason: for the report, and for trust. */
  skipped: { title: string; why: string }[];
};

/** Shopify's own product search does the narrowing, so the sweep reads candidates and not a catalogue. */
const SOLD_OUT = 'status:active AND inventory_total:<=0';
const BACK_IN = `status:draft AND tag:'${OOS_TAG}' AND inventory_total:>0`;

async function sweepChannel(c: ChannelDef, mode: RuleMode): Promise<ChannelResult> {
  const out: ChannelResult = { channelId: c.id, ok: true, note: '', drafted: [], published: [], skipped: [] };
  try {
    for await (const page of searchProducts(c, SOLD_OUT)) {
      for (const p of page) {
        const why = cannotDraft(p);
        if (why) {
          out.skipped.push({ title: p.title, why });
          continue;
        }
        if (mode === 'on') await draftProduct(c, p.id);
        out.drafted.push({ id: p.id, title: p.title, did: 'drafted' });
      }
    }
    for await (const page of searchProducts(c, BACK_IN)) {
      for (const p of page) {
        const why = cannotPublish(p);
        if (why) {
          out.skipped.push({ title: p.title, why });
          continue;
        }
        if (mode === 'on') await publishProduct(c, p.id);
        out.published.push({ id: p.id, title: p.title, did: 'published' });
      }
    }
    const verb = mode === 'dry' ? 'would be' : '';
    out.note = `${out.drafted.length} ${verb} drafted · ${out.published.length} ${verb} published`.replace(/\s+/g, ' ').trim();
  } catch (e) {
    out.ok = false;
    out.note = e instanceof Error ? e.message.slice(0, 300) : 'The rule could not finish';
  }
  return out;
}

/**
 * Runs the rule over every connected Shopify storefront.
 *
 * The two mobile apps are left out: their catalogue is Medusa's, and Relay has no admin credential
 * for either of them. The same rule belongs there the day it does.
 */
export async function runStockRule(opts: { mode?: RuleMode; channelId?: string } = {}) {
  const mode = opts.mode ?? ruleMode();
  if (mode === 'off') return { mode, ran: false as const, channels: [] as ChannelResult[] };

  const targets = CHANNELS.filter(
    (c) => c.platform === 'shopify' && channelConfigured(c) && (!opts.channelId || c.id === opts.channelId),
  );

  const channels: ChannelResult[] = [];
  for (const c of targets) channels.push(await sweepChannel(c, mode));

  const drafted = channels.reduce((n, c) => n + c.drafted.length, 0);
  const published = channels.reduce((n, c) => n + c.published.length, 0);
  const at = new Date();

  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key: 'stock_rule.last_run', value: { at: at.toISOString(), mode, drafted, published, channels } })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: { at: at.toISOString(), mode, drafted, published, channels }, updatedAt: at },
    });

  if (drafted || published) {
    const what = `${drafted} sold out, ${published} back in stock`;
    publish({ kind: 'sync', message: mode === 'dry' ? `Stock rule (dry run): ${what}` : `Stock rule: ${what}` });
  }

  return { mode, ran: true as const, drafted, published, channels };
}

export type StockRuleRun = {
  at: string;
  mode: RuleMode;
  drafted: number;
  published: number;
  channels: ChannelResult[];
};

/** What the Rules page shows: the last sweep, however it ended. */
export async function lastStockRuleRun(): Promise<StockRuleRun | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'stock_rule.last_run'));
  return (row?.value as StockRuleRun) ?? null;
}
