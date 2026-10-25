/**
 * Production: styles we have made for us by a contract manufacturer.
 *
 * Dan, 21 Oct 2026: "we don't manufacture, but we hire a manufacturer to manufacture for us. For
 * example, Forever 21, we manufacture their products in Egypt." So a production order is one style
 * (or one colourway of it) placed with one factory: the brief and tech pack go out, a price is agreed,
 * samples go back and forth until one is approved, fabric and trims arrive, the factory cuts, sews and
 * finishes, our QC inspects, it is packed and shipped, and it lands in our warehouse. Each of those is
 * a step with a planned date and a done date, so a late factory shows up the day a step slips rather
 * than the day the goods fail to arrive. Pure: dates are ISO day strings, money is minor units.
 */

export const PRODUCTION_STEPS = [
  { key: 'brief', label: 'Brief & tech pack sent', short: 'Brief', owner: 'us', days: 0 },
  { key: 'costing', label: 'Price agreed', short: 'Costing', owner: 'both', days: 5 },
  { key: 'proto', label: 'Proto sample received', short: 'Proto', owner: 'maker', days: 14 },
  { key: 'fit', label: 'Fit sample approved', short: 'Fit', owner: 'us', days: 24 },
  { key: 'pp', label: 'Pre-production sample approved', short: 'PP sample', owner: 'us', days: 34 },
  { key: 'materials', label: 'Fabric & trims in the factory', short: 'Materials', owner: 'maker', days: 44 },
  { key: 'cutting', label: 'Cutting', short: 'Cutting', owner: 'maker', days: 50 },
  { key: 'sewing', label: 'Sewing', short: 'Sewing', owner: 'maker', days: 62 },
  { key: 'finishing', label: 'Washing, finishing & pressing', short: 'Finishing', owner: 'maker', days: 68 },
  { key: 'qc', label: 'Final inspection passed', short: 'Final QC', owner: 'us', days: 71 },
  { key: 'packed', label: 'Packed & labelled', short: 'Packed', owner: 'maker', days: 73 },
  { key: 'shipped', label: 'Left the factory', short: 'Ex-factory', owner: 'maker', days: 75 },
  { key: 'received', label: 'Received in our warehouse', short: 'Received', owner: 'us', days: 78 },
] as const;
export type StepKey = (typeof PRODUCTION_STEPS)[number]['key'];
export const STEP = Object.fromEntries(PRODUCTION_STEPS.map((s, i) => [s.key, { ...s, index: i }])) as Record<StepKey, (typeof PRODUCTION_STEPS)[number] & { index: number }>;

export type Step = { key: StepKey; planned: string | null; done: string | null; by?: string | null; note?: string | null };

export const COST_PARTS = [
  { key: 'fabric', label: 'Fabric' },
  { key: 'trims', label: 'Trims & accessories' },
  { key: 'cmt', label: 'Cut, make & trim (CMT)' },
  { key: 'wash', label: 'Washing & finishing' },
  { key: 'print', label: 'Print & embroidery' },
  { key: 'packing', label: 'Packing & labels' },
  { key: 'freight', label: 'Freight to us' },
  { key: 'other', label: 'Other' },
] as const;
export type CostKey = (typeof COST_PARTS)[number]['key'];
export type Costs = Partial<Record<CostKey, number>>;

export type Inspection = {
  id: string;
  at: string;
  kind: 'inline' | 'final';
  /** Pieces in the lot inspected. */
  lot: number;
  sampled: number;
  major: number;
  minor: number;
  result: 'pass' | 'fail' | 'rework';
  inspector: string;
  note?: string;
};

export type Payment = { id: string; kind: 'deposit' | 'balance' | 'other'; amount: number; due: string | null; paidAt: string | null; ref?: string | null; note?: string | null };

export const MAKER_SKILLS = ['Knit', 'Woven', 'Denim', 'Jersey', 'Lingerie', 'Swimwear', 'Outerwear', 'Kids', 'Accessories'] as const;

