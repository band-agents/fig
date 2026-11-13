import { trackByNumber, trackBySignedLink } from '@/lib/track-portal';
import { httpError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * "Where is my order?" Public: no session.
 *
 * Either the signed link from the shipping email ({ o, t }) or the order number plus the email or
 * phone on it ({ number, contact }). The second is a guess-able pair, so it is rate limited per
 * address the same way the returns lookup is.
 */
export async function POST(req: Request) {
  let body: { o?: string; t?: string; number?: string; contact?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request', message: 'Send a JSON body.' }, { status: 400 });
  }

  const signed = Boolean(body.o && body.t);
  const limit = await rateLimit(req, signed ? 'track-link' : 'track-lookup', signed ? { max: 60, windowMs: 10 * 60_000 } : { max: 12, windowMs: 10 * 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: 'too_many', message: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  try {
    const track = signed ? await trackBySignedLink(body.o!, body.t!) : await trackByNumber({ number: body.number, contact: body.contact });
    return Response.json({ track });
  } catch (e) {
    const { status, body: payload } = httpError(e);
    return Response.json(payload, { status });
  }
}
