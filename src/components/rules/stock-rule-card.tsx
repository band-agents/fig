'use client';

import { useState, useTransition } from 'react';
import { Loader2, PackageX } from 'lucide-react';
import { dryRunStockRuleAction } from '@/app/(console)/rules/actions';
import type { RuleMode } from '@/lib/domain/stock-rule';
import type { StockRuleRun } from '@/lib/stock-rule';
import { when } from '@/lib/format';

const WORDS: Record<RuleMode, { label: string; tone: string; says: string }> = {
  off: {
    label: 'Off',
    tone: 'text-ink-3',
    says: 'The rule is not running. Set RELAY_STOCK_RULE to dry or on where Relay is served.',
  },
  dry: {
    label: 'Dry run',
    tone: 'text-[var(--warn)]',
    says: 'The rule runs with every sync and reports what it would do. Nothing on the shops is changed.',
  },
  on: {
    label: 'On',
    tone: 'text-good',
    says: 'Sold-out products come off the shop with every sync, and go back on when stock arrives.',
  },
};

export function StockRuleCard({
  mode,
  last,
  canRun,
}: {
  mode: RuleMode;
  last: StockRuleRun | null;
  canRun: boolean;
}) {
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const words = WORDS[mode];

  /* What the rule looked at and deliberately did not touch, with the reasons behind the number:
     it is the part that says the guardrails are working. */
  const left = last?.channels.flatMap((c) => c.skipped) ?? [];
  const skipped = left.length;
  const reasons = [...new Set(left.map((s) => s.why))].join(' · ');

  return (
    <section className="panel mt-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-medium">
            <PackageX className="size-4 text-ink-3" />
            Sold out comes off the shop
          </h2>
          <p className="mt-1.5 max-w-[62ch] text-[13px] text-ink-3">
            A product with nothing left is drafted on every connected storefront, and published again when
            stock arrives. It only ever publishes what it drafted — a product carries the{' '}
            <code className="font-mono text-[12px]">relay:oos</code> tag while it is down — and it never touches
            one whose stock is untracked or that is set to keep selling at zero.
          </p>
        </div>
        <span className={`text-[12px] font-medium ${words.tone}`}>{words.label}</span>
      </header>

      <p className="mt-3 text-[12.5px] text-ink-3">{words.says}</p>

      {last && (
        <div className="mt-4 border-t border-line pt-3 text-[12.5px]">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-ink-3">Last sweep {when(new Date(last.at))}</span>
            <span>
              <b className="font-medium">{last.drafted}</b> {last.mode === 'dry' ? 'would come off' : 'came off'}
            </span>
            <span>
              <b className="font-medium">{last.published}</b> {last.mode === 'dry' ? 'would go back on' : 'went back on'}
            </span>
            {skipped > 0 && (
              <span className="text-ink-3" title={reasons}>
                <b className="font-medium text-ink-2">{skipped}</b> left alone
              </span>
            )}
          </div>
          {last.channels.some((c) => !c.ok) && (
            <p className="mt-2 text-[var(--critical)]">
              {last.channels.filter((c) => !c.ok).map((c) => `${c.channelId}: ${c.note}`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {canRun && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await dryRunStockRuleAction();
                setNote(r.note);
              })
            }
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            See what it would do
          </button>
          {note && <span className="text-[12.5px] text-ink-2">{note}</span>}
        </div>
      )}
    </section>
  );
}
