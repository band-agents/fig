'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Check, ChevronDown, Loader2, Megaphone, X } from 'lucide-react';
import { KIND } from './rec-meta';
import { acceptRecAction, dismissRecAction } from '@/app/(console)/stock/actions';
import { toast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { useNow } from '@/lib/hooks';
import { ago } from '@/lib/format';
import { SitePreview } from './site-preview';

export type Rec = {
  id: string;
  kind: string;
  area: string;
  market: string;
  title: string;
  body: string;
  reasons: { label: string; value?: string; tone?: 'good' | 'bad' | 'neutral' }[];
  impact: number;
  impactLabel: string | null;
  confidence: number;
  priority: number;
  createdAt: string;
  canAct: boolean;
  product: { id: string; title: string; image: string | null; brand: string } | null;
  images: string[];
  items: { id: string; title: string; brand: string; image: string | null; price: string; category: string }[];
  anchors: { id: string; title: string; brand: string; image: string | null; price: string; category: string }[];
  payload: Record<string, unknown>;
};


const MERCH = ['cross_sell', 'upsell', 'popup', 'bundle'];

export function Confidence({ value }: { value: number }) {
  const steps = 5;
  const on = Math.round((value / 100) * steps);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3" title="Confidence: higher for styles that sell steadily, lower for new or lumpy ones">
      <span className="flex gap-[2px]">
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={`h-2.5 w-[5px] rounded-[1.5px] ${i < on ? 'bg-ink-2' : 'bg-line-2'}`} />
        ))}
      </span>
      {value}%
    </span>
  );
}

