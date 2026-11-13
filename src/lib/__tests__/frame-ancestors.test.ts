import { describe, expect, it } from 'vitest';
import { frameAncestors } from '../../proxy';

describe('frame-ancestors', () => {
  it('lists the shops that may frame the customer pages', () => {
    expect(frameAncestors('https://labesny.com  https://figeg.com')).toBe("frame-ancestors 'self' https://labesny.com https://figeg.com");
  });
  it('is the console only when nothing is set', () => {
    expect(frameAncestors('')).toBe("frame-ancestors 'self'");
  });
  it('drops anything that is not an origin', () => {
    expect(frameAncestors("https://labesny.com; script-src *")).toBe("frame-ancestors 'self'");
    expect(frameAncestors("https://labesny.com 'unsafe-inline'")).toBe("frame-ancestors 'self' https://labesny.com");
  });
});
