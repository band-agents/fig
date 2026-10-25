// Moving stock to where it sells. A shop sitting on pieces nobody there buys, while another shop or
// the website is running short, is money doing nothing; a transfer costs a van and an hour. Pure.

export type Spot = {
  locationId: string;
  kind: 'warehouse' | 'store';
  onHand: number;
  rate: number; // units a week expected here
  sells: boolean; // the place carries this brand at all
};

export type Move = { from: string; to: string; qty: number; why: string };

const cover = (s: Spot) => (s.rate > 0 ? s.onHand / s.rate : s.onHand > 0 ? Infinity : 0);

/**
 * Suggests transfers for one style. A place is short when it has under `short` weeks of cover and is
 * selling; a shop is long when it has over `long` weeks or has stopped selling with pieces left.
 * The warehouse keeps `keep` weeks for the websites before it gives anything to the shops.
 */
export function rebalance(spots: Spot[], o: { short?: number; target?: number; long?: number; keep?: number; minMove?: number } = {}): Move[] {
  const short = o.short ?? 2.5;
  const target = o.target ?? 6;
  const long = o.long ?? 16;
  const keep = o.keep ?? 8;
  const minMove = o.minMove ?? 2;

  const needs = spots
    .filter((s) => s.sells && s.rate > 0.15 && cover(s) < short)
    .map((s) => ({ s, need: Math.ceil(s.rate * target - s.onHand) }))
    .filter((x) => x.need >= minMove)
    .sort((a, b) => b.s.rate - a.s.rate);

  const gives = spots
    .map((s) => {
      if (s.kind === 'warehouse') return { s, spare: Math.floor(s.onHand - s.rate * keep) };
      if (!s.sells) return { s, spare: s.onHand };
      if (cover(s) > long) return { s, spare: Math.floor(s.onHand - s.rate * target) };
      return { s, spare: 0 };
    })
    .filter((x) => x.spare >= minMove)
    // shops that have stopped selling give first, then the warehouse, then shops that are merely long
    .sort((a, b) => rank(a.s) - rank(b.s) || b.spare - a.spare);

  const moves: Move[] = [];
  for (const n of needs) {
    for (const g of gives) {
      if (n.need < minMove) break;
      if (g.spare < minMove || g.s.locationId === n.s.locationId) continue;
      const qty = Math.min(n.need, g.spare);
      g.spare -= qty;
      n.need -= qty;
      const why =
        g.s.kind === 'warehouse'
          ? 'Warehouse has stock beyond what the websites need'
          : g.s.rate < 0.1
            ? 'Not selling where it is'
            : `${Math.round(cover(g.s))} weeks of cover where it is`;
      moves.push({ from: g.s.locationId, to: n.s.locationId, qty, why });
    }
  }
  return moves;
}

function rank(s: Spot) {
  if (s.kind === 'store' && s.rate < 0.1) return 0;
  if (s.kind === 'warehouse') return 1;
  return 2;
}
