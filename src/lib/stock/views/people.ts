import 'server-only';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { effectiveScopes, level, type Principal } from '../../domain/perms';
import { merge, pace, shiftToday, TASK_KIND, utilisation, type Block, type TaskKind } from '../../domain/stock/work';
import { ROLES } from '../../domain/perms';

const DAY = 86_400_000;
const OFFSET = 3 * 3_600_000;
const dayStart = (t: number) => t - ((t + OFFSET) % DAY);

export type WorkArea = 'warehouse' | 'procurement' | 'merch';
export type Strip = { start: number; end: number; tint: string; title: string; doing?: boolean };

export type PersonDay = {
  id: string;
  name: string;
  hue: number;
  title: string | null;
  role: string;
  roleLabel: string;
  areas: WorkArea[];
  location: string | null;
  shift: { from: number; to: number } | null;
  onShift: boolean;
  strip: Strip[];
  util: { elapsed: number; busy: number; rate: number | null; longestIdle: number; idleNow: number };
  doing: { id: string; number: string; title: string; since: number; estMinutes: number } | null;
  queue: { n: number; minutes: number; late: number; blocked: number };
  today: { n: number; units: number; minutes: number; picks: number };
  month: { util: number | null; pace: number | null; onTime: number | null; done: number; units: number; days: number; trend: (number | null)[] };
};

/**
 * Everyone who does the work in these areas, as of now: today's shift hour by hour, what they are
 * on, what is waiting for them, and the last thirty days. Order picking and packing on the order
 * floor counts as work too, from the same events the order timeline shows.
 */
export async function peopleToday(p: Principal, areas: WorkArea[]): Promise<PersonDay[]> {
  const db = await getDb();
  const now = Date.now();
  const since = dayStart(now) - 30 * DAY;
  const [users, locs] = await Promise.all([db.select().from(schema.users).where(eq(schema.users.active, true)), db.select({ id: schema.locations.id, name: schema.locations.name }).from(schema.locations)]);
  const team = users
    .map((u) => ({ u, scopes: effectiveScopes(u.role, u.scopes) }))
    .filter(({ u, scopes }) => !['admin', 'viewer'].includes(u.role) && u.shiftStart != null && areas.some((a) => level({ scopes }, a) >= 2))
    // a store scope narrows who a manager sees: the Kuwait lead sees the Kuwait floor
    .filter(({ u }) => !p.channels.length || !u.channels.length || u.channels.some((c) => p.channels.includes(c)));
  if (!team.length) return [];
  const ids = team.map(({ u }) => u.id);
  const [tasks, picks] = await Promise.all([
    db
      .select()
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.assigneeId, ids), sql`(${schema.tasks.status} in ('open','doing','blocked') or ${schema.tasks.doneAt} >= ${new Date(since)})`)),
    db
      .select({ actorId: schema.events.actorId, at: schema.events.at })
      .from(schema.events)
      .where(and(inArray(schema.events.actorId, ids), eq(schema.events.kind, 'stage'), inArray(schema.events.toStage, ['packed']), gte(schema.events.at, new Date(since)))),
  ]);

  return team
    .map(({ u, scopes }) => {
      const shiftDef = u.shiftStart != null && u.shiftEnd != null ? { start: u.shiftStart, end: u.shiftEnd, restDays: u.restDays } : null;
      const mine = tasks.filter((t) => t.assigneeId === u.id);
      const myPicks = picks.filter((e) => e.actorId === u.id).map((e) => e.at.getTime());
      const blocksFor = (from: number, to: number): (Block & { tint: string; title: string; doing?: boolean })[] => [
        ...mine
          .filter((t) => t.startedAt && t.startedAt.getTime() < to && (t.doneAt?.getTime() ?? now) > from)
          .map((t) => ({ start: t.startedAt!.getTime(), end: t.status === 'doing' ? now : t.doneAt?.getTime() ?? t.startedAt!.getTime() + t.estMinutes * 60_000, tint: TASK_KIND[t.kind as TaskKind]?.tint ?? 'neutral', title: `${t.number} · ${t.title}`, doing: t.status === 'doing' })),
        // an order picked and packed: about six minutes of the floor
        ...myPicks.filter((at) => at > from && at <= to).map((at) => ({ start: at - 6 * 60_000, end: at, tint: 'blue', title: 'Picked and packed an order' })),
      ];
      const win = shiftToday(shiftDef, now);
      const todayBlocks = win ? blocksFor(win.from, Math.min(now, win.to + 2 * 3_600_000)) : blocksFor(dayStart(now), now);
      const util = utilisation(win, todayBlocks, now);
      const doing = mine.find((t) => t.status === 'doing');
      const waiting = mine.filter((t) => t.status === 'open' || t.status === 'doing' || t.status === 'blocked');
      const doneToday = mine.filter((t) => t.status === 'done' && t.doneAt && t.doneAt.getTime() >= dayStart(now));

      // thirty days: one utilisation figure per working day, then the average
      const trend: (number | null)[] = [];
      for (let d = 29; d >= 0; d--) {
        const t = dayStart(now) - d * DAY + 12 * 3_600_000;
        const w = shiftToday(shiftDef, t);
        if (!w || w.from > now) {
          trend.push(null);
          continue;
        }
        const end = Math.min(now, w.to);
        const r = utilisation(w, merge(blocksFor(w.from, end)), end);
        trend.push(r.rate);
      }
      const worked = trend.filter((x): x is number => x != null && x > 0.02);
      const done30 = mine.filter((t) => t.status === 'done' && t.doneAt && t.doneAt.getTime() >= since);
      const timed = done30.filter((t) => t.dueAt);
      return {
        id: u.id,
        name: u.name,
        hue: u.hue,
        title: u.title,
        role: u.role,
        roleLabel: ROLES[u.role as keyof typeof ROLES]?.label ?? u.role,
        areas: areas.filter((a) => level({ scopes }, a) >= 2),
        location: locs.find((l) => l.id === u.locationId)?.name ?? null,
        shift: win,
        onShift: Boolean(win && now >= win.from && now < win.to),
        strip: todayBlocks.map((b) => ({ start: b.start, end: b.end, tint: b.tint, title: b.title, doing: b.doing })),
        util,
        doing: doing ? { id: doing.id, number: doing.number, title: doing.title, since: doing.startedAt?.getTime() ?? now, estMinutes: doing.estMinutes } : null,
        queue: {
          n: waiting.filter((t) => t.status !== 'doing').length,
          minutes: waiting.reduce((a, t) => a + t.estMinutes, 0),
          late: waiting.filter((t) => t.dueAt && t.dueAt.getTime() < now).length,
          blocked: waiting.filter((t) => t.status === 'blocked').length,
        },
        today: { n: doneToday.length, units: doneToday.reduce((a, t) => a + t.units, 0), minutes: doneToday.reduce((a, t) => a + (t.spentMinutes ?? 0), 0), picks: myPicks.filter((at) => at >= dayStart(now)).length },
        month: {
          util: worked.length ? worked.reduce((a, b) => a + b, 0) / worked.length : null,
          pace: pace(done30.map((t) => ({ estMinutes: t.estMinutes, spentMinutes: t.spentMinutes }))),
          onTime: timed.length ? timed.filter((t) => t.doneAt! <= t.dueAt!).length / timed.length : null,
          done: done30.length,
          units: done30.reduce((a, t) => a + t.units, 0),
          days: worked.length,
          trend,
        },
      } satisfies PersonDay;
    })
    .sort((a, b) => Number(b.onShift) - Number(a.onShift) || (b.util.rate ?? -1) - (a.util.rate ?? -1));
}
