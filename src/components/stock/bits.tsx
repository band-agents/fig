import { sql } from 'drizzle-orm';
import { FlaskConical, Radio } from 'lucide-react';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/auth/session';
import { marketsFor } from '@/lib/stock/views/common';
import { liveImports } from '@/lib/stock/live';
import { CHANNEL, channelLabel } from '@/lib/channels';
import { ago } from '@/lib/format';
import { VELOCITY_LABEL, VELOCITY_TINT, type Velocity } from '@/lib/domain/stock/classify';

/**
 * Where the numbers on a stock page come from, said plainly: a market fed by a live store says so
 * and when it was last read; a market still on the demo stockroom says that, so nobody plans a real
 * buy from it.
 */
export async function DemoNote() {
  const me = await currentUser();
  const markets = me ? marketsFor(me) : ['EG', 'KW'];
  const db = await getDb();
  const rows = (await db.execute<{ market: string; source: string; n: number }>(sql`select market, source, count(*)::int as n from products where status = 'active' group by 1, 2`)).rows.filter((r) => markets.includes(r.market as 'EG' | 'KW'));
  const imports = await liveImports();
  const live = markets.filter((m) => rows.some((r) => r.market === m && r.source !== 'demo') && !rows.some((r) => r.market === m && r.source === 'demo'));
  const demo = markets.filter((m) => rows.some((r) => r.market === m && r.source === 'demo'));
  const name = (m: string) => (m === 'KW' ? 'Kuwait' : 'Egypt');
  return (
    <div className="space-y-2">
      {live.map((m) => {
        const imp = imports.find((i) => CHANNEL[i.channelId]?.country === m);
        return (
          <div key={m} className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_oklab,var(--t-green)_35%,var(--line))] bg-[color-mix(in_oklab,var(--t-green)_6%,var(--bg-elev))] px-3.5 py-2.5 text-[12px] text-ink-2">
            <Radio className="mt-0.5 size-4 shrink-0 text-good" />
            <span>
              <b className="font-medium text-ink">{name(m)} is live{imp ? ` from ${channelLabel(imp.channelId)}` : ''}.</b>{' '}
              {imp ? (
                <>
                  Real catalogue, stock and orders read from Shopify {ago(imp.at)}: {imp.products.toLocaleString('en')} styles, {imp.pieces.toLocaleString('en')} pieces, {imp.orders} orders since {imp.firstOrder ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(new Date(imp.firstOrder)) : 'the store opened'}.
                </>
              ) : (
                'Real catalogue, stock and orders from the store.'
              )}{' '}
              Website sales only: shop counters and warehouse work join when Lucida is connected. Cost prices are estimated until then.
            </span>
          </div>
        );
      })}
      {demo.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line-2 bg-elev/60 px-3.5 py-2.5 text-[12px] text-ink-2">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span>
            <b className="font-medium text-ink">{demo.map(name).join(' and ')}: demo stockroom.</b> Real products and the real shops, but every sale, stock figure and purchase order there is fictional until its stores and Lucida are connected.
          </span>
        </div>
      )}
    </div>
  );
}

export function VelocityPill({ v }: { v: Velocity }) {
  return (
    <span className="pill" data-tint={VELOCITY_TINT[v]}>
      <span className="dot" />
      {VELOCITY_LABEL[v]}
    </span>
  );
}

const COMPANY: Record<string, string> = { DH: 'D&H', DCO: 'D&Co', FIG: 'FIG' };
export const companyLabel = (c: string) => COMPANY[c] ?? c;

export function Cover({ weeks, warnBelow = 3 }: { weeks: number; warnBelow?: number }) {
  if (!Number.isFinite(weeks)) return <span className="font-mono text-ink-3">∞</span>;
  return <span className={`font-mono ${weeks < warnBelow ? 'text-critical' : weeks > 26 ? 'text-[var(--warn)]' : ''}`}>{weeks >= 100 ? '99+' : weeks.toFixed(weeks < 10 ? 1 : 0)}</span>;
}
