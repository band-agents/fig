'use server';

import { refresh } from 'next/cache';
import { currentUser } from '@/lib/auth/session';
import { CHANNEL } from '@/lib/channels';
import { can } from '@/lib/domain/perms';
import { checkChannel, syncChannel, trackCouriers } from '@/lib/sync';
import type { ConnectionCheck } from '@/lib/connectors/types';

export async function checkChannelAction(id: string): Promise<ConnectionCheck> {
  const u = await currentUser();
  if (!u || !can(u, 'channels', 2)) return { ok: false, note: 'Checking connections needs Channels access.' };
  const c = CHANNEL[id];
  if (!c) return { ok: false, note: 'Unknown channel.' };
  return checkChannel(c);
}

export async function syncChannelAction(id: string) {
  const u = await currentUser();
  if (!u || !can(u, 'channels', 2)) return { ok: false, note: 'Syncing needs Channels access.' };
  const c = CHANNEL[id];
  if (!c) return { ok: false, note: 'Unknown channel.' };
  const r = await syncChannel(c);
  refresh();
  return r;
}

export async function trackNowAction() {
  const u = await currentUser();
  if (!u || !can(u, 'shipping', 2)) return { ok: false, note: 'Needs Shipping access.' };
  const r = await trackCouriers();
  refresh();
  return r;
}
