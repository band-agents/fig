/**
 * How a customer's own words become something to match an order against.
 *
 * The returns portal asks for an order number and the email or phone the order was placed with.
 * None of the three arrives in the form it was stored: numbers are typed with the hash and with
 * spaces, emails in any case, phones in whatever shape the customer remembers.
 */

/** Order numbers get typed with the hash, with spaces, in any case. */
export const normaliseOrderNumber = (s: string) => s.trim().replace(/^#/, '').replace(/\s+/g, '').toLowerCase();

export const normaliseEmail = (s: string) => s.trim().toLowerCase();

/** Whichever of the two the customer typed. `@` is the only reliable tell. */
export const looksLikeEmail = (s: string) => s.includes('@');

/**
 * The comparable tail of a phone number, or null if too little was typed to compare.
 *
 * Orders are stored in international form (`+201165251497`, `+96560016286`) and customers type
 * what they know: the national number, with or without its leading zero, with or without the
 * country code, with spaces or dashes. The last eight digits are the most two of those forms are
 * guaranteed to share — Kuwaiti numbers are eight digits long, so nothing longer can be required
 * of them.
 *
 * Eight digits is a weaker match than an email, which is why the portal asks for the email first.
 * It is paired with the order number, so a near-miss has to coincide with the right order to reach
 * anything at all.
 */
export function phoneTail(s: string): string | null {
  const digits = s.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
}
