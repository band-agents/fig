'use server';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { refresh } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { assertCanAct, createSession, currentUser, destroySession, realUser, VIEW_AS, VIEW_AS_BRAND } from '@/lib/auth/session';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';
import { actorFor, addNote, assign, moveOrder, moveReturn, openReturn, refundCancelled, retryStore, setHold, putSetting, setShipFrom } from '@/lib/engine';
import { RelayError } from '@/lib/errors';
import { checkBranches } from '@/lib/ship-from';
import { can, effectiveScopes, landingFor, overridesFor, ROLES, seesBrand, type Role, type Scopes } from '@/lib/domain/perms';
import type { OrderStage, ReturnReason, ReturnStage } from '@/lib/domain/stages';
import { demoMode } from '@/lib/demo';
import { BUSINESS_COOKIE, businessesFor, readView } from '@/lib/business';
import { mailConfigured, sendMail } from '@/lib/mail';
import { joinEmail, tempEmail } from '@/lib/mail-invite';

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
  assertCanAct(u);
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
  // a temporary password gets them in once, to choose their own
  if (u.mustChangePassword) redirect('/set-password');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
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
    .values({ name, email, title: 'Owner', role: 'admin', scopes: {}, passwordHash: await hashPassword(password), hue: 2 })
    .onConflictDoUpdate({ target: schema.users.email, set: { name, passwordHash: await hashPassword(password), role: 'admin', scopes: {} } })
    .returning();
  await createSession(u.id);
  redirect('/');
}

export async function signOut() {
  await destroySession();
  redirect('/login');
}

/**
 * An admin's View as: look at the console as one job sees it (its menu, its pages, its data), without
 * signing out. Read-only while on. Returns where that job lands, for the switcher to open.
 */
export async function setViewAsAction(role: Role | null, brand?: string | null): Promise<{ ok: boolean; href: string }> {
  const u = await realUser();
  if (!u || u.role !== 'admin') return { ok: false, href: '/' };
  const jar = await cookies();
  if (!role || role === 'admin' || !(role in ROLES)) {
    jar.delete(VIEW_AS);
    jar.delete(VIEW_AS_BRAND);
    return { ok: true, href: '/' };
  }
  const opts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' } as const;
  jar.set(VIEW_AS, role, opts);
  if (role === 'brand' && brand?.trim()) jar.set(VIEW_AS_BRAND, brand.trim().slice(0, 80), opts);
  else jar.delete(VIEW_AS_BRAND);
  return { ok: true, href: landingFor({ role, scopes: ROLES[role].scopes }) ?? '/' };
}

