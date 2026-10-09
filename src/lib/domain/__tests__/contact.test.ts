import { describe, expect, it } from 'vitest';
import { looksLikeEmail, normaliseEmail, normaliseOrderNumber, phoneTail } from '../contact';

describe('order numbers as customers type them', () => {
  it('forgives the hash, the spaces and the case', () => {
    for (const typed of ['FIG-24538', '#FIG-24538', ' fig-24538 ', 'FIG - 24538']) {
      expect(normaliseOrderNumber(typed)).toBe('fig-24538');
    }
  });
});

describe('emails as customers type them', () => {
  it('folds case and trims', () => {
    expect(normaliseEmail('  Tarek.Hassan0@Yahoo.com ')).toBe('tarek.hassan0@yahoo.com');
  });

  it('tells an email from a phone by the one mark that only an email has', () => {
    expect(looksLikeEmail('tarek@yahoo.com')).toBe(true);
    expect(looksLikeEmail('+20 115 251 497')).toBe(false);
    expect(looksLikeEmail('60016286')).toBe(false);
  });
});

describe('phone numbers as customers type them', () => {
  /* The stored form is international. Every one of these is the same Egyptian number, and the tail
     is what they have in common. */
  it('matches an Egyptian number in any of its forms', () => {
    const stored = phoneTail('+201165251497');
    for (const typed of ['01165251497', '0116 525 1497', '+20 116 525 1497', '00201165251497', '1165251497']) {
      expect(phoneTail(typed)).toBe(stored);
    }
  });

  it('matches a Kuwaiti number, which is only eight digits to begin with', () => {
    expect(phoneTail('60016286')).toBe(phoneTail('+96560016286'));
  });

  it('refuses a fragment, rather than matching half the country on a short tail', () => {
    expect(phoneTail('6286')).toBe(null);
    expect(phoneTail('')).toBe(null);
    expect(phoneTail('0000000')).toBe(null);
  });

  it('keeps two different numbers apart', () => {
    expect(phoneTail('+201165251497')).not.toBe(phoneTail('+201165251498'));
  });
});
