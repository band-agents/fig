import { randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const N = 16384, r = 8, p = 1, LEN = 32;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, LEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [algo, n, rr, pp, salt, key] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n), r: Number(rr), p: Number(pp) });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function passwordProblem(pw: string) {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Mix letters and numbers.';
  return null;
}

/** A password people can read out: no look-alikes, in three groups of four, always letters and numbers. */
export function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY34679';
  const pick = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join('');
  // 24 Oct: about one in four came out with no digit, failed passwordProblem, and that teammate was not added
  for (;;) {
    const pw = `${pick()}-${pick()}-${pick()}`;
    if (!passwordProblem(pw)) return pw;
  }
}
