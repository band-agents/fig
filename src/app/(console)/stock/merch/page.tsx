import { headers } from 'next/headers';
import { requireUser, sendHome } from '@/lib/auth/session';
import { viewCurrency } from '@/lib/stock/views/common';
import { canSee } from '@/lib/domain/perms';
import { merchBoard } from '@/lib/stock/views/merch';
import { CHANNELS, channelLabel } from '@/lib/channels';
import { ago, moneyIn, num, pct } from '@/lib/format';
import { PageHeader } from '@/components/ui/bits';
import { RecBoard } from '@/components/stock/rec-board';
import { CopySnippet, PlacementCard } from '@/components/stock/placement-card';
import { DemoNote } from '@/components/stock/bits';
import { CountUp } from '@/components/ui/count-up';

export const metadata = { title: 'Website merch' };

export default async function MerchPage() {
  const me = await requireUser();
  const cur = viewCurrency(me);
  if (!canSee(me, 'merch')) sendHome(me);
  const d = await merchBoard(me);
  const h = await headers();
  const origin = process.env.RELAY_PUBLIC_URL?.replace(/\/$/, '') || `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  const channelNames = Object.fromEntries(CHANNELS.map((c) => [c.id, channelLabel(c.id)]));
  const live = d.placements.filter((p) => p.status === 'live' || p.status === 'draft' || p.status === 'paused');
  const ended = d.placements.filter((p) => p.status === 'ended');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stock & buying"
        title="Website merch"
        sub="Placements on the storefronts (under add-to-bag, in the cart, as a pop-up) and the suggestions for slow pieces with stock and margin."
      />
      <DemoNote />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Live now', value: num(d.kpi.live), note: `${d.proposals.length} more proposed` },
          { label: 'Shoppers reached', value: num(d.kpi.impressions), note: 'views of a live placement, 45 days' },
          { label: 'Clicks', value: num(d.kpi.clicks), note: d.kpi.impressions ? `${pct(d.kpi.clicks / d.kpi.impressions, 1)} of views` : '' },
          { label: 'Orders', value: num(d.kpi.orders), note: 'that bought a placed piece' },
          ...(d.kpi.revenue != null ? [{ label: 'Sales from placements', value: moneyIn(d.kpi.revenue, cur, { compact: true }), note: cur === 'EGP' ? 'EGP equivalent' : cur }] : []),
        ].map((k) => (
          <div key={k.label} className="panel p-4">
            <div className="text-[11.5px] text-ink-3">{k.label}</div>
            <div className="mt-2 font-display text-[17px] leading-none">{typeof k.value === 'string' ? <CountUp text={k.value} /> : k.value}</div>
            <div className="mt-2 text-[11px] text-ink-3">{k.note}</div>
          </div>
        ))}
      </section>

      <section className="panel p-5">
        <div className="eyebrow mb-1">Suggested</div>
        <h2 className="mb-4 text-[14px] font-medium">Slow pieces, and the best-selling pages to show them on</h2>
        <RecBoard recs={d.proposals} publishLevel={d.publishLevel} channelNames={channelNames} initial="merch" pageSize={6} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[14px] font-medium">On the websites</h2>
        {live.length === 0 ? <p className="text-[12.5px] text-ink-3">Nothing live yet. Publish a proposal above.</p> : live.map((p) => <PlacementCard key={p.id} pl={p} level={d.publishLevel} seesMoney={d.seesMoney} />)}
      </section>

      {ended.length > 0 && (
        <details className="panel overflow-hidden">
          <summary className="cursor-pointer px-5 py-3.5 text-[13px] font-medium">Ended · {ended.length}</summary>
          <div className="space-y-3 border-t border-line p-4">
            {ended.map((p) => (
              <PlacementCard key={p.id} pl={p} level={d.publishLevel} seesMoney={d.seesMoney} />
            ))}
          </div>
        </details>
      )}

      <section className="panel p-5">
        <div className="eyebrow mb-1">Install once per storefront</div>
        <h2 className="mb-1 text-[14px] font-medium">One line in the theme, and the console runs the rest</h2>
        <p className="mb-4 max-w-3xl text-[12px] text-ink-3">
          Add the line to the theme’s layout (Shopify: theme.liquid before &lt;/body&gt;, see storefront/shopify/dh-merch.liquid). It draws placements under the add-to-bag form, or inside any element marked data-dh-merch. The apps read the same placements from /api/merch/&lt;store&gt;.
        </p>
        <ul className="divide-y divide-[var(--line)]">
          {d.storefronts.map((s) => (
            <li key={s.id} className="grid gap-2 py-3 md:grid-cols-[220px_1fr_140px] md:items-center">
              <div>
                <div className="text-[12.5px]">{s.label}</div>
                <div className="text-[11px] text-ink-3">
                  {s.platform} · {s.surface}
                </div>
              </div>
              {s.surface === 'App' ? <CopySnippet text={`GET ${origin}/api/merch/${s.id}?product=<handle>`} /> : <CopySnippet text={`<script src="${origin}/merch/embed.js" data-store="${s.id}" defer></script>`} />}
              <div className={`text-[11.5px] md:text-right ${s.lastSeen ? 'text-good' : 'text-ink-4'}`}>{s.lastSeen ? `seen ${ago(s.lastSeen)}` : 'not installed yet'}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
