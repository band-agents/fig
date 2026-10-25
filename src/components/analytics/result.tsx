import Link from 'next/link';
import { Info } from 'lucide-react';
import type { Chart, Ctx, Fig, Result, Table } from '@/lib/reports/engine';
import { BarList } from '@/components/charts/barlist';
import { Heatmap } from '@/components/charts/charts';
import { WeekBars } from '@/components/charts/week-bars';
import { Card, Figure } from '@/components/reports/bits';
import { ByMeasure, MeasureToggle } from '@/components/ui/measure';
import { show } from './format';

const COLORS = ['var(--s1)', 'var(--s3)', 'var(--s2)', 'var(--s4)'];

function change(f: Fig) {
  if (typeof f.value !== 'number' || f.prev == null) return { note: f.note, tone: undefined };
  const now = f.value;
  const before = f.prev;
  if (f.fmt === 'pct') {
    const pts = Math.round((now - before) * 1000) / 10;
    const good = f.better ? (f.better === 'up' ? pts >= 0 : pts <= 0) : undefined;
    return { note: `${pts >= 0 ? '+' : '−'}${Math.abs(pts)} pts on before${f.note ? ` · ${f.note}` : ''}`, tone: pts === 0 || good === undefined ? undefined : good ? ('good' as const) : ('bad' as const) };
  }
  if (!before) return { note: f.note ?? (now ? 'new' : undefined), tone: undefined };
  const d = (now - before) / Math.abs(before);
  const good = f.better ? (f.better === 'up' ? d >= 0 : d <= 0) : undefined;
  const pct = Math.abs(Math.round(d * 100));
  return { note: `${d >= 0 ? '+' : '−'}${pct}% on before${f.note ? ` · ${f.note}` : ''}`, tone: pct === 0 || good === undefined ? undefined : good ? ('good' as const) : ('bad' as const) };
}

