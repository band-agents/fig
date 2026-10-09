import Link from 'next/link';
import { ArrowRight, CheckCircle2, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { Insight } from '@/lib/insights';

const TONE = {
  critical: { icon: CircleAlert, cls: 'text-critical', bar: 'bg-[var(--critical)]', label: 'Act now' },
  warn: { icon: TriangleAlert, cls: 'text-[var(--warn)]', bar: 'bg-[var(--warn)]', label: 'Watch' },
  info: { icon: Info, cls: 'text-[var(--t-blue)]', bar: 'bg-[var(--t-blue)]', label: 'Note' },
  good: { icon: CheckCircle2, cls: 'text-good', bar: 'bg-[var(--good)]', label: 'Good' },
} as const;

export function InsightCards({ items }: { items: Insight[] }) {
  return (
    <ul className="divide-y divide-[var(--line)]">
      {items.map((it, i) => {
        const t = TONE[it.severity];
        const Icon = t.icon;
        return (
          <li key={it.key} className="rise relative" style={{ animationDelay: `${i * 50}ms` }}>
            <span className={`absolute left-0 top-4 h-[calc(100%-32px)] w-[2px] rounded-full ${t.bar} opacity-70`} />
            <div className="flex gap-3 py-4 pl-4 pr-1">
              <Icon className={`mt-0.5 size-4 shrink-0 ${t.cls}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`font-medium uppercase tracking-[0.07em] ${t.cls}`}>{t.label}</span>
                  <span className="text-ink-4">·</span>
                  <span className="uppercase tracking-[0.07em] text-ink-3">{it.kicker}</span>
                </div>
                <div className="mt-1 text-[14px] font-medium leading-snug">{it.title}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{it.body}</p>
                {it.href && (
                  <Link href={it.href} className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-ink hover:underline">
                    {it.action ?? 'Open'} <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
