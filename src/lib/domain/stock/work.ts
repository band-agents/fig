// The work itself: what each kind of task is, how long it should take, who should get it, and
// how busy each person has really been. The board and the AI both run on these. Pure.

import type { Area } from '../perms';

export type TaskKind =
  | 'receive'
  | 'putaway'
  | 'transfer_pick'
  | 'transfer_receive'
  | 'cycle_count'
  | 'relabel'
  | 'quality_check'
  | 'replenish'
  | 'supplier_followup'
  | 'po_review'
  | 'merch_setup';

type KindMeta = { label: string; area: Extract<Area, 'warehouse' | 'procurement' | 'merch' | 'stock'>; base: number; perUnit: number; tint: string; verb: string };

/** Standard minutes: a fixed part to start the job and a part per unit handled. */
export const TASK_KIND: Record<TaskKind, KindMeta> = {
  receive: { label: 'Receive delivery', area: 'warehouse', base: 12, perUnit: 0.12, tint: 'blue', verb: 'Received' },
  putaway: { label: 'Put away', area: 'warehouse', base: 6, perUnit: 0.07, tint: 'cyan', verb: 'Put away' },
  transfer_pick: { label: 'Pick transfer', area: 'warehouse', base: 6, perUnit: 0.1, tint: 'violet', verb: 'Picked' },
  transfer_receive: { label: 'Receive transfer', area: 'warehouse', base: 5, perUnit: 0.06, tint: 'violet', verb: 'Received' },
  cycle_count: { label: 'Cycle count', area: 'warehouse', base: 4, perUnit: 0.05, tint: 'amber', verb: 'Counted' },
  relabel: { label: 'Re-ticket for markdown', area: 'warehouse', base: 5, perUnit: 0.15, tint: 'rose', verb: 'Re-ticketed' },
  quality_check: { label: 'Quality check', area: 'warehouse', base: 8, perUnit: 0.2, tint: 'amber', verb: 'Checked' },
  replenish: { label: 'Replenish pick face', area: 'warehouse', base: 5, perUnit: 0.06, tint: 'cyan', verb: 'Replenished' },
  supplier_followup: { label: 'Chase supplier', area: 'procurement', base: 15, perUnit: 0, tint: 'amber', verb: 'Chased' },
  po_review: { label: 'Review purchase order', area: 'procurement', base: 18, perUnit: 0.01, tint: 'violet', verb: 'Reviewed' },
  merch_setup: { label: 'Set up website placement', area: 'merch', base: 20, perUnit: 0, tint: 'rose', verb: 'Set up' },
};

export const estimateMinutes = (kind: TaskKind, units: number) => Math.max(3, Math.round(TASK_KIND[kind].base + TASK_KIND[kind].perUnit * units));

export const PRIORITY_LABEL: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };

export type Shift = { start: number; end: number; restDays: number[] }; // minutes after local midnight; 0 = Sunday

const OFFSET = 3 * 3_600_000;
const local = (t: number) => {
  const d = new Date(t + OFFSET);
  return { dow: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), dayStart: t - ((t + OFFSET) % 86_400_000) };
};

export function onShift(s: Shift | null, t: number): boolean {
  if (!s) return false;
  const l = local(t);
  return !s.restDays.includes(l.dow) && l.minute >= s.start && l.minute < s.end;
}

/** Today's shift as two timestamps, or null on a rest day. */
export function shiftToday(s: Shift | null, t: number): { from: number; to: number } | null {
  if (!s) return null;
  const l = local(t);
  if (s.restDays.includes(l.dow)) return null;
  return { from: l.dayStart + s.start * 60_000, to: l.dayStart + s.end * 60_000 };
}

export type Block = { start: number; end: number };

/** Merges overlapping blocks so two things done at once are not counted twice. */
export function merge(blocks: Block[]): Block[] {
  const s = blocks.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const out: Block[] = [];
  for (const b of s) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push({ ...b });
  }
  return out;
}

/**
 * How a person's shift has gone so far: minutes on recorded work against minutes of shift
 * elapsed, and the longest stretch with nothing recorded. Only time inside the shift counts.
 */
export function utilisation(window: { from: number; to: number } | null, blocks: Block[], now: number) {
  if (!window) return { elapsed: 0, busy: 0, rate: null as number | null, longestIdle: 0, idleNow: 0 };
  const to = Math.min(now, window.to);
  const elapsed = Math.max(0, (to - window.from) / 60_000);
  const inside = merge(blocks.map((b) => ({ start: Math.max(b.start, window.from), end: Math.min(b.end, to) })));
  const busy = inside.reduce((s, b) => s + (b.end - b.start) / 60_000, 0);
  let longestIdle = 0;
  let cursor = window.from;
  for (const b of inside) {
    longestIdle = Math.max(longestIdle, (b.start - cursor) / 60_000);
    cursor = Math.max(cursor, b.end);
  }
  const idleNow = Math.max(0, (to - cursor) / 60_000);
  longestIdle = Math.max(longestIdle, idleNow);
  return { elapsed, busy, rate: elapsed >= 15 ? Math.min(1, busy / elapsed) : null, longestIdle, idleNow };
}

/** Standard minutes earned ÷ minutes actually taken. Above 1 is faster than standard. */
export function pace(done: { estMinutes: number; spentMinutes: number | null }[]): number | null {
  const timed = done.filter((d) => d.spentMinutes != null && d.spentMinutes > 0);
  if (timed.length < 3) return null;
  const earned = timed.reduce((s, d) => s + d.estMinutes, 0);
  const taken = timed.reduce((s, d) => s + (d.spentMinutes ?? 0), 0);
  return taken ? earned / taken : null;
}

export type Candidate = {
  id: string;
  level: number; // their access in the task's area
  locationId: string | null;
  country: string | null;
  shift: Shift | null;
  queueMinutes: number; // standard minutes already waiting for them
  pace: number | null;
  skills: string[];
};

/**
 * Who should do a task: someone allowed to, at the right place, on shift if anyone is, with the
 * least queued work once their pace is allowed for. Returns null when nobody can.
 */
export function pickAssignee(task: { kind: TaskKind; locationId: string | null; country: string | null; estMinutes: number }, people: Candidate[], now: number): string | null {
  // doing a task takes the act level in its area (2); the caller passes each person's level there
  const fit = people.filter((p) => p.level >= 2 && (!task.country || !p.country || p.country === task.country));
  if (!fit.length) return null;
  const local = fit.filter((p) => !task.locationId || !p.locationId || p.locationId === task.locationId);
  const pool = local.length ? local : fit;
  const score = (p: Candidate) => {
    const speed = p.pace ?? 1;
    let s = (p.queueMinutes + task.estMinutes) / Math.max(0.5, speed);
    if (!onShift(p.shift, now)) s += 480;
    if (p.skills.includes(task.kind)) s *= 0.85;
    return s;
  };
  return [...pool].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0].id;
}
