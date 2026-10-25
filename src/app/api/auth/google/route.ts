import { NextResponse, type NextRequest } from 'next/server';
import { authUrl, googleMode, NEXT_COOKIE, newState, safeNext, STATE_COOKIE } from '@/lib/auth/google';

/** "Continue with Google": remember where the person was going, then hand them to Google's account chooser. */
export function GET(req: NextRequest) {
  if (googleMode() === 'off') return NextResponse.redirect(new URL('/login', req.url));
  const state = newState();
  const res = NextResponse.redirect(authUrl(req.url, state));
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 };
  res.cookies.set(STATE_COOKIE, state, cookie);
  res.cookies.set(NEXT_COOKIE, safeNext(req.nextUrl.searchParams.get('next')), cookie);
  return res;
}
