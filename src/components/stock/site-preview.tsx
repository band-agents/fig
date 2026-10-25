'use client';

import { ShoppingBag, X } from 'lucide-react';

// How a placement will look on the storefront: a stand-in product page in the shop's own register
// (white, black, quiet type), with the cross-sell row, the upgrade card or the pop-up drawn the way
// the embed draws them. It is a picture of the result, not the shop itself.

export type PreviewPiece = { id: string; title: string; brand: string; image: string | null; price: string };

const Img = ({ src, className = '' }: { src: string | null; className?: string }) =>
  // eslint-disable-next-line @next/next/no-img-element
  src ? <img src={src} alt="" className={`object-cover ${className}`} /> : <span className={`block bg-neutral-200 ${className}`} />;

export function SitePreview({ kind, site, anchor, items, headline, headlineAr, offer, compact = false }: { kind: string; site: string; anchor?: PreviewPiece | null; items: PreviewPiece[]; headline: string; headlineAr?: string | null; offer?: string | null; compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-2 bg-white text-[#111] shadow-[var(--shadow)]" style={{ fontFamily: 'var(--font-geist), system-ui, sans-serif' }}>
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5">
        <span className="flex gap-1">
          <span className="size-2 rounded-full bg-neutral-300" />
          <span className="size-2 rounded-full bg-neutral-300" />
          <span className="size-2 rounded-full bg-neutral-300" />
        </span>
        <span className="mx-auto truncate rounded-md bg-white px-3 py-0.5 text-[10.5px] text-neutral-500 ring-1 ring-neutral-200">{site}</span>
      </div>
      <div className="relative">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.28em]">{site.split(/[ ·]/)[0]}</span>
          <ShoppingBag className="size-3.5" strokeWidth={1.5} />
        </div>
        {kind === 'popup' ? (
          <div className="relative">
            <div className="grid grid-cols-3 gap-2 p-4 opacity-40 blur-[1px]">
              {Array.from({ length: compact ? 3 : 6 }, (_, i) => (
                <span key={i} className="aspect-[3/4] rounded bg-neutral-200" />
              ))}
            </div>
            <div className="absolute inset-0 grid place-items-center bg-black/25 p-4">
              <div className="w-full max-w-[340px] bg-white p-4 shadow-2xl">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-neutral-500">{offer ?? 'Just for you'}</div>
                    <div className="mt-1 text-[17px] leading-tight" style={{ fontFamily: 'var(--font-instrument), serif' }}>
                      {headline}
                    </div>
                    {headlineAr && (
                      <div dir="rtl" className="mt-0.5 text-[13px] text-neutral-600">
                        {headlineAr}
                      </div>
                    )}
                  </div>
                  <X className="size-3.5 text-neutral-400" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {items.slice(0, 3).map((p) => (
                    <div key={p.id}>
                      <Img src={p.image} className="aspect-[3/4] w-full" />
                      <div className="mt-1 line-clamp-1 text-[9.5px]">{p.title}</div>
                      <div className="text-[9.5px] text-neutral-500">{p.price}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 bg-black py-2 text-center text-[10px] uppercase tracking-[0.22em] text-white">Shop now</div>
              </div>
            </div>
          </div>
        ) : (
          <div className={`grid gap-4 p-4 ${compact ? 'grid-cols-[110px_1fr]' : 'grid-cols-[150px_1fr]'}`}>
            <Img src={anchor?.image ?? null} className="aspect-[3/4] w-full" />
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase tracking-[0.2em] text-neutral-500">{anchor?.brand ?? 'Brand'}</div>
              <div className="mt-1 line-clamp-2 text-[14px] leading-snug" style={{ fontFamily: 'var(--font-instrument), serif' }}>
                {anchor?.title ?? 'A best-selling style'}
              </div>
              <div className="mt-1 text-[12px]">{anchor?.price}</div>
              <div className="mt-2 flex gap-1">
                {['S', 'M', 'L'].map((s) => (
                  <span key={s} className="grid size-6 place-items-center border border-neutral-300 text-[9.5px]">
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-2.5 bg-black py-2 text-center text-[10px] uppercase tracking-[0.22em] text-white">Add to bag</div>
              {kind === 'upsell' && items[0] && (
                <div className="mt-3 flex gap-2.5 border border-neutral-200 p-2">
                  <Img src={items[0].image} className="h-16 w-12 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[9.5px] uppercase tracking-[0.18em] text-neutral-500">{headline}</div>
                    <div className="line-clamp-1 text-[11.5px]">{items[0].title}</div>
                    <div className="text-[11px] text-neutral-600">{items[0].price}</div>
                    <div className="mt-1 text-[9.5px] underline underline-offset-2">Upgrade</div>
                  </div>
                </div>
              )}
            </div>
            {kind !== 'upsell' && (
              <div className="col-span-2 border-t border-neutral-100 pt-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-[13px]" style={{ fontFamily: 'var(--font-instrument), serif' }}>
                    {headline}
                  </div>
                  {headlineAr && (
                    <div dir="rtl" className="text-[11.5px] text-neutral-500">
                      {headlineAr}
                    </div>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2.5">
                  {items.slice(0, 3).map((p) => (
                    <div key={p.id}>
                      <Img src={p.image} className="aspect-[3/4] w-full" />
                      <div className="mt-1 line-clamp-1 text-[10px]">{p.title}</div>
                      <div className="flex items-center justify-between text-[10px] text-neutral-500">
                        {p.price}
                        <span className="text-[9px] uppercase tracking-[0.16em] text-black">+ Add</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
