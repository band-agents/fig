import Link from 'next/link';
import { ArrowRight, CircleCheck, Droplets, Info } from 'lucide-react';
import { requireUser, sendHome } from '@/lib/auth/session';
import { canSee } from '@/lib/domain/perms';
import { moneyLeaks, type Leak } from '@/lib/smart/leaks';
import { viewCurrency } from '@/lib/stock/views/common';
import { ago, moneyIn, num } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui/bits';

export const metadata = { title: 'Money leaks' };

// Dan, 28 Oct: the money the business loses each week, by cause, each priced from our own data and
// one click from the screen that fixes it (smart/leaks.ts holds how each is counted).

export default async function LeaksPage() {
  const me = await requireUser();
  if (!canSee(me, 'leaks')) sendHome(me);
  const cur = viewCurrency(me);
  const d = await moneyLeaks(me);
  const m = (v: number) => moneyIn(v, cur, { compact: true });
  const counted = d.leaks.filter((l) => !l.off && l.weekly > 0).sort((a, b) => b.weekly - a.weekly);
  const rest = d.leaks.filter((l) => !counted.includes(l));
  const total = Math.max(1, d.total);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Business" title="Money leaks" sub="What the business loses each week, by cause, and the screen that fixes each one." />

      <section className="panel wv-hero overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
              <Droplets className="size-4 text-[var(--t-rose)]" /> Leaking a week
            </div>
            <div className="mt-1 font-mono text-[44px] font-semibold leading-none tracking-[-1.5px] sm:text-[56px]">≈ {m(d.total)}</div>
            <p className="mt-2 text-[12.5px] text-ink-3">
              About {m(d.total * 4.3)} a month, from {counted.length} cause{counted.length === 1 ? '' : 's'} · worked out {ago(new Date(d.at))}
            </p>
          </div>
          <p className="flex max-w-[420px] items-start gap-2 text-[12px] text-ink-3">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Online money only, for now: the console sees website sales until Lucida’s shop sales come in. Each figure says how it is counted; none is a guess beyond that.
          </p>
        </div>
        {counted.length > 0 && (
          <>
            <div className="wv-bar mt-5" role="img" aria-label="The leaks by cause">
              {counted.map((l) => (
                <a key={l.key} href={`#${l.key}`} className="wv-seg lk-fill" data-leak={l.key} style={{ flexGrow: l.weekly }} title={`${l.label}: ${m(l.weekly)} a week`} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
              {counted.map((l) => (
                <a key={l.key} href={`#${l.key}`} className="flex items-center gap-1.5 text-ink-2 hover:text-ink">
                  <span className="wv-key lk-fill" data-leak={l.key} />
                  {l.short}
                  <span className="font-mono text-ink-4">{Math.round((l.weekly / total) * 100)}%</span>
                </a>
              ))}
            </div>
          </>
        )}
      </section>

      {counted.length === 0 && rest.every((l) => l.off) ? (
        <div className="panel">
          <Empty icon={CircleCheck} title="Nothing is leaking" body="No cause we can measure is costing money right now." />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...counted, ...rest].map((l) => (
            <LeakCard key={l.key} l={l} m={m} share={l.weekly / total} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeakCard({ l, m, share }: { l: Leak; m: (v: number) => string; share: number }) {
  const quiet = Boolean(l.off) || l.weekly <= 0;
  return (
    <section id={l.key} className={`panel flex scroll-mt-24 flex-col overflow-hidden ${quiet ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="wv-key lk-fill" data-leak={l.key} />
            <h2 className="truncate text-[14px]">{l.label}</h2>
          </div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            {l.team}
            {!l.off && ` · ${num(l.count)} ${l.unit}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {l.off ? (
            <span className="pill">Not counted yet</span>
          ) : (
            <>
              <div className="font-mono text-[22px] font-semibold leading-none">≈ {m(l.weekly)}</div>
              <div className="mt-1 text-[11px] text-ink-4">a week{share > 0 ? ` · ${Math.round(share * 100)}%` : ''}</div>
            </>
          )}
        </div>
      </div>

      {l.off ? (
        <p className="px-5 py-4 text-[12.5px] text-ink-2">{l.off}</p>
      ) : l.items.length ? (
        <ul className="mt-3 flex-1 px-2">
          {l.items.slice(0, 6).map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-elev-2">
                {i.image !== undefined &&
                  (i.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.image} alt="" loading="lazy" className="h-10 w-8 shrink-0 rounded-[6px] object-cover" />
                  ) : (
                    <span className="h-10 w-8 shrink-0 rounded-[6px] bg-elev-3" />
                  ))}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{i.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{i.sub}</span>
                </span>
                <span className="shrink-0 font-mono text-[12.5px] font-semibold">{m(i.weekly)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-[12.5px] text-ink-3">Nothing here in the last four weeks.</p>
      )}

      <div className="mt-2 flex flex-col gap-2 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11.5px] leading-snug text-ink-3">{l.basis}</p>
        {!l.off && l.weekly > 0 && (
          <Link href={l.href} className="btn btn-quiet btn-sm shrink-0 self-start sm:self-auto">
            {l.fix} <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </section>
  );
}
