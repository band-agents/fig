import { sql } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb, schema } from '@/lib/db';
import { currentUser } from '@/lib/auth/session';
import { GOOGLE_ERRORS, googleMode } from '@/lib/auth/google';
import { BrandFull } from '@/components/brand';
import { GoogleG } from '@/components/google-g';
import { LoginForm } from './forms';

export const metadata = { title: 'Staff sign in' };

export default async function LoginPage(props: PageProps<'/login'>) {
  if (await currentUser()) redirect('/');
  const sp = await props.searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '/';
  const error = typeof sp.error === 'string' ? GOOGLE_ERRORS[sp.error] : undefined;
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(sql`password_hash is not null`);
  const setup = n === 0;
  const google = !setup && googleMode() !== 'off';

  // the Ghattas sign-in: the logo, the form, nothing else
  return (
    <main className="flex min-h-dvh flex-col px-5 py-8">
      <Link href="/" className="inline-flex items-center gap-1.5 self-start text-[12px] text-ink-3 transition hover:text-ink">
        <ArrowLeft className="size-3.5" /> Home
      </Link>
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
        <div className="mb-9 flex justify-center">
          <BrandFull height={42} />
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-[17px] font-semibold">{setup ? 'Set up the console' : 'Staff sign in'}</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">{setup ? 'Create the owner account. You can invite every department after.' : 'Orders, returns, stock and buying, in one place.'}</p>
        </div>
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-line-2 bg-elev px-3 py-2 text-[12.5px] text-critical">
            {error}
          </p>
        )}
        {google && (
          <>
            <a href={`/api/auth/google?next=${encodeURIComponent(next)}`} className="btn btn-quiet btn-lg w-full">
              <GoogleG />
              Continue with Google
            </a>
            <div className="my-5 flex items-center gap-3 text-[11.5px] text-ink-4">
              <span className="h-px flex-1 bg-line" />
              or with your password
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        <LoginForm next={next} setup={setup} />
      </div>
      <p className="text-center text-[11.5px] text-ink-4">D&amp;H International · D&amp;Co International · Kuwait</p>
    </main>
  );
}
