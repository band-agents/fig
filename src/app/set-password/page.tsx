import { redirect } from 'next/navigation';
import { realUser } from '@/lib/auth/session';
import { landingFor } from '@/lib/domain/perms';
import { BrandFull } from '@/components/brand';
import { SetPasswordForm } from './form';

export const metadata = { title: 'Choose your password' };

/** The first sign-in with a temporary password: nothing else opens until they choose their own. */
export default async function SetPasswordPage() {
  const u = await realUser();
  if (!u) redirect('/login');
  if (!u.mustChangePassword) redirect(landingFor({ role: u.role, scopes: u.scopes }) ?? '/');
  return (
    <main className="flex min-h-dvh flex-col px-5 py-8">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
        <div className="mb-9 flex justify-center">
          <BrandFull height={42} />
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-[17px] font-semibold">Welcome, {u.name.split(' ')[0]}</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">You signed in with a temporary password. Choose your own to continue; only you will know it.</p>
        </div>
        <SetPasswordForm email={u.email} />
      </div>
    </main>
  );
}
