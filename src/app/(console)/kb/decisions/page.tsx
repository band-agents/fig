import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { BRANDS, DECISIONS, SECTION_OF } from '@/lib/kb';
import { tintVar } from '@/components/kb/icons';
import { longDate } from '@/components/kb/bits';
import '@/components/kb/kb.css';

export const metadata = { title: 'Decision log' };

// every decision with who made it and why, newest first, grouped by month
export default async function KbDecisions() {
  const me = await requireUser();
  if (!canSee(me, 'kb')) sendHome(me);
  const months = new Map<string, typeof DECISIONS>();
  for (const d of DECISIONS) {
    const k = d.date.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), d]);
  }
  const monthName = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="max-w-[900px]">
      <Link href="/kb" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Playbook
      </Link>
      <header className="kb-hero mb-8 px-5 py-6 sm:px-8 sm:py-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] sm:text-[34px]">Decision log</h1>
        <p className="mt-2 max-w-xl text-[14.5px] text-ink-3">{DECISIONS.length} decisions: what we decided, who decided it, and why. When a rule looks strange, the reason is here.</p>
      </header>
      {[...months].map(([k, list]) => (
        <section key={k} className="mb-10">
          <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-4">{monthName(k)}</h2>
          <ol className="space-y-4 border-l-2 border-line pl-6">
            {list.map((d, i) => {
              const s = SECTION_OF[d.section];
              return (
                <li key={i} className="relative" style={{ '--tint': tintVar(s?.tint ?? 'neutral') } as React.CSSProperties}>
                  <span className="absolute -left-[31px] top-1.5 size-3.5 rounded-full border-[3px] border-[var(--bg)]" style={{ background: 'var(--tint)' }} />
                  <div className="panel p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                      <span className="font-mono">{longDate(d.date)}</span>
                      <span>·</span>
                      <span className="font-medium text-ink-2">{d.who}</span>
                      <span className="pill ml-auto" data-tint={s?.tint ?? 'neutral'}>
                        {s?.label ?? d.section}
                      </span>
                      {d.brands.filter((b) => b !== 'all').map((b) => (
                        <span key={b} title={BRANDS[b].label} className="size-2 rounded-full" style={{ background: BRANDS[b].color }} />
                      ))}
                    </div>
                    <h3 className="mt-2 text-[15px] font-semibold">{d.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{d.decision}</p>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
                      <b className="font-semibold text-ink-2">Why: </b>
                      {d.why}
                    </p>
                    {d.article && (
                      <Link href={`/kb/${d.article}`} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline">
                        Open the SOP <ArrowRight className="size-3" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
