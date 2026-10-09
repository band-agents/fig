import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/lib/db';
import { currentUser } from '@/lib/auth/session';
import { demoMode } from '@/lib/demo';
import { ROLES, type Role } from '@/lib/domain/perms';
import { RelayMark } from '@/components/brand';
import { LoginForm, DemoDoor } from './forms';

export const metadata = { title: 'Sign in' };

export default async function LoginPage(props: PageProps<'/login'>) {
  if (await currentUser()) redirect('/');
  const sp = await props.searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '/';
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(sql`password_hash is not null`);
  const demo = demoMode();
  const staff = demo ? await db.select().from(schema.users).where(sql`email like '%@relay.local' and active = true`).orderBy(schema.users.createdAt) : [];

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-line lg:block">
        <Hero />
      </section>
      <section className="flex min-h-dvh flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center gap-2">
          <RelayMark size={24} />
          <span className="font-display text-2xl">Relay</span>
          <span className="eyebrow ml-1 mt-1">by FIG</span>
        </div>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-[44px] leading-[1.02] tracking-tight">
            {n === 0 && !demo ? 'Set up Relay' : 'Welcome back'}
            <span className="text-signal">.</span>
          </h1>
          <p className="mt-3 text-ink-2">
            {n === 0 && !demo ? 'Create the owner account. You can invite every department after.' : 'Every order and every return, from checkout to cash.'}
          </p>
          <div className="mt-8">
            <LoginForm next={next} setup={n === 0 && !demo} />
          </div>
          {demo && staff.length > 0 && (
            <div className="mt-10">
              <div className="flex items-center gap-3">
                <span className="eyebrow">Demo · enter as a department</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {staff.map((s) => (
                  <DemoDoor key={s.id} email={s.email} name={s.name} role={ROLES[s.role as Role]?.label ?? s.role} title={s.title ?? ''} hue={s.hue} />
                ))}
              </div>
              <p className="mt-4 text-xs text-ink-3">Demo accounts sign in without a password and only exist while demo mode is on. Each one sees exactly what that job would see.</p>
            </div>
          )}
        </div>
        <p className="text-xs text-ink-4">FIG · Women&apos;secret · Labesny</p>
      </section>
    </main>
  );
}

const LANES = [
  { label: 'Placed', tint: 'neutral' },
  { label: 'Customer care', tint: 'violet' },
  { label: 'Finance', tint: 'amber' },
  { label: 'Pick & pack', tint: 'blue' },
  { label: 'Courier', tint: 'cyan' },
  { label: 'Delivered', tint: 'green' },
];

function Hero() {
  return (
    <div className="absolute inset-0 flex flex-col justify-between p-12">
      <div className="eyebrow flex items-center gap-2">
        <span className="live-dot" /> Live across six storefronts
      </div>
      <div>
        <h2 className="font-display text-[clamp(56px,6.4vw,104px)] leading-[0.92] tracking-[-0.02em]">
          Every order,
          <br />
          <em className="text-ink-2">hand to hand.</em>
        </h2>
        <p className="mt-6 max-w-[460px] text-[15px] text-ink-2">
          From the moment a customer checks out on FIG, Women&apos;secret or Labesny, to the moment the cash lands. Each department takes the baton, everyone sees where it is.
        </p>
      </div>
      <svg viewBox="0 0 640 230" className="w-full max-w-[680px]" aria-hidden>
        {LANES.map((l, i) => {
          const x = 30 + i * 116;
          const y = i % 2 ? 150 : 70;
          const nx = 30 + (i + 1) * 116;
          const ny = (i + 1) % 2 ? 150 : 70;
          return (
            <g key={l.label} data-tint={l.tint}>
              {i < LANES.length - 1 && (
                <>
                  <path d={`M${x} ${y} C ${x + 58} ${y}, ${nx - 58} ${ny}, ${nx} ${ny}`} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
                  <path d={`M${x} ${y} C ${x + 58} ${y}, ${nx - 58} ${ny}, ${nx} ${ny}`} fill="none" stroke="var(--tint)" strokeWidth="1.5" className="baton" style={{ animationDelay: `${i * -0.3}s` }} />
                </>
              )}
              <circle cx={x} cy={y} r="7" fill="var(--bg)" stroke="var(--tint)" strokeWidth="2" />
              <circle cx={x} cy={y} r="2.5" fill="var(--tint)" />
              <text x={x} y={i % 2 ? y + 30 : y - 22} textAnchor="middle" fill="var(--ink-2)" fontSize="12" fontFamily="var(--font-geist)">
                {l.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
