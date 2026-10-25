'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, ExternalLink, Loader2, Pause, Play, Square } from 'lucide-react';
import { editPlacementAction, setPlacementAction } from '@/app/(console)/stock/actions';
import { toast } from '@/components/ui/toast';
import { Sparkline } from '@/components/charts/charts';
import { SitePreview } from './site-preview';

type Piece = { id: string; title: string; brand: string; image: string | null; price: string };
export type PlacementView = {
  id: string;
  number: string;
  kind: string;
  kindLabel: string;
  where: string;
  status: string;
  channels: { id: string; label: string }[];
  headline: string;
  headlineAr: string | null;
  offer: string | null;
  items: Piece[];
  anchors: Piece[];
  startsAt: string | null;
  approvedByName: string | null;
  stats: { impressions: number; clicks: number; adds: number; orders: number; revenue: number | null; ctr: number | null; addRate: number | null; spark: number[] };
};

const TINT: Record<string, string> = { live: 'green', paused: 'amber', draft: 'neutral', ended: 'neutral' };
const n = (v: number) => new Intl.NumberFormat('en').format(v);
const p = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

export function PlacementCard({ pl, level, seesMoney }: { pl: PlacementView; level: number; seesMoney: boolean }) {
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [headline, setHeadline] = useState(pl.headline);
  const [headlineAr, setHeadlineAr] = useState(pl.headlineAr ?? '');
  const go = (to: 'live' | 'paused' | 'ended') =>
    start(async () => {
      const r = await setPlacementAction(pl.id, to);
      if (r.ok) toast(r.message ?? 'Done');
      else toast(r.error, { tone: 'error' });
    });
  return (
    <article className={`panel overflow-hidden ${pl.status === 'ended' ? 'opacity-70' : ''}`}>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <SitePreview kind={pl.kind} site={pl.channels[0]?.label ?? 'Website'} anchor={pl.anchors[0] ?? null} items={pl.items} headline={pl.headline} headlineAr={pl.headlineAr} offer={pl.offer} compact />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="pill" data-tint={TINT[pl.status] ?? 'neutral'}>
              <span className="dot" />
              {pl.status === 'live' ? 'Live' : pl.status === 'paused' ? 'Paused' : pl.status === 'draft' ? 'Waiting to publish' : 'Ended'}
            </span>
            <span className="font-mono text-ink-3">{pl.number}</span>
            <span className="text-ink-3">{pl.kindLabel}</span>
          </div>
          {edit ? (
            <div className="mt-2 space-y-2">
              <input className="field" value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} />
              <input className="field text-right" dir="rtl" value={headlineAr} maxLength={60} onChange={(e) => setHeadlineAr(e.target.value)} />
              <div className="flex gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await editPlacementAction(pl.id, { headline, headlineAr });
                      if (r.ok) {
                        toast('Saved');
                        setEdit(false);
                      } else toast(r.error, { tone: 'error' });
                    })
                  }
                >
                  <Check className="size-3.5" /> Save
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <h3 className="mt-2 text-[15px] font-medium leading-snug">
              “{pl.headline}”{pl.headlineAr && <span className="ml-2 text-[13px] font-normal text-ink-3">{pl.headlineAr}</span>}
            </h3>
          )}
          <p className="mt-1 text-[12px] text-ink-3">
            {pl.where} on {pl.channels.map((c) => c.label).join(', ')}
            {pl.anchors.length ? `, under ${pl.anchors.length} style${pl.anchors.length > 1 ? 's' : ''}` : ''}.{pl.approvedByName ? ` Published by ${pl.approvedByName}.` : ''}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[
              { l: 'Seen', v: n(pl.stats.impressions) },
              { l: 'Clicked', v: n(pl.stats.clicks), s: p(pl.stats.ctr) },
              { l: 'Added', v: n(pl.stats.adds), s: p(pl.stats.addRate) },
              { l: 'Orders', v: n(pl.stats.orders) },
              ...(seesMoney && pl.stats.revenue != null ? [{ l: 'Sales', v: `EGP ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(pl.stats.revenue / 100)}` }] : []),
            ].map((x) => (
              <div key={x.l} className="rounded-lg bg-elev-2 px-2.5 py-2">
                <div className="text-[11px] text-ink-3">{x.l}</div>
                <div className="font-mono text-[13px]">{x.v}</div>
                {'s' in x && x.s && <div className="text-[10.5px] text-ink-4">{x.s}</div>}
              </div>
            ))}
          </div>
          {pl.stats.spark.length > 2 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] text-ink-4">Clicks a day</div>
              <Sparkline data={pl.stats.spark} color="var(--s3)" height={30} />
            </div>
          )}
          {level >= 2 && pl.status !== 'ended' && (
            <div className="mt-4 flex flex-wrap gap-2">
              {pl.status === 'live' && (
                <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => go('paused')}>
                  <Pause className="size-3.5" /> Pause
                </button>
              )}
              {(pl.status === 'paused' || pl.status === 'draft') && level >= 3 && (
                <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => go('live')}>
                  {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {pl.status === 'draft' ? 'Publish' : 'Resume'}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>
                Edit the words
              </button>
              <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => confirm('End this placement? It comes off the websites at once.') && go('ended')}>
                <Square className="size-3.5" /> End
              </button>
              {pl.status === 'live' && pl.channels[0] && (
                <a className="btn btn-ghost btn-sm" href={`/merch/preview?store=${pl.channels[0].id}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> See it live
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function CopySnippet({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-inset px-2.5 py-1.5 font-mono text-[11px] text-ink-2">{text}</code>
      <button
        className="btn btn-ghost btn-sm !px-2"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
