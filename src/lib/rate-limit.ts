import 'server-only';

/**
 * A small limiter for the public endpoints.
 *
 * The returns portal is the only part of Relay a stranger can reach, and its credential is an order
 * number plus an email. Order numbers are sequential, so without a limit the lookup is a way of
 * testing whether an address has ever shopped with us. This caps how fast anyone can ask.
 *
 * It counts in memory, which means it holds per instance rather than across a cluster. That is
 * honest for what it is: a brake on scripted guessing, not a defence against a distributed attack.
 * If Relay is ever run on several instances this wants to move to Postgres or Redis, and the
 * single-process note below is the reminder.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-running process. */
function sweep(now: number) {
  if (buckets.size < 5_000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * The caller's address, as far as it can be known behind a proxy.
 *
 * `x-forwarded-for` is a list, client first, and anything after the first entry was added by a
 * proxy. It is also trivially spoofed, so this is a brake and not an identity.
 */
export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'unknown';
}

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

export async function rateLimit(
  req: Request,
  scope: string,
  opts: { max: number; windowMs: number }
): Promise<RateLimitResult> {
  const now = Date.now();
  sweep(now);
  const key = `${scope}:${clientKey(req)}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.max - 1, retryAfterSec: 0 };
  }

  existing.count += 1;
  if (existing.count > opts.max) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: opts.max - existing.count, retryAfterSec: 0 };
}

/** For tests, which would otherwise inherit counts from each other. */
export const __resetRateLimits = () => buckets.clear();
