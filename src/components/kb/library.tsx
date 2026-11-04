'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import type { BrandKey, SectionKey, Template } from '@/lib/kb/types';
import { BRANDS, SECTIONS } from '@/lib/kb';
import { Reply } from './reply';

type Item = Template & { id: string; slug: string; article: string; section: SectionKey; brands: BrandKey[] };

/** Every ready reply, searchable, by brand, channel and language. */
export function ReplyLibrary({ items }: { items: Item[] }) {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<BrandKey>('all');
  const [lang, setLang] = useState<'all' | 'en' | 'ar'>('all');
  const [channel, setChannel] = useState<string>('all');

  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const list = useMemo(
    () =>
      items.filter((t) => {
        if (brand !== 'all' && !t.brands.includes(brand) && !t.brands.includes('all')) return false;
        if (lang !== 'all' && t.lang !== lang) return false;
        if (channel !== 'all' && t.channel !== channel && t.channel !== 'any') return false;
        const hay = `${t.name} ${t.body} ${t.article}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    [items, brand, lang, channel, words],
  );
  const groups = SECTIONS.map((s) => ({ s, list: list.filter((t) => t.section === s.key) })).filter((g) => g.list.length);

  return (
    <div>
      <Link href="/kb" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Playbook
      </Link>
      <header className="kb-hero mb-6 px-5 py-6 sm:px-8 sm:py-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] sm:text-[34px]">Ready responses</h1>
        <p className="mt-2 max-w-xl text-[14.5px] text-ink-3">{items.length} replies the team uses every day. Find one, fill the purple blanks, copy, send.</p>
        <label className="kb-search mt-5 max-w-2xl">
          <Search className="size-[18px] text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: late order, refund, size, تأخير..." aria-label="Search replies" />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear" className="text-ink-3">
              <X className="size-4" />
            </button>
          )}
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="kb-seg">
            {(['all', 'fig', 'labesny', 'womensecret'] as BrandKey[]).map((b) => (
              <button key={b} data-on={brand === b ? '1' : '0'} onClick={() => setBrand(b)}>
                {b !== 'all' && <span className="size-2 rounded-full" style={{ background: BRANDS[b].color }} />}
                {BRANDS[b].short}
              </button>
            ))}
          </div>
          <div className="kb-seg">
            {(['all', 'en', 'ar'] as const).map((l) => (
              <button key={l} data-on={lang === l ? '1' : '0'} onClick={() => setLang(l)}>
                {l === 'all' ? 'Any language' : l === 'en' ? 'English' : 'عربي'}
              </button>
            ))}
          </div>
          <div className="kb-seg">
            {['all', 'whatsapp', 'email', 'instagram', 'phone'].map((c) => (
              <button key={c} data-on={channel === c ? '1' : '0'} onClick={() => setChannel(c)}>
                {c === 'all' ? 'Any channel' : c === 'whatsapp' ? 'WhatsApp' : c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {groups.length === 0 && <div className="panel px-6 py-12 text-center text-[13px] text-ink-3">No reply fits. Clear a filter or try another word.</div>}
      {groups.map(({ s, list: l }) => (
        <section key={s.key} className="mb-8">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-4">
            {s.label} · {l.length}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {l.map((t) => (
              <Reply key={t.id} t={t} from={{ title: t.article, href: `/kb/${t.slug}` }} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
