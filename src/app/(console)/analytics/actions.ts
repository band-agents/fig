'use server';

import { refresh } from 'next/cache';
import { currentUser } from '@/lib/auth/session';
import { can } from '@/lib/domain/perms';
import { RelayError } from '@/lib/errors';
import { branchReadCost, readAllBranches } from '@/lib/branch-stock';
import { marketsFor } from '@/lib/stock/views/common';
import type { Market } from '@/lib/domain/stock/calendar';

/** Stock by branch → "Read every branch": one full Lucida reading now, if this hour's call budget has room. */
export async function readBranchesAction() {
  try {
    const u = await currentUser();
    if (!u) throw new RelayError('forbidden', 'You are signed out.');
    if (!(u.role === 'admin' || can(u, 'stock', 2) || can(u, 'overview', 1))) throw new RelayError('forbidden', 'Reading Lucida needs Stock or floor access.');
    const markets = marketsFor(u) as Market[];
    const cost = await branchReadCost(markets);
    if (!cost.budget) throw new RelayError('invalid', 'Lucida is not connected: its logins go in LUCIDA_ACCOUNTS.');
    if (!cost.possible) throw new RelayError('invalid', `A full reading takes ${cost.calls} Lucida calls and ${cost.budget.left} of this hour's ${cost.budget.limit} are left. It also runs every night.`);
    const run = await readAllBranches(markets);
    if (!run.ok) throw new RelayError('invalid', run.note ?? 'Lucida did not answer.');
    refresh();
    return { ok: true as const, message: `${run.rows.toLocaleString('en')} lines from ${run.stores} branches, ${run.calls} Lucida calls` };
  } catch (e) {
    return { ok: false as const, error: e instanceof RelayError ? e.message : 'Lucida could not be read. Try again later.' };
  }
}