/** A fresh plan: every step, its date counted from the brief so the factory's lead time is visible. */
export function planSteps(start: string, dueExFactory?: string | null): Step[] {
  const s = Date.parse(`${start}T00:00:00Z`);
  const ship = PRODUCTION_STEPS.find((x) => x.key === 'shipped')!.days;
  // with a promised ex-factory date, the standard plan stretches or shrinks to meet it
  const scale = dueExFactory ? Math.max(0.3, (Date.parse(`${dueExFactory}T00:00:00Z`) - s) / 86_400_000 / ship) : 1;
  return PRODUCTION_STEPS.map((x) => ({ key: x.key, planned: day(s + Math.round(x.days * scale) * 86_400_000), done: null }));
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Where an order stands: the first step not done, or 'received' when every one is. */
export function currentStep(steps: Step[]): StepKey {
  for (const x of PRODUCTION_STEPS) {
    const s = steps.find((y) => y.key === x.key);
    if (!s?.done) return x.key;
  }
  return 'received';
}

export const isFinished = (steps: Step[]) => PRODUCTION_STEPS.every((x) => steps.find((y) => y.key === x.key)?.done);

/** Steps whose planned date has passed without being done. */
export function lateSteps(steps: Step[], today: string): Step[] {
  return steps.filter((s) => !s.done && s.planned && s.planned < today);
}

/** Days the order is running behind: the most overdue open step. */
export function daysLate(steps: Step[], today: string): number {
  const t = Date.parse(`${today}T00:00:00Z`);
  return lateSteps(steps, today).reduce((a, s) => Math.max(a, Math.round((t - Date.parse(`${s.planned}T00:00:00Z`)) / 86_400_000)), 0);
}

/** Share of the work done, by steps. */
export const progress = (steps: Step[]) => steps.filter((s) => s.done).length / PRODUCTION_STEPS.length;

export const costPerPiece = (c: Costs) => COST_PARTS.reduce((a, p) => a + Math.max(0, Math.round(c[p.key] ?? 0)), 0);

/** Margin on the retail price, once both are known. */
export const marginOn = (cost: number, retail: number | null | undefined) => (retail && retail > 0 && cost > 0 ? (retail - cost) / retail : null);

export const totalQty = (sizes: Record<string, number>) => Object.values(sizes).reduce((a, n) => a + Math.max(0, Math.trunc(n || 0)), 0);

// ── Inspection: ISO 2859-1, general inspection level II, single sampling, normal, AQL 2.5 for major defects ──
const LOTS: [number, number][] = [
  [8, 2], [15, 3], [25, 5], [50, 8], [90, 13], [150, 20], [280, 32], [500, 50], [1200, 80], [3200, 125], [10000, 200], [35000, 315], [150000, 500], [500000, 800], [Infinity, 1250],
];
const ACCEPT_25: Record<number, number> = { 2: 0, 3: 0, 5: 0, 8: 0, 13: 1, 20: 1, 32: 2, 50: 3, 80: 5, 125: 7, 200: 10, 315: 14, 500: 21, 800: 21, 1250: 21 };
const ACCEPT_40: Record<number, number> = { 2: 0, 3: 0, 5: 0, 8: 1, 13: 1, 20: 2, 32: 3, 50: 5, 80: 7, 125: 10, 200: 14, 315: 21, 500: 21, 800: 21, 1250: 21 };

/** How many pieces to pull from a lot, and how many defects it may carry and still pass. */
export function aqlPlan(lot: number) {
  const n = Math.max(1, Math.trunc(lot));
  const sample = Math.min(n, (LOTS.find(([max]) => n <= max) ?? LOTS[LOTS.length - 1])[1]);
  const key = (Object.keys(ACCEPT_25).map(Number).find((k) => k >= sample) ?? 1250) as number;
  return { sample, majorAccept: ACCEPT_25[key], minorAccept: ACCEPT_40[key] };
}

/** The verdict an inspection's counts give: over either limit fails. */
export function aqlVerdict(lot: number, major: number, minor: number): 'pass' | 'fail' {
  const p = aqlPlan(lot);
  return major > p.majorAccept || minor > p.minorAccept ? 'fail' : 'pass';
}

export function nextProductionNumber(last: string | null | undefined) {
  const n = Number(String(last ?? '').replace(/\D/g, '')) || 0;
  return `PRD-${String(n + 1).padStart(4, '0')}`;
}
