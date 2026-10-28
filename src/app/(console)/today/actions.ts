'use server';

import { refresh } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { currentUser } from '@/lib/auth/session';
import { getDb, schema } from '@/lib/db';
import { RelayError } from '@/lib/errors';

export type Result = { ok: true } | { ok: false; error: string };

/** Marks one of Today's items done for a week, for this person only. Previewing someone else changes nothing. */
export async function todayDoneAction(key: string, done: boolean): Promise<Result> {
  try {
    const me = await currentUser();
    if (!me) throw new RelayError('forbidden', 'You are signed out.');
    if (me.previewing) throw new RelayError('forbidden', 'You are viewing as someone else.');
    const k = `today:${String(key).slice(0, 300)}`;
    const db = await getDb();
    await db.delete(schema.dismissals).where(and(eq(schema.dismissals.userId, me.id), eq(schema.dismissals.key, k)));
    if (done) await db.insert(schema.dismissals).values({ userId: me.id, key: k });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}
