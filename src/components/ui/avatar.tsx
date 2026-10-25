import { Sparkles } from 'lucide-react';
import { initials } from '@/lib/format';
import { isSystemActor } from '@/lib/domain/actors';

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
  if (isSystemActor(name)) {
    return (
      <span className="inline-grid shrink-0 place-items-center rounded-full bg-inv text-inv-ink" style={{ width: size, height: size }} aria-hidden>
        <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.8} />
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
