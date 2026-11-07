import { describe, expect, it } from 'vitest';
import { journeyTraffic, sitesTraffic, visitTraffic } from '../traffic';

const shop = 'labesny.com';

describe('order traffic', () => {
  it('reads the Labesny journeys seen on 7 Nov', () => {
    expect(journeyTraffic({ lastVisit: { source: 'Google', sourceType: 'SEO', referrerUrl: 'https://www.google.com/' } }, shop)).toMatchObject({ kind: 'search', label: 'Google (search)' });
    expect(journeyTraffic({ lastVisit: { source: 'Instagram', referrerUrl: 'https://l.instagram.com/', landingPage: 'https://labesny.com/product-category/brands/la-vie-en-rose' } }, shop)).toMatchObject({ kind: 'social', label: 'Instagram' });
    expect(journeyTraffic({ lastVisit: { source: 'ChatGPT', utmParameters: { source: 'chatgpt.com' } } }, shop)).toMatchObject({ kind: 'ai', label: 'ChatGPT' });
    expect(journeyTraffic({ lastVisit: { source: 'direct' }, firstVisit: { source: 'direct' } }, shop)).toMatchObject({ kind: 'direct', label: 'Direct', first: null });
  });

  it('credits the first visit when the last one was only a return visit', () => {
    const t = journeyTraffic({ lastVisit: { source: 'direct', referrerUrl: 'https://labesny.com/products/x' }, firstVisit: { source: 'Instagram', referrerUrl: 'https://l.instagram.com/' } }, shop);
    expect(t).toMatchObject({ kind: 'social', label: 'Instagram', first: null, referrer: 'https://l.instagram.com/' });
  });

  it('keeps the first visit beside a different last one', () => {
    const t = journeyTraffic({ lastVisit: { source: 'Google', sourceType: 'SEO' }, firstVisit: { source: 'Instagram' } }, shop);
    expect(t).toMatchObject({ label: 'Google (search)', first: 'Instagram' });
  });

  it('calls it a Meta ad only when the ad tags say paid', () => {
    expect(visitTraffic({ landingPage: 'https://labesny.com/?utm_source=facebook&utm_medium=paid&utm_campaign=AW26' })).toMatchObject({ kind: 'meta_ad', label: 'Meta ad', campaign: 'AW26' });
    expect(visitTraffic({ utmParameters: { source: 'instagram', medium: 'cpc', campaign: 'Sale' } })).toMatchObject({ kind: 'meta_ad', campaign: 'Sale' });
    // fbclid rides on every link out of Facebook and Instagram, posts and bios too
    expect(visitTraffic({ landingPage: 'https://labesny.com/?fbclid=abc' })).toMatchObject({ kind: 'social', label: 'Facebook / Instagram' });
    expect(visitTraffic({ landingPage: 'https://labesny.com/?utm_source=ig&utm_medium=social&fbclid=abc' })).toMatchObject({ kind: 'social', label: 'Instagram' });
  });

  it('knows Google ads and email', () => {
    expect(visitTraffic({ landingPage: 'https://labesny.com/?gclid=1' })).toMatchObject({ kind: 'google_ad' });
    expect(visitTraffic({ utmParameters: { source: 'klaviyo', medium: 'email' } })).toMatchObject({ kind: 'email' });
  });

  it('reads the REST webhook sites', () => {
    expect(sitesTraffic('/collections/x?utm_source=facebook&utm_medium=paid', 'https://m.facebook.com/', shop)).toMatchObject({ kind: 'meta_ad' });
    expect(sitesTraffic('/', 'https://www.google.com/', shop)).toMatchObject({ kind: 'search' });
    expect(sitesTraffic(null, null, shop)).toBeNull();
    expect(journeyTraffic(null, shop)).toBeNull();
  });
});
