'use server';

import { refresh } from 'next/cache';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { marketsFor } from '@/lib/stock/views/common';
import { poCandidates, type PoCandidate } from '@/lib/stock/views/purchasing';
import { assertCanAct, currentUser } from '@/lib/auth/session';
import { RelayError } from '@/lib/errors';
import { can } from '@/lib/domain/perms';
import type { PoStatus, TransferStatus } from '@/lib/domain/stock/flows';
import type { TaskKind } from '@/lib/domain/stock/work';
import type { Country, Platform } from '@/lib/channels';
import type { StockRules } from '@/lib/stock/core';
import * as ops from '@/lib/stock/ops';
import { runPlanner } from '@/lib/stock/planner';

export type Result = { ok: true; message?: string; href?: string } | { ok: false; error: string };

async function run(fn: (me: NonNullable<Awaited<ReturnType<typeof currentUser>>>) => Promise<string | { message: string; href?: string } | void>): Promise<Result> {
  try {
    const me = await currentUser();
    if (!me) throw new RelayError('forbidden', 'You are signed out.');
    assertCanAct(me);
    const out = await fn(me);
    refresh();
    if (out && typeof out === 'object') return { ok: true, ...out };
    return { ok: true, message: out ?? undefined };
  } catch (e) {
    if (e instanceof RelayError) return { ok: false, error: e.message };
    console.error('[stock] action failed', e);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

export const acceptRecAction = async (id: string, opts: Parameters<typeof ops.acceptRecommendation>[2] = {}) => run((me) => ops.acceptRecommendation(me, id, opts));
export const dismissRecAction = async (id: string, reason: string) => run((me) => ops.dismissRecommendation(me, id, reason));
export const acceptManyAction = async (ids: string[]) =>
  run(async (me) => {
    let n = 0;
    for (const id of ids) {
      await ops.acceptRecommendation(me, id);
      n++;
    }
    return `${n} accepted`;
  });

export const runPlannerAction = async () =>
  run(async (me) => {
    if (!can(me, 'stock', 2) && !can(me, 'procurement', 2)) throw new RelayError('forbidden', 'Running the planner needs stock or buying access.');
    const r = await runPlanner();
    return `The planner read the range in ${(r.ms / 1000).toFixed(1)}s: ${r.recs} proposals${r.tasks ? `, ${r.tasks} new tasks` : ''}`;
  });

export const createPoAction = async (supplierId: string, market: string) =>
  run(async (me) => {
    const po = await ops.createPo(me, { supplierId, market });
    return { message: `${po.number} started`, href: `/stock/purchasing/${po.id}` };
  });
export const addPoLinesAction = async (poId: string, productId: string, qty: number) => run((me) => ops.addPoLines(me, poId, productId, qty));
export const setPoLineAction = async (lineId: string, qty: number) => run((me) => ops.setPoLine(me, lineId, qty));
export const movePoAction = async (poId: string, to: PoStatus, note?: string) => run((me) => ops.movePo(me, poId, to, note));
export const receivePoAction = async (poId: string, lines: { lineId: string; good: number; damaged: number }[]) => run((me) => ops.receivePo(me, poId, lines));

export const moveTransferAction = async (id: string, to: TransferStatus) => run((me) => ops.moveTransfer(me, id, to));

export const startTaskAction = async (id: string) => run((me) => ops.startTask(me, id));
export const finishTaskAction = async (id: string, note?: string) => run((me) => ops.finishTask(me, id, note));
export const blockTaskAction = async (id: string, reason: string) => run((me) => ops.blockTask(me, id, reason));
export const assignTaskAction = async (id: string, userId: string | null) => run((me) => ops.assignTask(me, id, userId));
export const addTaskAction = async (i: { kind: TaskKind; title: string; detail?: string; locationId?: string | null; units?: number; dueAt?: string | null; priority?: number; assigneeId?: string | null }) =>
  run(async (me) => {
    const t = await ops.addTask(me, { ...i, dueAt: i.dueAt ? new Date(i.dueAt) : null });
    return `${t.number} added`;
  });
export const rebalanceAction = async (area: 'warehouse' | 'procurement' | 'merch') => run((me) => ops.rebalanceWork(me, area));

export const adjustStockAction = async (i: { variantId: string; locationId: string; delta: number; reason: string }) => run((me) => ops.adjustStock(me, i));

export const setPlacementAction = async (id: string, to: 'live' | 'paused' | 'ended') => run((me) => ops.setPlacement(me, id, to));
export const editPlacementAction = async (id: string, i: { headline?: string; headlineAr?: string; offer?: string | null; channels?: string[] }) => run((me) => ops.editPlacement(me, id, i));

export const saveStockRulesAction = async (rules: StockRules) => run((me) => ops.saveStockRules(me, rules));
export const addLocationAction = async (i: Parameters<typeof ops.addLocation>[1]) => run((me) => ops.addLocation(me, i));
export const addSupplierAction = async (i: Parameters<typeof ops.addSupplier>[1]) => run((me) => ops.addSupplier(me, i));
export const addStorefrontAction = async (i: { name: string; brand: string; surface: 'Website' | 'App'; platform: Platform; country: Country; company: 'DH' | 'DCO' | 'FIG'; domain?: string; store?: string; baseUrl?: string; warehouse: string }) => run((me) => ops.addStorefront(me, i));

export type CodeLookup = { title: string; brand: string; image: string | null; market: string; size: string | null; sku: string; barcode: string | null; stock: { location: string; onHand: number; bin: string | null }[] };

/**
 * What a scanned barcode or typed SKU is, from the catalogue: the style, the size, and where its
 * pieces are. Read-only (works while viewing as a job), limited to the markets the person covers.
 */
export async function lookupCodeAction(code: string): Promise<CodeLookup[]> {
  const me = await currentUser();
  const c = code.trim();
  if (!me || !c || c.length > 64 || !(can(me, 'stock', 1) || can(me, 'fulfilment', 1) || can(me, 'warehouse', 1) || can(me, 'returns', 1))) return [];
  const markets = marketsFor(me);
  const db = await getDb();
  const rows = await db.execute<{ title: string; brand: string; image: string | null; market: string; size: string | null; sku: string; barcode: string | null; stock: unknown }>(sql`
    select p.title, p.brand, p.image, p.market, v.size, v.sku, v.barcode,
      coalesce(json_agg(json_build_object('location', l.name, 'onHand', s.on_hand, 'bin', s.bin) order by s.on_hand desc) filter (where s.variant_id is not null), '[]') as stock
    from variants v
    join products p on p.id = v.product_id
    left join stock_levels s on s.variant_id = v.id
    left join locations l on l.id = s.location_id
    where (v.barcode = ${c} or lower(v.sku) = lower(${c})) and p.market in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)})
    group by p.id, v.id
    limit 6`);
  return rows.rows.map((r) => ({ ...r, stock: (typeof r.stock === 'string' ? JSON.parse(r.stock) : r.stock) as CodeLookup['stock'] }));
}

/** Styles to add to a draft purchase order (a search, or the supplier's best sellers). Read-only. */
export async function poCandidatesAction(poId: string, q: string): Promise<PoCandidate[]> {
  const me = await currentUser();
  if (!me || !can(me, 'procurement', 1)) return [];
  return poCandidates(me, poId, q);
}
