'use server';

import { refresh } from 'next/cache';
import { assertCanAct, currentUser } from '@/lib/auth/session';
import { RelayError } from '@/lib/errors';
import { can } from '@/lib/domain/perms';
import { putSetting } from '@/lib/engine';
import { normaliseRates, type ShippingRates } from '@/lib/domain/shipping-cost';

export type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Saves the couriers' rate cards that price the shipping we pay. Finance or whoever edits the rules. */
export async function saveShippingRatesAction(rates: ShippingRates): Promise<Result> {
  try {
    const me = await currentUser();
    if (!me) throw new RelayError('forbidden', 'You are signed out.');
    assertCanAct(me);
    if (!can(me, 'finance', 2) && !can(me, 'settings', 2)) throw new RelayError('forbidden', 'Changing the rate cards needs Finance or Rules access.');
    const clean = normaliseRates(rates);
    if (!clean.cards.length) throw new RelayError('invalid', 'Keep at least one rate card.');
    await putSetting('shipping.rates', { ...clean, updatedBy: me.name, updatedAt: new Date().toISOString() }, me.name);
    refresh();
    return { ok: true, message: 'Rate cards saved' };
  } catch (e) {
    if (e instanceof RelayError) return { ok: false, error: e.message };
    console.error('[relay] saving rate cards failed', e);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}
