import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, type LucideIcon } from 'lucide-react';

// Small pieces the catalogue screens share: a store's mark, a job's status, a product's action.

const HUES: Record<string, string> = { Labesny: '#c58f9d', FIG: '#8fb09a', "Women'secret": '#d9a1b8' };

export function StoreMark({ name, brand, size = 34 }: { name: string; brand?: string; size?: number }) {
  const hue = HUES[brand ?? name] ?? '#a99af0';
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[6px] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${hue}, color-mix(in oklab, ${hue} 55%, #1d1d1b))`, boxShadow: `0 6px 16px -8px ${hue}` }}
    >
      {(brand ?? name).replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '·'}
    </span>
  );
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  analysing: { label: 'Checking', tone: 'info' },
  ready: { label: 'Ready to run', tone: 'attention' },
  running: { label: 'Running', tone: 'info' },
  done: { label: 'Finished', tone: 'success' },
  failed: { label: 'Stopped', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' };
  return (
    <span className="pill" data-tone={s.tone}>
      <span className={`dot ${status === 'running' || status === 'analysing' ? 'animate-pulse' : ''}`} />
      {s.label}
    </span>
  );
}

export const ACTION: Record<string, { label: string; tone: string }> = {
  create: { label: 'New', tone: 'success' },
  update: { label: 'Update', tone: 'info' },
  unchanged: { label: 'No change', tone: 'neutral' },
  skip: { label: 'Skip', tone: 'neutral' },
  delete: { label: 'Delete', tone: 'critical' },
  archive: { label: 'Archive', tone: 'warning' },
  error: { label: 'Error', tone: 'critical' },
};

export function ActionPill({ action }: { action: string }) {
  const a = ACTION[action] ?? { label: action, tone: 'neutral' };
  return (
    <span className="pill" data-tone={a.tone}>
      {a.label}
    </span>
  );
}

export const KIND: Record<string, { label: string; icon: LucideIcon; tint: string }> = {
  import: { label: 'Import', icon: ArrowDownToLine, tint: 'violet' },
  export: { label: 'Export', icon: ArrowUpFromLine, tint: 'cyan' },
  revert: { label: 'Revert', icon: RotateCcw, tint: 'amber' },
};

export function KindMark({ kind, size = 38 }: { kind: string; size?: number }) {
  const k = KIND[kind] ?? KIND.import;
  const Icon = k.icon;
  return (
    <span data-tint={k.tint} className="grid shrink-0 place-items-center rounded-[6px]" style={{ width: size, height: size, background: 'color-mix(in oklab, var(--tint) 18%, transparent)', color: 'var(--tint)' }}>
      <Icon className="size-[18px]" strokeWidth={1.8} />
    </span>
  );
}

export function Bar({ value, tone = 'var(--sage)', live = false }: { value: number; tone?: string; live?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-elev-3">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: tone }} />
      {live && <div className="cat-shimmer absolute inset-0" />}
    </div>
  );
}

export function ago(at: string | Date | null | undefined) {
  if (!at) return '';
  const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en'));