function Figures({ figures, ctx }: { figures: Fig[]; ctx: Ctx }) {
  if (!figures.length) return null;
  return (
    <section className={`grid grid-cols-2 gap-3 sm:gap-4 ${figures.length >= 5 ? 'xl:grid-cols-5' : figures.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
      {figures.map((f) => {
        const c = change(f);
        return <Figure key={f.label} label={f.label} value={<span className={f.fmt === 'text' ? 'block truncate text-[16px] sm:text-[18px]' : ''} title={f.fmt === 'text' ? String(f.value ?? '') : undefined}>{show(f.value, f.fmt, ctx.currency, { compact: true })}</span>} note={c.note} tone={c.tone} />;
      })}
    </section>
  );
}

function ChartCard({ chart, ctx }: { chart: Chart; ctx: Ctx }) {
  if (chart.kind === 'heatmap') {
    return (
      <Card title={chart.title} sub={chart.sub} className="xl:col-span-2">
        <Heatmap grid={chart.grid} rows={chart.rows} />
      </Card>
    );
  }
  if (chart.kind === 'trend') {
    const value = chart.series.filter((s) => s.measure === 'value');
    const units = chart.series.filter((s) => s.measure === 'units');
    const bars = (ss: typeof chart.series, kind: 'money' | 'pieces') => <WeekBars weeks={chart.labels} series={ss.map((s, i) => ({ name: s.name, color: s.color ?? COLORS[i % COLORS.length], values: s.values }))} kind={kind} currency={ctx.currency} />;
    return (
      <Card title={chart.title} sub={chart.sub} className="xl:col-span-2" right={value.length && units.length ? <MeasureToggle money={ctx.money} /> : undefined}>
        {value.length && units.length ? <ByMeasure value={bars(value, 'money')} units={bars(units, 'pieces')} /> : value.length ? bars(value, 'money') : bars(units, 'pieces')}
      </Card>
    );
  }
  const measured = chart.measured && ctx.money && chart.fmt === 'money';
  const list = (by: 'value' | 'units') => {
    const rows = [...chart.rows].map((r) => ({ ...r, v: by === 'units' ? (r.units ?? r.value) : r.value })).sort((a, b) => (chart.ordered ? 0 : b.v - a.v));
    return (
      <BarList
        rows={rows.map((r) => ({ label: r.href ? <Link href={r.href} className="hover:underline">{r.label}</Link> : r.label, value: r.v, sub: r.sub }))}
        format={(v) => (by === 'units' ? show(v, 'int', ctx.currency) : show(v, chart.fmt, ctx.currency, { compact: true }))}
        color={by === 'units' ? 'var(--s3)' : 'var(--s1)'}
      />
    );
  };
  if (!chart.rows.length) return null;
  return (
    <Card title={chart.title} sub={chart.sub} right={measured ? <MeasureToggle money={ctx.money} /> : undefined}>
      {measured ? <ByMeasure value={list('value')} units={list('units')} /> : list(chart.fmt === 'money' && !ctx.money ? 'units' : 'value')}
    </Card>
  );
}

export function TableCard({ table, ctx, exportHref }: { table: Table; ctx: Ctx; exportHref?: string }) {
  const cols = table.columns.filter((c) => !c.exportOnly);
  const limit = table.limit ?? 300;
  const rows = table.rows.slice(0, limit);
  const totals = cols.some((c) => c.total) ? Object.fromEntries(cols.filter((c) => c.total).map((c) => [c.key, table.rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)])) : null;
  const hidden = table.columns.length - cols.length;
  return (
    <Card
      title={table.title}
      sub={[table.sub, `${table.rows.length} rows${table.rows.length > limit ? `, first ${limit} shown` : ''}${hidden ? `, ${hidden} more columns` : ''}${(table.rows.length > limit || hidden) && exportHref ? ' (export has everything)' : ''}`].filter(Boolean).join(' · ')}
      flush
    >
      {table.rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12.5px] text-ink-3">Nothing to show.</p>
      ) : (
        <div className="scroll-thin max-h-[640px] overflow-auto">
          <table className="table text-[12.5px]">
            <thead className="sticky top-0 z-[1] bg-elev">
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={c.fmt === 'text' || c.fmt === 'date' ? '' : 'text-right'}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c, j) => {
                    const v = show(r[c.key], c.fmt, ctx.currency, { grain: c.fmt === 'date' && c.key === 'day' ? ctx.range.grain : undefined });
                    const align = c.fmt === 'text' || c.fmt === 'date' ? '' : 'text-right font-mono';
                    return (
                      <td key={c.key} className={`${align} ${c.wide ? 'min-w-[180px] max-w-[360px] truncate font-medium' : ''} ${v === '—' ? 'text-ink-4' : ''}`} title={c.wide ? String(r[c.key] ?? '') : undefined}>
                        {j === 0 && r._href ? (
                          <Link href={r._href} className="hover:underline">
                            {v}
                          </Link>
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {totals && table.rows.length > 1 && (
              <tfoot>
                <tr className="font-semibold">
                  {cols.map((c, j) => (
                    <td key={c.key} className={c.fmt === 'text' || c.fmt === 'date' ? '' : 'text-right font-mono'}>
                      {j === 0 ? 'Total' : c.total ? show(totals[c.key], c.fmt, ctx.currency) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}

/** Any report's answer: its figures, its charts two to a row, its tables, its notes. */
export function ReportResult({ result, ctx, exportHref }: { result: Result; ctx: Ctx; exportHref?: string }) {
  const charts = result.charts.filter((c) => c.kind !== 'bars' || c.rows.length > 0);
  return (
    <div className="space-y-5">
      {result.notes?.map((n) => (
        <p key={n} className="flex items-start gap-2 rounded-xl bg-elev-2 px-3.5 py-2.5 text-[12.5px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />
          {n}
        </p>
      ))}
      {result.empty && !result.figures.length && !result.tables.some((t) => t.rows.length) ? (
        <div className="panel px-6 py-14 text-center text-[13px] text-ink-3">{result.empty}</div>
      ) : (
        <>
          <Figures figures={result.figures} ctx={ctx} />
          {charts.length > 0 && (
            <section className="grid gap-5 xl:grid-cols-2">
              {charts.map((c) => (
                <ChartCard key={c.title} chart={c} ctx={ctx} />
              ))}
            </section>
          )}
          {result.tables.map((t) => (
            <TableCard key={t.title} table={t} ctx={ctx} exportHref={exportHref} />
          ))}
        </>
      )}
    </div>
  );
}
