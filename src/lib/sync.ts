import 'server-only';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb, schema } from './db';
import { CHANNEL, CHANNELS, channelConfigured, type ChannelDef } from './channels';
import { connectorFor, aramexConfigured, classifyUpdate, trackShipments } from './connectors';
import type { ConnectionCheck } from './connectors/types';
import { flagException, ingestOrder, moveOrder, type Actor } from './engine';
import { publish } from './bus';

// Pulling orders from every connected store, and asking the courier where parcels are.
// Pull is incremental (updated since the last good run, with 10 minutes of overlap) and idempotent:
// ingestOrder only creates new orders and moves known ones forward, so a replayed page is harmless.

const OVERLAP = 10 * 60_000;
const running = new Set<string>();

export async function syncChannel(c: ChannelDef, opts: { days?: number } = {}) {
  if (running.has(c.id)) return { ok: false, note: 'Already syncing' };
  const connector = connectorFor(c);
  if (!connector || !channelConfigured(c)) return { ok: false, note: 'Not connected' };
  running.add(c.id);
  const db = await getDb();
  const started = new Date();
  const [run] = await db.insert(schema.syncRuns).values({ channelId: c.id, startedAt: started }).returning();
  const [row] = await db.select().from(schema.channels).where(eq(schema.channels.id, c.id));
  const since = row?.cursor ? new Date(new Date(row.cursor).getTime() - OVERLAP) : null;
  let fetched = 0;
  let created = 0;
  let updated = 0;
  try {
    for await (const page of connector.pull(c, since, { days: opts.days ?? 30 })) {
      for (const inc of page) {
        fetched++;
        const r = await ingestOrder(inc, { quiet: true });
        if (r.created) created++;
        else updated++;
      }
    }
    const note = `${fetched} checked · ${created} new · ${updated} updated`;
    await db.update(schema.syncRuns).set({ finishedAt: new Date(), ok: true, fetched, created, updated, note }).where(eq(schema.syncRuns.id, run.id));
    await db
      .insert(schema.channels)
      .values({ id: c.id, mode: 'live', cursor: started.toISOString(), lastSyncAt: new Date(), lastSyncOk: true, lastSyncNote: note })
      .onConflictDoUpdate({ target: schema.channels.id, set: { mode: 'live', cursor: started.toISOString(), lastSyncAt: new Date(), lastSyncOk: true, lastSyncNote: note } });
    if (created || updated) publish({ kind: 'sync', channelId: c.id, message: note });
    return { ok: true, note };
  } catch (e) {
    const note = e instanceof Error ? e.message.slice(0, 300) : 'Sync failed';
    await db.update(schema.syncRuns).set({ finishedAt: new Date(), ok: false, fetched, created, updated, note }).where(eq(schema.syncRuns.id, run.id));
    await db.update(schema.channels).set({ lastSyncAt: new Date(), lastSyncOk: false, lastSyncNote: note }).where(eq(schema.channels.id, c.id));
    return { ok: false, note };
  } finally {
    running.delete(c.id);
  }
}

export async function syncAll() {
  const out: Record<string, { ok: boolean; note: string }> = {};
  for (const c of CHANNELS) if (channelConfigured(c)) out[c.id] = await syncChannel(c);
  return out;
}

export async function checkChannel(c: ChannelDef): Promise<ConnectionCheck> {
  const connector = connectorFor(c);
  if (c.parked) return { ok: false, note: 'Parked on purpose: no stock source or catalogue decision yet.' };
  if (!connector) return { ok: false, note: 'No connector for this platform.' };
  if (!channelConfigured(c)) return { ok: false, note: 'No credentials in the environment yet.' };
  try {
    return await connector.check(c);
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message.slice(0, 300) : 'Check failed' };
  }
}

/** Asks Aramex about every live parcel still on the road and moves orders when the courier says so. */
export async function trackCouriers() {
  if (!aramexConfigured()) return { ok: false, note: 'Aramex is not configured' };
  const db = await getDb();
  const open = await db
    .select()
    .from(schema.orders)
    .where(and(inArray(schema.orders.stage, ['shipped', 'delivering']), isNotNull(schema.orders.tracking), ne(schema.orders.source, 'demo')));
  if (!open.length) return { ok: true, note: 'Nothing on the road' };
  const updates = await trackShipments(open.map((o) => o.tracking!));
  let moved = 0;
  for (const o of open) {
    const list = updates.get(o.tracking!) ?? [];
    const last = [...list].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (!last) continue;
    const courier: Actor = { id: null, name: CHANNEL[o.channelId]?.carrier ?? 'Aramex', dept: null };
    const cls = classifyUpdate(last);
    try {
      if (cls === 'delivered') {
        await moveOrder(courier, o.id, 'delivered', {}, { at: last.at });
        moved++;
      } else if (cls === 'out_for_delivery' && o.stage === 'shipped') {
        await moveOrder(courier, o.id, 'delivering', {}, { at: last.at });
        moved++;
      } else if (cls === 'returned') {
        await moveOrder(courier, o.id, 'rto', { reason: last.description }, { at: last.at });
        moved++;
      } else if (cls === 'exception' && o.exception !== last.description) {
        await flagException(courier, o.id, `${last.description}${last.location ? ` · ${last.location}` : ''}`, { attempt: /attempt|not home|unable/i.test(last.description) });
      }
    } catch {
      // a stage rule refused the move (e.g. the order is on hold); the next run will try again
    }
  }
  return { ok: true, note: `${open.length} parcels checked · ${moved} moved` };
}
