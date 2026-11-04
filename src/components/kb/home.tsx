'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpenText, Camera, FileText, Gavel, ListChecks, MessageSquareQuote, Search, X } from 'lucide-react';
import type { BrandKey, Card, Decision, SectionKey } from '@/lib/kb';
import { BRANDS, KINDS, SECTIONS } from '@/lib/kb';
import { KB_ICON, tintVar } from './icons';
import { Highlight, shortDate } from './bits';

type Props = { cards: Card[]; decisions: Decision[]; templates: number };

const BRAND_ORDER: BrandKey[] = ['all', 'fig', 'labesny', 'womensecret'];

/** How well an article answers the words typed: every word must be found, the title counts most. */
function score(c: Card, words: string[]) {
  let s = 0;
  for (const w of words) {
    const t = c.title.toLowerCase().includes(w) ? 6 : 0;
    const h = c.head.includes(w) ? 3 : 0;
    const b = c.body.includes(w) ? 1 : 0;
    if (!t && !h && !b) return 0;
    s += t + h + b;
  }
  return s;
}

export function KbHome({ cards, decisions, templates }: Props) {
  const [q, setQ] = useState('');
  const [section, setSection] = useState<SectionKey | null>(null);
  const [brand, setBrand] = useState<BrandKey>('all');
  const box = useRef<HTMLInputElement>(null);

  // "/" jumps to the search from anywhere on the page
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        box.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const words = useMemo(() => q.toLowerCase().split(/\s+/).filter((w) => w.length > 1), [q]);
  const fits = (c: Card) => (brand === 'all' || c.brands.includes(brand) || c.brands.includes('all')) && (!section || c.section === section);
  const list = useMemo(() => {
    const base = cards.filter(fits);
    if (!words.length) return base;
    return base
      .map((c) => ({ c, s: score(c, words) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, words, section, brand]);

  const counts = useMemo(() => {
    const m: Partial<Record<SectionKey, number>> = {};
    for (const c of cards) if (brand === 'all' || c.brands.includes(brand) || c.brands.includes('all')) m[c.section] = (m[c.section] ?? 0) + 1;
    return m;
  }, [cards, brand]);

  const searching = words.length > 0 || section !== null;
  const sops = cards.filter((c) => c.kind === 'sop').length;
  const policies = cards.filter((c) => c.kind === 'policy').length;
  const shots = cards.reduce((n, c) => n + c.shots, 0);

  return (
    <div className="space-y-6">
      <section className="kb-hero px-5 py-7 sm:px-9 sm:py-10">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.14em] text-ink-3">
          <BookOpenText className="size-4" style={{ color: 'var(--t-violet)' }} /> DH Playbook
        </div>
        <h1 className="mt-3 max-w-2xl text-[28px] font-semibold leading-[1.1] tracking-[-0.6px] sm:text-[40px]">
          How we run FIG, Labesny and Women&apos;secret, <span className="text-ink-3">in one place.</span>
        </h1>
        <p className="mt-3 max-w-xl text-[14px] text-ink-3">Every SOP, policy, decision and ready reply. Search it, follow the steps, copy the answer.</p>

        <label className="kb-search mt-6 max-w-2xl">
          <Search className="size-[18px] text-ink-3" />
          <input ref={box} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: return, COD, Bosta, sale rule, store credit, رد..." aria-label="Search the Playbook" />
          {q ? (
            <button onClick={() => setQ('')} aria-label="Clear" className="text-ink-3 hover:text-ink">
              <X className="size-4" />
            </button>
          ) : (
            <span className="kb-kbd">/</span>
          )}
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="kb-seg" role="tablist" aria-label="Brand">
            {BRAND_ORDER.map((b) => (
              <button key={b} data-on={brand === b ? '1' : '0'} onClick={() => setBrand(b)}>
                {b !== 'all' && <span className="size-2 rounded-full" style={{ background: BRANDS[b].color }} />}
                {BRANDS[b].short}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
            <Stat icon={ListChecks} n={sops} label="SOPs" />
            <Stat icon={Gavel} n={policies} label="policies" />
            <Stat icon={MessageSquareQuote} n={templates} label="ready replies" href="/kb/templates" />
            <Stat icon={FileText} n={decisions.length} label="decisions" href="/kb/decisions" />
            {shots > 0 && <Stat icon={Camera} n={shots} label="annotated screens" />}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {SECTIONS.map((s) => {
          const Icon = KB_ICON[s.icon];
          const on = section === s.key;
          const n = counts[s.key] ?? 0;
          return (
            <button key={s.key} className="kb-tile" data-on={on ? '1' : '0'} style={{ '--tint': tintVar(s.tint) } as React.CSSProperties} onClick={() => setSection(on ? null : s.key)} aria-pressed={on}>
              <div className="flex items-start justify-between gap-2">
                <span className="kb-ico">{Icon && <Icon className="size-[18px]" />}</span>
                <span className="font-mono text-[12px] text-ink-4">{n}</span>
              </div>
              <div>
                <div className="text-[14px] font-semibold">{s.label}</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">{s.blurb}</div>
              </div>
            </button>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-[15px] font-semibold">
              {words.length ? `${list.length} result${list.length === 1 ? '' : 's'} for “${q.trim()}”` : section ? SECTIONS.find((s) => s.key === section)?.label : 'All articles'}
            </h2>
            {searching && (
              <button
                className="text-[12.5px] text-ink-3 hover:text-ink"
                onClick={() => {
                  setQ('');
                  setSection(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <div className="panel px-6 py-12 text-center text-[13px] text-ink-3">Nothing yet for that. Try a shorter word, or ask in the team chat and we will add it.</div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {(searching ? list : list.slice().sort((a, b) => SECTIONS.findIndex((s) => s.key === a.section) - SECTIONS.findIndex((s) => s.key === b.section))).map((c) => (
                <ArticleCard key={c.slug} c={c} words={words} />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13.5px] font-semibold">Latest decisions</h3>
              <Link href="/kb/decisions" className="text-[12px] text-ink-3 hover:text-ink">
                All <ArrowRight className="inline size-3" />
              </Link>
            </div>
            <ol className="space-y-3">
              {decisions.slice(0, 7).map((d, i) => (
                <li key={i} className="grid grid-cols-[46px_1fr] gap-2 text-[12.5px]">
                  <span className="pt-px font-mono text-[11px] text-ink-4">{shortDate(d.date)}</span>
                  <span>
                    {d.article ? (
                      <Link href={`/kb/${d.article}`} className="font-medium hover:underline">
                        {d.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{d.title}</span>
                    )}
                    <span className="block text-ink-3">{d.who}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <Link href="/kb/templates" className="kb-tile" style={{ '--tint': tintVar('green') } as React.CSSProperties}>
            <span className="kb-ico">
              <MessageSquareQuote className="size-[18px]" />
            </span>
            <div>
              <div className="text-[14px] font-semibold">Ready responses</div>
              <div className="text-[12px] text-ink-3">{templates} replies in English and Arabic, one click to copy.</div>
            </div>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, n, label, href }: { icon: typeof ListChecks; n: number; label: string; href?: string }) {
  const body = (
    <>
      <Icon className="size-3.5" /> <b className="font-semibold text-ink">{n}</b> {label}
    </>
  );
  return href ? (
    <Link href={href} className="inline-flex items-center gap-1.5 hover:text-ink">
      {body}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1.5">{body}</span>
  );
}

function ArticleCard({ c, words }: { c: Card; words: string[] }) {
  const s = SECTIONS.find((x) => x.key === c.section)!;
  return (
    <Link href={`/kb/${c.slug}`} className="kb-card group">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="pill" data-tint={c.kind === 'policy' ? 'red' : c.kind === 'sop' ? 'violet' : c.kind === 'faq' ? 'amber' : 'blue'}>
          {KINDS[c.kind]}
        </span>
        <span className="text-[11.5px] text-ink-3">{s.label}</span>
        <span className="ml-auto flex items-center gap-1">
          {c.brands.filter((b) => b !== 'all').map((b) => (
            <span key={b} title={BRANDS[b].label} className="size-2 rounded-full" style={{ background: BRANDS[b].color }} />
          ))}
        </span>
      </div>
      <div className="text-[14px] font-semibold leading-snug">
        <Highlight text={c.title} words={words} />
      </div>
      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink-3">
        <Highlight text={c.summary} words={words} />
      </p>
      <div className="mt-2.5 flex gap-3 text-[11.5px] text-ink-4">
        {c.steps > 0 && <span>{c.steps} steps</span>}
        {c.templates > 0 && <span>{c.templates} replies</span>}
        {c.shots > 0 && <span>{c.shots} screens</span>}
        <span className="ml-auto opacity-0 transition group-hover:opacity-100">
          Open <ArrowRight className="inline size-3" />
        </span>
      </div>
    </Link>
  );
}

