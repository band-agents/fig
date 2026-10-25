import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { ROLES, type Role } from '@/lib/domain/perms';
import { BrandLockup } from '@/components/brand';
import { JoinForm } from './form';

export const metadata = { title: 'Join' };

export default async function JoinPage(props: PageProps<'/join'>) {
  const sp = await props.searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';
  const db = await getDb();
  const [inv] = token ? await db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, createHash('sha256').update(token).digest('hex'))) : [];
  const valid = inv && !inv.acceptedAt && inv.expiresAt > new Date();
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-[400px]">
        <div className="mb-10 flex items-center gap-2">
          <BrandLockup height={20} />
        </div>
        {valid ? (
          <>
            <h1 className="font-display text-[20px] leading-tight">
              Welcome, {inv.name?.split(' ')[0] ?? 'friend'}
              
            </h1>
            <p className="mt-3 text-ink-2">
              You’re joining as <b className="font-medium text-ink">{ROLES[inv.role as Role]?.label}</b>. {ROLES[inv.role as Role]?.blurb} Choose a password to finish.
            </p>
            <div className="mt-8">
              <JoinForm token={token} email={inv.email} />
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-[20px] leading-tight">This link has expired.</h1>
            <p className="mt-3 text-ink-2">Join links work once and last seven days. Ask whoever invited you to send a new one.</p>
          </>
        )}
      </div>
    </main>
  );
}
