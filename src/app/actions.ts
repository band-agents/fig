'use server';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { refresh } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { createSession, currentUser, destroySession } from '@/lib/auth/session';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';
import { actorFor, addNote, assign, moveOrder, moveReturn, openReturn, setHold, putSetting } from '@/lib/engine';
import { RelayError } from '@/lib/errors';
import { can, ROLES, scopesFor, type Role } from '@/lib/domain/perms';
import type { OrderStage, ReturnReason, ReturnStage } from '@/lib/domain/stages';
import { demoMode } from '@/lib/demo';

export type Result = { ok: true; message?: string } | { ok: false; error: string };

async function run(fn: () => Promise<string | void>): Promise<Result> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof RelayError) return { ok: false, error: e.message };
    console.error('[relay] action failed', e);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}

async function me() {
  const u = await currentUser();
  if (!u) throw new RelayError('forbidden', 'You are signed out.');
  return u;
}

// ── Session ──
export async function signIn(_: unknown, form: FormData): Promise<Result> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/');
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (u?.lockedUntil && u.lockedUntil > new Date()) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
  if (!u || !u.active || !(await verifyPassword(password, u.passwordHash))) {
    if (u) {
      const fails = u.failedLogins + 1;
      await db.update(schema.users).set({ failedLogins: fails, lockedUntil: fails >= 5 ? new Date(Date.now() + 15 * 60_000) : null }).where(eq(schema.users.id, u.id));
    }
    return { ok: false, error: 'That email and password don’t match.' };
  }
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await createSession(u.id);
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function demoSignIn(email: string) {
  if (!demoMode()) throw new Error('Demo sign-in is off.');
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!u || !email.endsWith('@relay.local')) throw new Error('No such demo account.');
  await destroySession();
  await createSession(u.id);
  redirect('/');
}

/** First run on a fresh server: the first account becomes the admin. */
export async function createOwner(_: unknown, form: FormData): Promise<Result> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(sql`password_hash is not null`);
  if (n > 0) return { ok: false, error: 'An owner already exists. Sign in instead.' };
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Add your name and a valid email.' };
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const [u] = await db
    .insert(schema.users)
    .values({ name, email, title: 'Owner', role: 'admin', scopes: scopesFor('admin'), passwordHash: await hashPassword(password), hue: 2 })
    .onConflictDoUpdate({ target: schema.users.email, set: { name, passwordHash: await hashPassword(password), role: 'admin', scopes: scopesFor('admin') } })
    .returning();
  await createSession(u.id);
  redirect('/');
}

export async function signOut() {
  await destroySession();
  redirect('/login');
}

export async function setTheme(theme: 'dark' | 'light') {
  (await cookies()).set('relay_theme', theme, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' });
}

// ── Orders ──
export async function moveOrderAction(orderId: string, to: OrderStage, input: { reason?: string; tracking?: string; courier?: string; note?: string } = {}) {
  return run(async () => {
    const u = await me();
    await moveOrder(actorFor(u), orderId, to, input);
  });
}

export async function bulkMoveAction(orderIds: string[], to: OrderStage) {
  return run(async () => {
    const u = await me();
    let moved = 0;
    const errors: string[] = [];
    for (const id of orderIds.slice(0, 200)) {
      try {
        await moveOrder(actorFor(u), id, to);
        moved++;
      } catch (e) {
        if (e instanceof RelayError) errors.push(e.message);
        else throw e;
      }
    }
    if (!moved && errors.length) throw new RelayError('invalid', errors[0]);
    return `${moved} moved${errors.length ? ` · ${errors.length} skipped` : ''}`;
  });
}

export async function holdAction(orderId: string, on: boolean, reason?: string) {
  return run(async () => {
    const u = await me();
    await setHold(actorFor(u), orderId, on, reason);
  });
}

export async function noteAction(target: { orderId?: string; returnId?: string }, message: string, kind: 'note' | 'call' = 'note') {
  return run(async () => {
    const u = await me();
    await addNote(actorFor(u), target, message, kind);
  });
}

export async function assignAction(orderId: string, userId: string | null) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'orders', 1)) throw new RelayError('forbidden', 'No access.');
    await assign(actorFor(u), orderId, userId);
  });
}

// ── Returns ──
export async function openReturnAction(orderId: string, input: Parameters<typeof openReturn>[2]) {
  return run(async () => {
    const u = await me();
    const r = await openReturn(actorFor(u), orderId, { ...input, reason: input.reason as ReturnReason });
    return r.number;
  });
}

export async function moveReturnAction(returnId: string, to: ReturnStage, input: Parameters<typeof moveReturn>[3] = {}) {
  return run(async () => {
    const u = await me();
    await moveReturn(actorFor(u), returnId, to, input);
  });
}

