/** Three batons passing hands; the last one is live. */
export function RelayMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="4.6" width="11" height="3.2" rx="1.6" fill="currentColor" opacity=".34" />
      <rect x="6.5" y="10.4" width="11" height="3.2" rx="1.6" fill="currentColor" opacity=".72" />
      <rect x="11" y="16.2" width="11" height="3.2" rx="1.6" fill="var(--signal)" />
    </svg>
  );
}

export function RelayWordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <RelayMark />
      <span className="font-display text-[22px] leading-none tracking-tight">
        Relay<span className="ml-1.5 align-middle font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">by FIG</span>
      </span>
    </span>
  );
}