/** The switch at the top of every page: FIG, Labesny, or both together. Only a business the person covers. */
export async function setBusinessAction(view: string) {
  const u = await realUser();
  if (!u) return { ok: false };
  const v = readView(view);
  if (v !== 'all' && !businessesFor(u).includes(v)) return { ok: false };
  (await cookies()).set(BUSINESS_COOKIE, v, { path: '/', maxAge: 365 * 86400, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  return { ok: true };
}

export async function setTheme(theme: 'dark' | 'light') {
  (await cookies()).set('dh_theme', theme, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' });
}

// ── Orders ──
export async function moveOrderAction(orderId: string, to: OrderStage, input: { reason?: string; tracking?: string; courier?: string; note?: string } = {}) {
  return run(async () => {
    const u = await me();
    await moveOrder(actorFor(u), orderId, to, input);
  });
}

/** Books a Kuwait order with UPS (GMTC) now: the waybill comes back from GMTC, nobody types it. */
export async function bookUpsAction(orderId: string, service?: 'NEXT DAY' | 'SAME DAY') {
  return run(async () => {
    const u = await me();
    const { createUpsShipment } = await import('@/lib/gmtc-shipments');
    const { GmtcError } = await import('@/lib/connectors');
    try {
      const waybill = await createUpsShipment(actorFor(u), orderId, { service });
      return `Booked with UPS: ${waybill}`;
    } catch (e) {
      if (e instanceof GmtcError) throw new RelayError('invalid', e.message);
      throw e;
    }
  });
}

/** Keeps the chosen courier on an open order (Courier assignment page). */
export async function assignCourierAction(orderId: string, courier: string) {
  return run(async () => {
    const u = await me();
    const { assignCourier } = await import('@/lib/courier-assign');
    return `Assigned to ${await assignCourier(actorFor(u), orderId, courier)}`;
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

/** The branch an order leaves from, or null to clear it. */
export async function shipFromAction(orderId: string, branch: { code: string; name: string } | null) {
  return run(async () => {
    const u = await me();
    await setShipFrom(actorFor(u), orderId, branch);
    return branch ? `Ships from ${branch.name}` : 'Branch cleared';
  });
}

/** Asks Lucida which branches hold this order's pieces (one call per Lucida database). */
export async function checkBranchesAction(orderId: string) {
  return run(async () => {
    const u = await me();
    if (!(['fulfilment', 'orders', 'intake', 'shipping'] as const).some((a) => can(u, a, 2))) throw new RelayError('forbidden', 'Needs access to work on orders.');
    try {
      const n = await checkBranches(orderId);
      return n ? `Lucida answered for ${n} branch row${n === 1 ? '' : 's'}` : 'Lucida has none of these pieces in any branch';
    } catch (e) {
      throw new RelayError('invalid', e instanceof Error ? e.message : 'Lucida did not answer.');
    }
  });
}

export async function holdAction(orderId: string, on: boolean, reason?: string) {
  return run(async () => {
    const u = await me();
    await setHold(actorFor(u), orderId, on, reason);
  });
}

/** Finance: refund a cancelled order that had been paid; the store sends the money back the way it came. */
export async function refundCancelledAction(orderId: string) {
  return run(async () => {
    const u = await me();
    await refundCancelled(actorFor(u), orderId);
    return 'Refund sent to the store';
  });
}

/** Sends again what the store refused last time on this order. */
export async function retryStoreAction(orderId: string) {
  return run(async () => {
    const u = await me();
    await retryStore(actorFor(u), orderId);
    return 'Sent to the store again';
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
export async function saveMemberAction(input: { id?: string; email: string; name: string; title?: string; role: Role; channels: string[]; brands?: string[]; scopes?: Record<string, number>; tempPassword?: string }) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'team', 2)) throw new RelayError('forbidden', 'Managing the team needs Team access.');
    if (input.role === 'admin' && u.role !== 'admin') throw new RelayError('forbidden', 'Only an admin can grant admin access.');
    // what is stored is only where this person differs from their job, so a better preset reaches them
    const scopes = overridesFor(input.role, (input.scopes ?? {}) as Scopes);
    for (const [a, l] of Object.entries(effectiveScopes(input.role, scopes))) {
      if ((l ?? 0) > (u.scopes[a as keyof typeof u.scopes] ?? 0)) throw new RelayError('forbidden', `You can't give more ${a} access than you hold.`);
    }
    // someone limited to brands can only hand on brands inside their own
    const brands = [...new Set((input.brands ?? []).map((b) => b.trim()).filter(Boolean))].slice(0, 40);
    if (u.brands?.length && (!brands.length || !brands.every((b) => seesBrand(u, b)))) throw new RelayError('forbidden', "You can't give access to brands you don't cover.");
    const db = await getDb();
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new RelayError('invalid', 'Add a valid email.');
    if (input.id) {
      await db.update(schema.users).set({ name: input.name, title: input.title ?? null, role: input.role, scopes, channels: input.channels, brands }).where(eq(schema.users.id, input.id));
      return 'Access updated';
    }
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (exists) throw new RelayError('conflict', 'Someone with that email is already on the team.');
    if (input.tempPassword) {
      // a temporary password: it signs them in once, and they choose their own before anything opens
      const problem = passwordProblem(input.tempPassword);
      if (problem) throw new RelayError('invalid', `Temporary password: ${problem}`);
      await db.insert(schema.users).values({ email, name: input.name, title: input.title ?? ROLES[input.role].label, role: input.role, scopes, channels: input.channels, brands, invitedBy: u.id, hue: Math.floor(Math.random() * 360), passwordHash: await hashPassword(input.tempPassword), mustChangePassword: true });
      return 'temp';
    }
    await db.insert(schema.users).values({ email, name: input.name, title: input.title ?? ROLES[input.role].label, role: input.role, scopes, channels: input.channels, brands, invitedBy: u.id, hue: Math.floor(Math.random() * 360) });
    const token = randomBytes(24).toString('base64url');
    await db.insert(schema.invitations).values({ email, name: input.name, role: input.role, scopes, channels: input.channels, brands, tokenHash: createHash('sha256').update(token).digest('hex'), invitedBy: u.id, expiresAt: new Date(Date.now() + 7 * 86400000) });
    return `/join?token=${token}`;
  });
}

/**
 * Emails a teammate the login just made for them: their join link, or their temporary password. Both
 * are checked first (the link must be their open invitation, the password their current temporary
 * one), so this can only ever send someone their own way in.
 */
export async function emailLoginAction(input: { email: string; password?: string; joinPath?: string; reset?: boolean }) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'team', 2)) throw new RelayError('forbidden', 'Needs Team access.');
    if (!mailConfigured()) throw new RelayError('invalid', 'Email is not set up yet: add the SMTP settings to relay/.env.local.');
    const db = await getDb();
    const [t] = await db.select().from(schema.users).where(eq(schema.users.email, input.email.trim().toLowerCase()));
    if (!t || !t.active) throw new RelayError('not_found', 'No such teammate.');
    const role = ROLES[t.role as Role]?.label ?? t.role;
    let mail;
    if (input.password) {
      if (!t.mustChangePassword || !(await verifyPassword(input.password, t.passwordHash))) throw new RelayError('invalid', 'That is not their current temporary password.');
      mail = tempEmail({ to: t.email, name: t.name, by: u.name, role, password: input.password, reset: input.reset });
    } else if (input.joinPath) {
      const token = new URL(input.joinPath, 'http://x').searchParams.get('token') ?? '';
      const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, createHash('sha256').update(token).digest('hex')));
      if (!inv || inv.email !== t.email || inv.acceptedAt || inv.expiresAt < new Date()) throw new RelayError('invalid', 'That join link is not theirs or has expired: make a new one.');
      mail = joinEmail({ to: t.email, name: t.name, by: u.name, role, joinPath: `/join?token=${token}` });
    } else throw new RelayError('invalid', 'Nothing to send.');
    const res = await sendMail(mail);
    if (!res.ok) throw new RelayError('invalid', res.note);
    return `Emailed to ${t.email}`;
  });
}