// ── Finance ──
export async function reconcileSettlementAction(settlementId: string, remittedMajor: number) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'finance', 2)) throw new RelayError('forbidden', 'Reconciling needs Finance access.');
    const db = await getDb();
    const [s] = await db.select().from(schema.settlements).where(eq(schema.settlements.id, settlementId));
    if (!s) throw new RelayError('not_found', 'Settlement not found.');
    const { toMinor } = await import('@/lib/format');
    const remitted = toMinor(remittedMajor, s.currency);
    const status = remitted === s.expected ? 'matched' : 'discrepancy';
    await db.update(schema.settlements).set({ remitted, status, matchedAt: new Date() }).where(eq(schema.settlements.id, s.id));
    if (status === 'matched') {
      const orders = await db.select({ id: schema.orders.id }).from(schema.orders).where(sql`settlement_id = ${s.id} and stage = 'delivered'`);
      for (const o of orders) await moveOrder(actorFor(u), o.id, 'settled');
      return `Matched · ${orders.length} orders settled`;
    }
    return 'Recorded with a discrepancy';
  });
}

// ── Team ──
export async function saveMemberAction(input: { id?: string; email: string; name: string; title?: string; role: Role; channels: string[]; scopes?: Record<string, number> }) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'team', 2)) throw new RelayError('forbidden', 'Managing the team needs Team access.');
    if (input.role === 'admin' && u.role !== 'admin') throw new RelayError('forbidden', 'Only an admin can grant admin access.');
    const scopes = { ...scopesFor(input.role), ...(input.scopes ?? {}) } as ReturnType<typeof scopesFor>;
    for (const [a, l] of Object.entries(scopes)) {
      if ((l ?? 0) > (u.scopes[a as keyof typeof u.scopes] ?? 0)) throw new RelayError('forbidden', `You can't give more ${a} access than you hold.`);
    }
    const db = await getDb();
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new RelayError('invalid', 'Add a valid email.');
    if (input.id) {
      await db.update(schema.users).set({ name: input.name, title: input.title ?? null, role: input.role, scopes, channels: input.channels }).where(eq(schema.users.id, input.id));
      return 'Access updated';
    }
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (exists) throw new RelayError('conflict', 'Someone with that email is already on the team.');
    await db.insert(schema.users).values({ email, name: input.name, title: input.title ?? ROLES[input.role].label, role: input.role, scopes, channels: input.channels, invitedBy: u.id, hue: Math.floor(Math.random() * 360) });
    const token = randomBytes(24).toString('base64url');
    await db.insert(schema.invitations).values({ email, name: input.name, role: input.role, scopes, channels: input.channels, tokenHash: createHash('sha256').update(token).digest('hex'), invitedBy: u.id, expiresAt: new Date(Date.now() + 7 * 86400000) });
    return `/join?token=${token}`;
  });
}

/** Opening a join link: set a password, and the account is live. */
export async function acceptInvite(_: unknown, form: FormData): Promise<Result> {
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const db = await getDb();
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, createHash('sha256').update(token).digest('hex')));
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return { ok: false, error: 'This link has expired or was already used. Ask for a new one.' };
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, inv.email));
  if (!u || !u.active) return { ok: false, error: 'This account was switched off.' };
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  await db.update(schema.invitations).set({ acceptedAt: new Date() }).where(eq(schema.invitations.id, inv.id));
  await createSession(u.id);
  redirect('/');
}

export async function resendInviteAction(userId: string) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'team', 2)) throw new RelayError('forbidden', 'Needs Team access.');
    const db = await getDb();
    const [t] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!t) throw new RelayError('not_found', 'No such teammate.');
    const token = randomBytes(24).toString('base64url');
    await db.insert(schema.invitations).values({ email: t.email, name: t.name, role: t.role, scopes: t.scopes, channels: t.channels, tokenHash: createHash('sha256').update(token).digest('hex'), invitedBy: u.id, expiresAt: new Date(Date.now() + 7 * 86400000) });
    return `/join?token=${token}`;
  });
}

export async function setMemberActiveAction(userId: string, active: boolean) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'team', 3)) throw new RelayError('forbidden', 'Only a team manager can switch accounts off.');
    if (userId === u.id) throw new RelayError('invalid', 'You can’t switch yourself off.');
    const db = await getDb();
    if (!active) {
      const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      if (target?.role === 'admin') {
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(sql`role = 'admin' and active = true`);
        if (n <= 1) throw new RelayError('invalid', 'That is the last active admin.');
      }
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    }
    await db.update(schema.users).set({ active }).where(eq(schema.users.id, userId));
  });
}

// ── Rules ──
export async function saveRulesAction(key: 'sla' | 'autopilot', value: unknown) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'settings', 2)) throw new RelayError('forbidden', 'Changing rules needs Rules access.');
    await putSetting(key, value, u.name);
    return 'Saved';
  });
}

// ── Demo ──
export async function resetDemoAction() {
  return run(async () => {
    const u = await me();
    if (!demoMode() || u.role !== 'admin') throw new RelayError('forbidden', 'Only an admin can reset demo data, and only in demo mode.');
    const { seedDemo } = await import('@/seed/demo');
    const r = await seedDemo({ days: 30 });
    return `Demo floor rebuilt · ${r.orders} orders`;
  });
}
