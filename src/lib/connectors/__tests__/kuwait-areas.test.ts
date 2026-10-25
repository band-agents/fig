import { describe, expect, it } from 'vitest';
import { areaFromAddress, gmtcArea } from '../kuwait-areas';
import { areaOf } from '../gmtc-map';

describe('gmtcArea', () => {
  it.each([
    ['Hawalli', 'Hawally'],
    ['hawl', 'Hawally'],
    ['حولي', 'Hawally'],
    ['Kuwait city', 'Kuwait City'],
    ['Al Salmiya', 'Salmiya'],
    ['السالمية', 'Salmiya'],
    ['Jabriya', 'Jabriyah'],
    ['Mubarak Al-Kabeer', 'Mubarak Al Kabeer'],
    ['Salmiya, Block 10', 'Salmiya'],
    ['الجابرية - قطعة 3', 'Jabriyah'],
  ])('%s → %s', (typed, gmtc) => expect(gmtcArea(typed)).toBe(gmtc));

  it('knows nothing of a country or a blank', () => {
    expect(gmtcArea('Kuwait')).toBeNull();
    expect(gmtcArea('')).toBeNull();
  });
});

describe('areaFromAddress / areaOf', () => {
  it('finds the area in a later field when the city says only "Kuwait"', () => {
    expect(areaFromAddress({ city: 'Kuwait', line2: 'Salmiya', line1: 'Block 4, Street 9' })).toBe('Salmiya');
  });
  it('prefers the area in the street line over the governorate (order #1120: "Old jahra, Kuwait, Al Ahmadi")', () => {
    expect(areaFromAddress({ line1: 'Old jahra', city: 'Kuwait', region: 'Al Ahmadi' })).toBe('Jahra');
  });
  it('falls back to the governorate only when nothing else names an area', () => {
    expect(areaFromAddress({ line1: 'Block 4, Street 9', city: 'Kuwait', region: 'Al Ahmadi' })).toBe('Ahmadi');
  });
  it('takes the longest name inside a line', () => {
    expect(gmtcArea('house 12 sabah al salem block 3', { within: true })).toBe('Sabah Al Salem');
  });
  it('refuses an address that names no area', () => {
    expect(areaOf({ line1: 'Block 4, Street 9, House 2', city: 'Kuwait', country: 'KW' })).toBe('');
  });
  it('passes an unknown area through for GMTC to judge', () => {
    expect(areaOf({ line1: 'Block 1', city: 'Wafrah Farms', country: 'KW' })).toBe('Wafrah Farms');
  });
});
