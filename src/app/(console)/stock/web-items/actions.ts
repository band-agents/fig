'use server';

import { refresh } from 'next/cache';
import { assertCanAct, currentUser } from '@/lib/auth/session';
import { RelayError } from '@/lib/errors';
import { can, canSee } from '@/lib/domain/perms';
import { startRun } from '@/lib/web-items';

export type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Reads the store's whole catalogue again, or asks Lucida about it. Runs in the background. */
export async function runWebItemsAction(store: string, what: 'website' | 'lucida', days = 0): Promise<Result> {
  try {
    const me = await currentUser();
    if (!me) throw new RelayError('forbidden', 'You are signed out.');
    assertCanAct(me);
    if (!canSee(me, 'webItems') || !(can(me, 'merch', 2) || can(me, 'stock', 2) || can(me, 'procurement', 3))) throw new RelayError('forbidden', 'Refreshing the comparison needs Merchandising or Stock access.');
    if (me.channels.length && !me.channels.includes(store)) throw new RelayError('forbidden', 'That store is outside your stores.');
    startRun(store, what, me.name, { days: Math.min(30, Math.max(0, Math.trunc(days))) });
    refresh();
    return { ok: true, message: what === 'website' ? 'Reading the website: a minute or two' : 'Asking Lucida: a minute or two' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}