export function RecCard({ rec, publishLevel, channelNames, dense = false, onDone }: { rec: Rec; publishLevel?: number; channelNames?: Record<string, string>; dense?: boolean; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [gone, setGone] = useState(false);
  const now = useNow();
  const k = KIND[rec.kind] ?? KIND.reorder;
  const Icon = k.icon;
  const merch = MERCH.includes(rec.kind);
  const verb = merch && (publishLevel ?? 0) < 3 ? 'Propose for publishing' : k.verb;

  const accept = () => {
    if (merch && (publishLevel ?? 0) >= 3) return setPublishing(true);
    start(async () => {
      const r = await acceptRecAction(rec.id, merch ? { publish: false } : {});
      if (r.ok) {
        toast(r.message ?? 'Done');
        setGone(true);
        onDone?.();
      } else toast(r.error, { tone: 'error' });
    });
  };
  const dismiss = (reason: string) =>
    start(async () => {
      const r = await dismissRecAction(rec.id, reason);
      setOpen(false);
      if (r.ok) {
        toast('Dismissed');
        setGone(true);
      } else toast(r.error, { tone: 'error' });
    });

  if (gone) return null;
  return (
    <article className="group relative rounded-2xl border border-line bg-elev p-4 shadow-[var(--hi)] transition hover:border-line-2 hover:shadow-[var(--shadow)]" data-tint={k.tint}>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="pill !h-[21px] !gap-1.5 !px-2">
          <Icon className="size-3 text-[var(--tint)]" strokeWidth={2} />
          {k.label}
        </span>
        <span className="text-ink-3">{rec.market === 'EG' ? 'Egypt' : 'Kuwait'}</span>
        {rec.priority === 1 && (
          <span className="pill" data-tint="red">
            Act today
          </span>
        )}
        {rec.impactLabel && <span className="ml-auto truncate pl-2 text-right text-[11.5px] font-medium text-ink">{rec.impactLabel}</span>}
      </div>

      <div className="mt-3 flex gap-3.5">
        {rec.images.length > 0 && (
          <div className="relative h-[72px] shrink-0" style={{ width: 54 + Math.min(2, rec.images.length - 1) * 14 }}>
            {rec.images.slice(0, 3).map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="absolute top-0 h-[72px] w-[54px] rounded-lg object-cover shadow-[0_0_0_2px_var(--bg-elev)]" style={{ left: i * 14, zIndex: 3 - i, transform: i ? `scale(${1 - i * 0.08})` : undefined }} />
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-medium leading-snug">
            {rec.product && !merch ? (
              <Link href={`/stock/inventory/${rec.product.id}`} className="hover:underline">
                {rec.title}
              </Link>
            ) : (
              rec.title
            )}
          </h3>
          {rec.product && !merch && (
            <div className="mt-0.5 text-[11.5px] text-ink-3">
              {rec.product.brand}
            </div>
          )}
        </div>
      </div>

      {rec.reasons.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${dense ? 'mt-2' : 'mt-3'}`}>
          {rec.reasons.map((r) => (
            <span key={r.label} className="inline-flex items-center gap-1 rounded-md bg-elev-2 px-2 py-1 text-[11px] text-ink-3">
              {r.label}
              <b className={`font-mono font-medium ${r.tone === 'bad' ? 'text-critical' : r.tone === 'good' ? 'text-good' : 'text-ink'}`}>{r.value}</b>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <Confidence value={rec.confidence} />
        <span className="text-[11px] text-ink-4" suppressHydrationWarning>
          {now ? `raised ${ago(rec.createdAt, new Date(now))}` : ''}
        </span>
        {rec.canAct ? (
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <button onClick={() => setOpen(!open)} disabled={pending} className="btn btn-ghost btn-sm">
                Not now <ChevronDown className="size-3.5" />
              </button>
              {open && (
                <div className="rise absolute bottom-10 right-0 z-20 w-60 overflow-hidden rounded-xl border border-line-2 bg-elev-2 p-1 shadow-[var(--shadow-lg)]">
                  <div className="px-2.5 py-1.5 text-[11.5px] font-medium text-ink-3">Why not?</div>
                  {['Already handled', 'Supplier can’t do it', 'Brand won’t allow it', 'The numbers look wrong', 'Not this season'].map((r) => (
                    <button key={r} onClick={() => dismiss(r)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:bg-elev-3 hover:text-ink">
                      <X className="size-3.5 text-ink-4" /> {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={accept} disabled={pending} className="btn btn-primary btn-sm">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {verb}
            </button>
          </div>
        ) : (
          <span className="ml-auto text-[11px] text-ink-4">For {k.team.toLowerCase()} to decide</span>
        )}
      </div>

      {publishing && <PublishModal rec={rec} channelNames={channelNames ?? {}} onClose={() => setPublishing(false)} onDone={() => { setPublishing(false); setGone(true); onDone?.(); }} />}
    </article>
  );
}

function PublishModal({ rec, channelNames, onClose, onDone }: { rec: Rec; channelNames: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const p = rec.payload;
  const [channels, setChannels] = useState<string[]>((p.channels as string[]) ?? []);
  const [headline, setHeadline] = useState(String(p.headline ?? 'You may also like'));
  const [headlineAr, setHeadlineAr] = useState(String(p.headlineAr ?? ''));
  const [offer, setOffer] = useState(String(p.offer ?? ''));
  const [pending, start] = useTransition();
  const all = [...new Set([...((p.channels as string[]) ?? [])])];
  const site = channelNames[channels[0] ?? all[0]] ?? 'Website';
  return (
    <Modal title="Publish to the website" sub="It goes live on the storefronts you tick, through the embed already on their product pages. You can pause it at any time." onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
        <SitePreview kind={rec.kind} site={site} anchor={rec.anchors[0] ?? null} items={rec.items} headline={headline} headlineAr={headlineAr} offer={offer || null} compact />
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs text-ink-3">Where</div>
            <div className="flex flex-wrap gap-1.5">
              {all.map((c) => (
                <label key={c} className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[12px] ${channels.includes(c) ? 'border-ink bg-elev-3' : 'border-line-2 text-ink-2'}`}>
                  <input type="checkbox" className="accent-[var(--ink)]" checked={channels.includes(c)} onChange={(e) => setChannels((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))} />
                  {channelNames[c] ?? c}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Headline</span>
            <input className="field" value={headline} maxLength={60} onChange={(e) => setHeadline(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-3">Headline in Arabic</span>
            <input className="field text-right" dir="rtl" value={headlineAr} maxLength={60} onChange={(e) => setHeadlineAr(e.target.value)} />
          </label>
          {rec.kind === 'popup' && (
            <label className="block">
              <span className="mb-1 block text-xs text-ink-3">Offer line (optional)</span>
              <input className="field" value={offer} maxLength={40} placeholder="e.g. Up to 40% off" onChange={(e) => setOffer(e.target.value)} />
            </label>
          )}
          <p className="text-[11.5px] text-ink-3">
            {rec.kind === 'popup' ? 'Shown once a session to returning visitors.' : `Shown on ${rec.anchors.length} product page${rec.anchors.length === 1 ? '' : 's'}: ${rec.anchors.map((a) => a.title).join(', ')}.`}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              disabled={pending || !channels.length || !headline.trim()}
              onClick={() =>
                start(async () => {
                  const r = await acceptRecAction(rec.id, { publish: true, channels, headline: headline.trim(), headlineAr: headlineAr.trim(), offer: offer.trim() || undefined });
                  if (r.ok) {
                    toast(r.message ?? 'Published');
                    onDone();
                  } else toast(r.error, { tone: 'error' });
                })
              }
              className="btn btn-primary"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}
              Publish now
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
