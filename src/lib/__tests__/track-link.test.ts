import { afterEach, describe, expect, it } from 'vitest';
import { trackLink, trackToken, trackTokenOk } from '../track-link';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe('tracking links', () => {
  it('signs an order and checks the signature', () => {
    process.env.RELAY_TRACK_SECRET = 's3cret';
    const t = trackToken('ord_1');
    expect(t).toHaveLength(24);
    expect(trackTokenOk('ord_1', t)).toBe(true);
    expect(trackTokenOk('ord_2', t)).toBe(false);
    expect(trackTokenOk('ord_1', t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(trackTokenOk('ord_1', '')).toBe(false);
  });

  it('makes no link without a secret', () => {
    delete process.env.RELAY_TRACK_SECRET;
    delete process.env.RELAY_CRON_SECRET;
    process.env.RELAY_PUBLIC_URL = 'https://console.example.com';
    expect(trackLink({ id: 'ord_1', channelId: 'labesny-web' })).toBeNull();
  });

  it("uses the shop's own page when one is set, else the console", () => {
    process.env.RELAY_TRACK_SECRET = 's3cret';
    process.env.RELAY_PUBLIC_URL = 'https://console.example.com/';
    const consoleLink = new URL(trackLink({ id: 'ord_1', channelId: 'labesny-web' })!);
    expect(consoleLink.origin + consoleLink.pathname).toBe('https://console.example.com/track');
    expect(consoleLink.searchParams.get('store')).toBe('labesny-web');
    expect(consoleLink.searchParams.get('o')).toBe('ord_1');
    expect(trackTokenOk('ord_1', consoleLink.searchParams.get('t')!)).toBe(true);

    process.env.RELAY_TRACK_PAGE_LABESNY_WEB = 'https://labesny.com/pages/track';
    const shopLink = new URL(trackLink({ id: 'ord_1', channelId: 'labesny-web' })!);
    expect(shopLink.origin + shopLink.pathname).toBe('https://labesny.com/pages/track');
    expect(shopLink.searchParams.get('o')).toBe('ord_1');
  });
});
