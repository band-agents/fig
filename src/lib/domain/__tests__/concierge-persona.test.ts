import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyCustomer } from '../../concierge/identity';
import { houseFor, persona, teamOpen, visitContext, whatsappLink } from '../../concierge/persona';

const labesny = houseFor('Labesny');
/** 9 October 2026 at the given hour, Kuwait time (UTC+3). */
const kuwait = (hour: number, minute = 0) => new Date(Date.UTC(2026, 9, 9, hour - 3, minute));

describe('the Labesny team', () => {
  it('has the contact details the client gave', () => {
    expect(labesny.whatsapp).toBe('96569612272');
    expect(labesny.phone).toBe('+965 696 12 272');
    expect(labesny.email).toBe('customer-service@labesny.com');
  });

  it('is at its desks from 9am to 9pm Kuwait time, every day', () => {
    expect(teamOpen(labesny, kuwait(8, 59))).toBe(false);
    expect(teamOpen(labesny, kuwait(9))).toBe(true);
    expect(teamOpen(labesny, kuwait(20, 59))).toBe(true);
    expect(teamOpen(labesny, kuwait(21))).toBe(false);
  });

  it('says when it is away, and when it is back', () => {
    expect(visitContext(labesny, null, null, kuwait(22))).toMatch(/away right now — back at 9:00/);
    expect(visitContext(labesny, null, null, kuwait(12))).toMatch(/available right now/);
  });
});

describe('the WhatsApp hand-off', () => {
  it('opens a chat with the team, the summary already written', () => {
    const url = whatsappLink(labesny, 'Order LB-81442: one Etam bra arrived in the wrong size.');
    expect(url.startsWith('https://wa.me/96569612272?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toContain('Hello Labesny');
    expect(text).toContain('LB-81442');
  });

  it('keeps an overlong summary to a length WhatsApp accepts', () => {
    const url = whatsappLink(labesny, 'x'.repeat(5000));
    expect(decodeURIComponent(url.split('text=')[1]).length).toBeLessThanOrEqual(1200);
  });
});

describe('what the advisor is told', () => {
  const p = persona(labesny);
  it('stays on the boutique and declines everything else', () => {
    expect(p).toMatch(/Only Labesny/);
    expect(p).toMatch(/decline in one gentle sentence/);
  });
  it('never invents a product, a price or stock', () => {
    expect(p).toMatch(/must come from your tools/);
  });
  it('speaks like a person but does not claim to be one', () => {
    expect(p).toMatch(/Never say "As an AI"/);
    expect(p).toMatch(/be honest: you are Labesny's digital client advisor/);
  });
  it('answers in Arabic when the shopper writes in Arabic', () => {
    expect(p).toMatch(/If they write in Arabic, answer in/);
  });
  it('opens with shopping and answers, not the hand-off', () => {
    expect(p).toMatch(/Do not offer the team or call connect_to_human in your first reply/);
  });
  it('gives the team’s hours and numbers', () => {
    expect(p).toContain('+965 696 12 272');
    expect(p).toContain('customer-service@labesny.com');
  });
});

describe('the page the shopper is on', () => {
  it('is passed on, so "this one" means the product they are looking at', () => {
    const c = visitContext(labesny, { url: 'https://labesny.com/products/lace-thong-kaki-olive', productHandle: 'lace-thong-kaki-olive' }, null, kuwait(12));
    expect(c).toContain('lace-thong-kaki-olive');
  });
});

describe('who the advisor is talking to', () => {
  it('knows a signed-in customer and may open their account', () => {
    expect(visitContext(labesny, null, { email: 'maryam@example.com' }, kuwait(12))).toMatch(/signed in as maryam@example.com/);
  });
  it('treats everyone else as a guest', () => {
    expect(visitContext(labesny, null, null, kuwait(12))).toMatch(/not signed in/);
  });
});

describe('a signed-in customer', () => {
  const secret = 'test-secret';
  const sign = (email: string, id: string) => createHmac('sha256', secret).update(`${email}:${id}`).digest('hex');

  it('is believed when the theme’s signature checks out', () => {
    expect(verifyCustomer({ email: 'Maryam@Example.com', id: 7712, sig: sign('maryam@example.com', '7712') }, secret)).toEqual({
      email: 'maryam@example.com',
      customerId: '7712',
    });
  });

  it('is not believed with someone else’s email on the same signature', () => {
    expect(verifyCustomer({ email: 'other@example.com', id: 7712, sig: sign('maryam@example.com', '7712') }, secret)).toBeNull();
  });

  it('is not believed with a forged or missing signature, or with no secret set', () => {
    expect(verifyCustomer({ email: 'maryam@example.com', id: 7712, sig: 'deadbeef' }, secret)).toBeNull();
    expect(verifyCustomer({ email: 'maryam@example.com', id: 7712, sig: '' }, secret)).toBeNull();
    expect(verifyCustomer({ email: 'maryam@example.com', id: 7712, sig: sign('maryam@example.com', '7712') }, '')).toBeNull();
  });
});
