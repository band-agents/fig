// The house marks: D&H International and D&Co International, drawn from their own logo files in
// /public/brand. Each file is used as a mask and filled with the current text colour, so the same
// mark is ink on the light theme and ivory on the dark one, and never sits in a white box.

export const BRAND_NAME = 'DH & DCO';

type MarkFile = { src: string; ratio: number; label: string };

const DH_MARK: MarkFile = { src: '/brand/dh-mark.png', ratio: 1456 / 460, label: 'D&H International' };
const DCO_MARK: MarkFile = { src: '/brand/dco-mark.png', ratio: 326 / 181, label: 'D&Co International' };
const DH_FULL: MarkFile = { src: '/brand/dh-full.png', ratio: 1474 / 743, label: 'D&H International Company W.L.L' };
const DCO_FULL: MarkFile = { src: '/brand/dco-full.png', ratio: 326 / 230, label: 'Dagher & Co International' };

function Mask({ file, height, className = '' }: { file: MarkFile; height: number; className?: string }) {
  const mask = `url(${file.src}) center / contain no-repeat`;
  return (
    <span
      role="img"
      aria-label={file.label}
      className={`block shrink-0 bg-current ${className}`}
      style={{ width: Math.round(height * file.ratio), height, WebkitMask: mask, mask }}
    />
  );
}

/** D&H | D&Co, side by side on a hairline. The name of the console wherever there is room for it. */
/** `paper` draws the marks in porcelain, for dark grounds (the landing page's navy). */
type Tone = 'ink' | 'paper';
const TONE: Record<Tone, string> = { ink: 'text-ink', paper: 'text-[#f5efe6]' };

export function BrandLockup({ height = 18, className = '', tone = 'ink' }: { height?: number; className?: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center ${TONE[tone]} ${className}`} aria-label={BRAND_NAME} role="img">
      <Mask file={DH_MARK} height={height} />
      <span className={`mx-[0.7em] w-px self-stretch ${tone === 'paper' ? 'bg-[#f5efe6]/30' : 'bg-line-3'}`} style={{ fontSize: height }} aria-hidden />
      <Mask file={DCO_MARK} height={Math.round(height * 1.12)} />
    </span>
  );
}

/** The D&H monogram alone, for the narrow places: the collapsed sidebar and the phone header. */
export function BrandMark({ height = 14, className = '', tone = 'ink' }: { height?: number; className?: string; tone?: Tone }) {
  return (
    <span className={`inline-flex ${TONE[tone]} ${className}`}>
      <Mask file={DH_MARK} height={height} />
    </span>
  );
}

/** Both logos in full, with the companies' own names under them. The sign-in screen. */
export function BrandFull({ height = 64, className = '', tone = 'ink' }: { height?: number; className?: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-end gap-[0.9em] ${TONE[tone]} ${className}`} style={{ fontSize: height }}>
      <Mask file={DH_FULL} height={height} />
      <span className={`mb-[0.08em] h-[0.86em] w-px ${tone === 'paper' ? 'bg-[#f5efe6]/30' : 'bg-line-3'}`} aria-hidden />
      <Mask file={DCO_FULL} height={Math.round(height * 0.92)} />
    </span>
  );
}
