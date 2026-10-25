import 'server-only';
import { getSetting } from './engine';
import type { Market } from './domain/stock/calendar';

/**
 * Monthly targets per brand, set by import (Imports → brand targets): sales in the market's own money
 * (minor units) and/or pieces. Kept per market, so Labesny's and FIG's never mix.
 */
export type Targets = Record<string, Record<string, { value?: number; units?: number }>>; // brand → YYYY-MM → targets
export const targetsKey = (m: Market) => `brand.targets.${m}`;
export const getTargets = (m: Market) => getSetting<Targets>(targetsKey(m), {});

export const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** A brand's target for a month, looked up whatever the spelling ("WOMEN'SECRET" is Women Secret). */
export function targetFor(t: Targets, brand: string, month: string) {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = Object.keys(t).find((b) => fold(b) === fold(brand));
  return key ? (t[key][month] ?? null) : null;
}
