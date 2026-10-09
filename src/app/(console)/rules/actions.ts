'use server';

import { refresh } from 'next/cache';
import { currentUser } from '@/lib/auth/session';
import { can } from '@/lib/domain/perms';
import { runStockRule } from '@/lib/stock-rule';

/**
 * Runs the out-of-stock sweep from the Rules page.
 *
 * Always a dry run from here, whatever the environment says. Changing a live shop is the scheduler's
 * job, on a setting someone deployed on purpose; this button is for seeing what the rule would do
 * before anyone turns it on.
 */
export async function dryRunStockRuleAction() {
  const u = await currentUser();
  if (!u || !can(u, 'settings', 2)) return { ok: false as const, note: 'Needs Settings access.' };
  const r = await runStockRule({ mode: 'dry' });
  refresh();
  const failed = r.channels.filter((c) => !c.ok);
  return {
    ok: failed.length === 0,
    note: failed.length
      ? `${failed[0].channelId}: ${failed[0].note}`
      : `${r.drafted ?? 0} would come off the shop · ${r.published ?? 0} would go back on`,
  };
}
