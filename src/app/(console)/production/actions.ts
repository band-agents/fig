'use server';

import { refresh } from 'next/cache';
import { assertCanAct, currentUser } from '@/lib/auth/session';
import { RelayError } from '@/lib/errors';
import * as prod from '@/lib/production';
import type { StepKey } from '@/lib/domain/production';

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
    console.error('[relay] production action failed', e);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

export async function createProductionAction(input: prod.NewProduction) {
  return run(async (me) => {
    const r = await prod.createProduction(me, input);
    return { message: `${r.number} placed`, href: `/production/${r.id}` };
  });
}

export async function stepAction(id: string, key: StepKey, change: { done?: string | null; planned?: string | null; note?: string | null }) {
  return run(async (me) => {
    await prod.updateStep(me, id, key, change);
  });
}

export async function inspectionAction(id: string, input: Parameters<typeof prod.addInspection>[2]) {
  return run(async (me) => {
    await prod.addInspection(me, id, input);
    return 'Inspection recorded';
  });
}

export async function paymentAction(id: string, input: Parameters<typeof prod.addPayment>[2]) {
  return run(async (me) => {
    await prod.addPayment(me, id, input);
    return 'Payment added';
  });
}

export async function paidAction(id: string, paymentId: string, paidAt: string | null, ref?: string) {
  return run(async (me) => {
    await prod.markPaid(me, id, paymentId, paidAt, ref);
    return paidAt ? 'Marked paid' : 'Marked unpaid';
  });
}

export async function updateProductionAction(id: string, input: Parameters<typeof prod.updateProduction>[2]) {
  return run(async (me) => {
    await prod.updateProduction(me, id, input);
    return 'Saved';
  });
}

export async function saveMakerAction(input: prod.MakerInput) {
  return run(async (me) => {
    await prod.saveMaker(me, input);
    return input.id ? 'Factory updated' : 'Factory added';
  });
}
