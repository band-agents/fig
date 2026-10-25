import { describe, expect, it } from 'vitest';
import { branchesFor, branchesForReturn, findBranch, sameBrand } from '../branches';

describe('the Kuwait shops', () => {
  it('carries every D&H and D&Co counter for Labesny', () => {
    const all = branchesFor('Labesny', 'KW');
    expect(all).toHaveLength(27);
    expect(new Set(all.map((b) => b.area)).size).toBe(8);
    // Every one has an id, a name and the counter's own number: no half-filled rows.
    for (const b of all) {
      expect(b.id).toMatch(/^[a-z0-9-]+$/);
      expect(b.name).toContain('·');
      expect(b.phone).toMatch(/^\+965 \d{8}$/);
    }
  });

  it("gives Women'secret Kuwait only its own counters", () => {
    const ws = branchesFor("Women'secret", 'KW');
    expect(ws).toHaveLength(5);
    expect(ws.every((b) => b.brands?.includes('Women Secret'))).toBe(true);
  });

  it('has nothing for the markets whose list has not arrived', () => {
    expect(branchesFor('FIG', 'EG')).toEqual([]);
    expect(branchesFor("Women'secret", 'JO')).toEqual([]);
  });

  it('ids are unique, because a return stores one of them', () => {
    const ids = branchesFor('Labesny', 'KW').map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('matching a shop to what is coming back', () => {
  it('reads the store list and the catalogue as the same brand', () => {
    expect(sameBrand('Women Secret', "WOMEN'SECRET")).toBe(true);
    expect(sameBrand('Benetton', 'UNITED COLORS OF BENETTON')).toBe(true);
    expect(sameBrand('La Vie en Rose', 'LA VIE EN ROSE')).toBe(true);
    expect(sameBrand('Etam', 'HUNKEMOLLER')).toBe(false);
  });

  it('shows the Etam counters for an Etam dress, not all twenty-seven', () => {
    const shops = branchesForReturn('Labesny', 'KW', ['ETAM']);
    // 360, Avenues, Gate, Marina, Warehouse.
    expect(shops).toHaveLength(5);
    expect(shops.every((b) => b.brands?.includes('Etam'))).toBe(true);
  });

  it('shows the counters for every brand in a mixed basket', () => {
    const shops = branchesForReturn('Labesny', 'KW', ['ETAM', 'CELIO']);
    expect(shops.map((b) => b.id)).toContain('etam-marina');
    expect(shops.map((b) => b.id)).toContain('celio-marina');
  });

  it('shows no shop at all for a brand with no counter of its own', () => {
    /* bebe and Springfield sell on Labesny but have no Kuwait shop on the list. Another brand's
       counter cannot take them back, so the customer is shown none and the desk settles it. */
    expect(branchesForReturn('Labesny', 'KW', ['BEBE'])).toEqual([]);
    // A mixed basket still gets the shops of the brand that has them.
    expect(branchesForReturn('Labesny', 'KW', ['BEBE', 'YAMAMAY']).map((b) => b.id)).toEqual(['yamamay-avenues', 'yamamay-kout']);
  });

  it('accepts only an id from that market', () => {
    expect(findBranch('Labesny', 'KW', 'etam-360')?.area).toBe('360 Mall');
    expect(findBranch("Women'secret", 'KW', 'etam-360')).toBe(null);
    expect(findBranch('Labesny', 'KW', 'not-a-shop')).toBe(null);
    expect(findBranch('Labesny', 'KW', null)).toBe(null);
  });
});