/** Setup → Channels: one test email to any address, to see the mail settings work. */
export async function testMailAction(to: string) {
  return run(async () => {
    const u = await me();
    if (!(can(u, 'team', 3) || can(u, 'channels', 3))) throw new RelayError('forbidden', 'Needs Team or Channels manage access.');
    const addr = to.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) throw new RelayError('invalid', 'Add a valid email.');
    const res = await sendMail({
      to: addr,
      subject: 'DH & DCO console: email works',
      text: `This is a test from the DH & DCO console, sent by ${u.name}. Team invitations and logins will arrive like this.`,
      html: `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">This is a test from the DH &amp; DCO console, sent by ${u.name.replace(/</g, '&lt;')}.<br>Team invitations and logins will arrive like this.</p>`,
    });
    if (!res.ok) throw new RelayError('invalid', res.note);
    return `Test sent to ${addr}`;
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
    await db.insert(schema.invitations).values({ email: t.email, name: t.name, role: t.role, scopes: t.scopes, channels: t.channels, brands: t.brands, tokenHash: createHash('sha256').update(token).digest('hex'), invitedBy: u.id, expiresAt: new Date(Date.now() + 7 * 86400000) });
    return `/join?token=${token}`;
  });
}

/**
 * Gives a teammate a new temporary password (a forgotten one, or a first login): it signs them in
 * once and they choose their own. Their other sessions end, and a locked account opens again.
 */
export async function tempPasswordAction(userId: string, tempPassword: string) {
  return run(async () => {
    const u = await me();
    if (!can(u, 'team', 2)) throw new RelayError('forbidden', 'Needs Team access.');
    if (userId === u.id) throw new RelayError('invalid', 'Change your own password from the sign-in page.');
    const problem = passwordProblem(tempPassword);
    if (problem) throw new RelayError('invalid', `Temporary password: ${problem}`);
    const db = await getDb();
    const [t] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!t) throw new RelayError('not_found', 'No such teammate.');
    if (t.role === 'admin' && u.role !== 'admin') throw new RelayError('forbidden', 'Only an admin can reset an admin’s password.');
    await db.update(schema.users).set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    return 'Temporary password set';
  });
}

/** The first sign-in with a temporary password: they choose their own, and the console opens. */
export async function setOwnPasswordAction(_: unknown, form: FormData): Promise<Result> {
  const u = await realUser();
  if (!u) return { ok: false, error: 'You are signed out. Sign in again with the temporary password.' };
  if (!u.mustChangePassword) return { ok: false, error: 'Your password is already set.' };
  const password = String(form.get('password') ?? '');
  const again = String(form.get('again') ?? '');
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  if (password !== again) return { ok: false, error: 'The two passwords don’t match.' };
  const db = await getDb();
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  if (!row) return { ok: false, error: 'This account no longer exists.' };
  if (await verifyPassword(password, row.passwordHash)) return { ok: false, error: 'Choose a password different from the temporary one.' };
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), mustChangePassword: false, failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, u.id));
  redirect(landingFor({ role: u.role, scopes: u.scopes }) ?? '/');
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
