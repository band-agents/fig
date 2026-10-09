import { initials } from '@/lib/format';

export function Avatar({ name, hue = 220, size = 28, ring = false, className = '' }: { name: string; hue?: number; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ${ring ? 'ring-2 ring-bg' : ''} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36), background: `linear-gradient(140deg, oklch(0.62 0.13 ${hue}), oklch(0.46 0.12 ${hue + 24}))` }}
      title={name}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** System actors (Autopilot, a courier, a store) get a mark instead of initials. */
export function ActorAvatar({ name, hue, size = 26 }: { name: string; hue?: number | null; size?: number }) {
  if (name === 'Relay Autopilot' || name === 'Relay Risk' || name === 'Relay') {
    return (
      <span className="inline-grid shrink-0 place-items-center rounded-full bg-inv text-inv-ink" style={{ width: size, height: size }} aria-hidden>
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24">
          <rect x="2" y="4.6" width="11" height="3.2" rx="1.6" fill="currentColor" opacity=".4" />
          <rect x="6.5" y="10.4" width="11" height="3.2" rx="1.6" fill="currentColor" opacity=".75" />
          <rect x="11" y="16.2" width="11" height="3.2" rx="1.6" fill="var(--signal)" />
        </svg>
      </span>
    );
  }
  if (hue == null) {
    return (
      <span className="inline-grid shrink-0 place-items-center rounded-full border border-line-2 bg-elev-3 font-mono text-ink-2" style={{ width: size, height: size, fontSize: size * 0.34 }} aria-hidden>
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return <Avatar name={name} hue={hue} size={size} />;
}
