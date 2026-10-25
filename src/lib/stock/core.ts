import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { getSetting } from '../engine';
import { PO_DEFAULTS } from '../domain/stock/flows';
import { inEgp } from '../format';
import { publish } from '../bus';

/** How much the AI may do on its own. Changed on the Rules page by someone with stock 3. */
export type StockRules = {
  /** suggest: proposals only · draft: also writes draft POs and transfers · auto: also submits them */
  autonomy: 'suggest' | 'draft' | 'auto';
  approvalLimit: number; // EGP-equivalent minor units
  reviewWeeks: number;
  chaseAfterDays: number;
  autoAssign: boolean; // hand new tasks to the right person
  autoTasks: boolean; // raise receiving, chasing and counting tasks without being asked
  countEveryDays: { A: number; B: number; C: number };
};

export const DEFAULT_STOCK_RULES: StockRules = {
  autonomy: 'suggest',
  approvalLimit: PO_DEFAULTS.approvalLimit,
  reviewWeeks: PO_DEFAULTS.reviewWeeks,
  chaseAfterDays: PO_DEFAULTS.chaseAfterDays,
  autoAssign: true,
  autoTasks: true,
  countEveryDays: { A: 30, B: 90, C: 180 },
};

export const stockRules = () => getSetting<StockRules>('stock.rules', DEFAULT_STOCK_RULES);

export type Who = { id: string | null; name: string };
export const PLANNER: Who = { id: null, name: 'AI planner' };

/** The manager's record: every stock, buying, warehouse and website action, by whom. */
export async function logActivity(who: Who, a: { area: string; kind: string; message: string; refType?: string; refId?: string; data?: Record<string, unknown>; at?: Date }) {
  const db = await getDb();
  await db.insert(schema.activity).values({ at: a.at ?? new Date(), actorId: who.id, actorName: who.name, area: a.area, kind: a.kind, refType: a.refType ?? null, refId: a.refId ?? null, message: a.message, data: a.data ?? null });
}

/** "PO-26-0142", "TR-0091", "T-1042", "WP-031": the next number in a series. */
export async function nextNumber(kind: 'po' | 'transfer' | 'task' | 'placement', at = new Date()) {
  const db = await getDb();
  const yy = String(at.getUTCFullYear()).slice(2);
  const spec = {
    po: { table: 'purchase_orders', prefix: `PO-${yy}-`, pad: 4 },
    transfer: { table: 'transfers', prefix: 'TR-', pad: 4 },
    task: { table: 'tasks', prefix: 'T-', pad: 4 },
    placement: { table: 'placements', prefix: 'WP-', pad: 3 },
  }[kind];
  const r = await db.execute<{ n: number }>(sql`select coalesce(max(substring(number from ${spec.prefix.length + 1}::int)::int), 0)::int as n from ${sql.raw(spec.table)} where number like ${spec.prefix + '%'}`);
  return `${spec.prefix}${String((r.rows[0]?.n ?? 0) + 1).padStart(spec.pad, '0')}`;
}

/** Minor units of any currency, as EGP-equivalent minor units, for totals across markets. */
export const egpMinor = (minor: number, currency: string) => Math.round(inEgp(minor, currency) * 100);

export function stockChanged(message: string) {
  publish({ kind: 'stock', message });
}

export { schema };
