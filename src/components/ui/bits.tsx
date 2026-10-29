import Link from 'next/link';
import { AlertTriangle, Banknote, CreditCard, ShieldAlert, ShieldCheck, Smartphone, Wallet, type LucideIcon } from 'lucide-react';
import { brandTint, CHANNEL } from '@/lib/channels';
import { ORDER_STAGE, RETURN_STAGE, type OrderStage, type ReturnStage } from '@/lib/domain/stages';

export function StagePill({ stage, held, className = '' }: { stage: string; held?: boolean; className?: string }) {
  const m = ORDER_STAGE[stage as OrderStage];
  if (!m) return <span className="pill">{stage}</span>;
  return (
    <span className={`pill ${className}`} data-tone={held ? 'warning' : m.badge}>
      <span className="dot" />
      {held ? `On hold · ${m.label}` : m.label}
    </span>
  );
}

export function ReturnPill({ stage }: { stage: string }) {
  const m = RETURN_STAGE[stage as ReturnStage];
  return (
    <span className="pill" data-tone={m?.badge ?? 'neutral'}>
      <span className="dot" />
      {m?.label ?? stage}
    </span>
  );
}

const BRAND_DOT: Record<string, string> = { FIG: 'var(--signal)', Labesny: '#f2a7b0', "Women'secret": '#c9b8a6' };
const dotFor = (brand: string) => BRAND_DOT[brand] ?? brandTint(brand);

export function ChannelChip({ id, compact = false }: { id: string; compact?: boolean }) {
  const c = CHANNEL[id];
  if (!c) return <span className="text-xs text-ink-3">{id}</span>;
  const label = c.brand === "Women'secret" ? `WS ${c.country === 'EG' ? 'Egypt' : c.country === 'KW' ? 'Kuwait' : 'Jordan'}` : c.name.replace(' (legacy)', '');
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-2">
      <span className="size-1.5 rounded-full" style={{ background: dotFor(c.brand) }} />
      {label}
      {c.surface === 'App' && (
        <span className="inline-flex items-center gap-0.5 rounded border border-line-2 px-1 text-[10px] uppercase tracking-wide text-ink-3">
          <Smartphone className="size-2.5" />
          {!compact && 'app'}
        </span>
      )}
      {!compact && <span className="text-ink-4">{c.country}</span>}
    </span>
  );
}

export function RiskBadge({ level, score, compact = false }: { level: string; score: number; compact?: boolean }) {
  if (level === 'low') {
    return compact ? (
      <span className="text-ink-4" title={`Low delivery risk (${score})`}>
        <ShieldCheck className="size-3.5" />
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-ink-3">
        <ShieldCheck className="size-3.5" /> Low · {score}
      </span>
    );
  }
  const high = level === 'high';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${high ? 'text-critical' : 'text-[var(--warn)]'}`} title={`${high ? 'High' : 'Medium'} delivery risk (${score})`}>
      {high ? <ShieldAlert className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
      {compact ? score : `${high ? 'High' : 'Medium'} · ${score}`}
    </span>
  );
}

const PAY: Record<string, { label: string; icon: LucideIcon }> = {
  cod: { label: 'Cash on delivery', icon: Banknote },
  card: { label: 'Card', icon: CreditCard },
  knet: { label: 'KNET', icon: CreditCard },
  wallet: { label: 'Wallet', icon: Wallet },
  instapay: { label: 'InstaPay', icon: Smartphone },
};
const PAY_STATUS: Record<string, string> = {
  pending: 'pending',
  paid: 'paid',
  cod_due: 'to collect',
  cod_collected: 'with courier',
  refunded: 'refunded',
  partially_refunded: 'part refunded',
  voided: 'voided',
};

const PAY_TONE: Record<string, string> = { paid: 'neutral', cod_collected: 'neutral', refunded: 'neutral', voided: 'neutral', pending: 'warning', cod_due: 'warning', partially_refunded: 'neutral' };
const PAY_BADGE: Record<string, string> = { paid: 'Paid', cod_collected: 'With courier', refunded: 'Refunded', voided: 'Voided', pending: 'Payment pending', cod_due: 'COD to collect', partially_refunded: 'Partly refunded' };

/** The payment state as a badge (Shopify's "Paid" / "Payment pending"). */
export function PayBadge({ status }: { status: string }) {
  return (
    <span className="pill" data-tone={PAY_TONE[status] ?? 'neutral'}>
      <span className="dot" />
      {PAY_BADGE[status] ?? status}
    </span>
  );
}

export function Payment({ method, status, short = false }: { method: string; status: string; short?: boolean }) {
  const p = PAY[method] ?? { label: method, icon: CreditCard };
  const Icon = p.icon;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-2">
      <Icon className="size-3.5 text-ink-3" />
      {short ? (method === 'cod' ? 'COD' : p.label) : p.label}
      <span className={`text-[11px] ${status === 'paid' ? 'text-good' : status.includes('refund') ? 'text-critical' : 'text-ink-3'}`}>· {PAY_STATUS[status] ?? status}</span>
    </span>
  );
}

export function SectionTitle({ eyebrow, title, right, className = '' }: { eyebrow?: string; title: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-[14px] font-medium tracking-tight">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/**
 * The page's title in the header row: a large title and one grey line under it, on the left of the
 * search pill and round buttons (which sit at the top right of every page on a wide screen).
 */
export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  void eyebrow;
  return (
    // the Ghattas page head: a 26px title, one muted line under it, the controls at the end
    <div data-page-header className="mb-5 flex flex-row flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-[1.2] sm:text-[26px]">{title}</h1>
        {sub && <p className="mt-1 hidden max-w-3xl text-[14px] leading-snug text-ink-3 sm:block">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-line bg-elev-2">
        <Icon className="size-5 text-ink-3" strokeWidth={1.6} />
      </span>
      <div className="mt-4 font-display text-xl">{title}</div>
      {body && <p className="mt-1.5 max-w-sm text-[12.5px] text-ink-3">{body}</p>}
      {action && (
        <Link href={action.href} className="btn btn-quiet btn-sm mt-5">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Thumbs({ images, count }: { images: (string | null)[]; count: number }) {
  const shown = images.filter(Boolean).slice(0, 3) as string[];
  return (
    <span className="flex items-center">
      {shown.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} src={src} alt="" loading="lazy" className="size-8 rounded-md object-cover ring-2 ring-[var(--bg-elev)]" style={{ marginLeft: i ? -10 : 0 }} />
      ))}
      {count > shown.length && <span className="ml-1.5 text-xs text-ink-3">+{count - shown.length}</span>}
    </span>
  );
}
