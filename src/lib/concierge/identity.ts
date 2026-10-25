import { createHmac, timingSafeEqual } from 'node:crypto';
import { normaliseEmail } from '../domain/contact';

/**
 * A customer signed in on the storefront, as the theme vouches for them.
 *
 * The theme signs "<email>:<customer id>" with a secret only it and Relay hold, using Liquid's own
 * filter — {{ customer.email | downcase | append: ':' | append: customer.id | hmac_sha256: SECRET }}
 * — so a shopper cannot claim to be someone else by editing what the page sends. Without the
 * secret set, nobody is treated as signed in.
 */
export type Identity = { email: string; customerId: string };

/**
 * Checks the theme's signature over "<email>:<customer id>".
 * Liquid: {{ customer.email | downcase | append: ':' | append: customer.id | hmac_sha256: SECRET }}
 */
export function verifyCustomer(
  input: { email?: string; id?: string | number; sig?: string } | null | undefined,
  secret = process.env.CONCIERGE_LABESNY_SECRET,
): Identity | null {
  if (!secret || !input?.email || !input.id || !input.sig) return null;
  const email = normaliseEmail(String(input.email));
  const id = String(input.id).trim();
  const expected = createHmac('sha256', secret).update(`${email}:${id}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(String(input.sig).trim(), 'hex');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { email, customerId: id };
}

