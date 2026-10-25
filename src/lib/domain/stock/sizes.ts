// Sizes in the order a customer reads them: XS before S before M, 36 before 38. Pure.

const LETTER = ['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL', 'XL', 'XXL', 'XXXL'];

/** A sort key: letter sizes by the run, numbers by value, anything else after, alphabetically. */
export function sizeRank(s: string): [number, number, string] {
  const u = s.trim().toUpperCase();
  const i = LETTER.indexOf(u);
  if (i >= 0) return [0, i, u];
  const n = parseFloat(u);
  if (Number.isFinite(n)) return [1, n, u];
  return [2, 0, u];
}

export const bySize = (a: string, b: string) => {
  const x = sizeRank(a);
  const y = sizeRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
};

export const sortSizes = (sizes: string[]) => [...new Set(sizes.map((s) => s.trim()).filter(Boolean))].sort(bySize);
