import { describe, expect, it } from 'vitest';
import { canSee, landingFor, overridesFor, PAGES, ROLES, scopesFor, type Page, type Role } from '../perms';

/* Who is offered which page. The menu, phone tabs, palette and every page guard read canSee, so
   these are the screens each job actually gets. Need-to-know: a queue's people get their queue and
   what their work touches, the whole floor is for the people who run it. */
const job = (role: Role) => ({ role, scopes: scopesFor(role) });
const sees = (role: Role) => (Object.keys(PAGES) as Page[]).filter((p) => canSee(job(role), p));

describe('pages each job sees', () => {
  it('gives everyone at least one page, and lands them on it', () => {
    for (const role of Object.keys(ROLES) as Role[]) {
      expect(sees(role).length, role).toBeGreaterThan(0);
      expect(landingFor(job(role)), role).not.toBeNull();
    }
  });

  it('gives admin every page and management every page but the team-pulse board', () => {
    expect(sees('admin')).toEqual(Object.keys(PAGES));
    expect(sees('viewer')).toEqual((Object.keys(PAGES) as Page[]).filter((p) => p !== 'teamPulse'));
  });

  it('gives a brand manager everything to look at, but not the staff or store-connection pages', () => {
    expect(sees('brand')).toEqual((Object.keys(PAGES) as Page[]).filter((p) => !['teamPulse', 'team', 'channels'].includes(p)));
    expect(landingFor(job('brand'))).toBe('/brands');
  });

  it('lands each job on its own work', () => {
    const land = (r: Role) => landingFor(job(r));
    expect([land('admin'), land('ops'), land('supply')]).toEqual(['/', '/', '/']);
    expect([land('care'), land('finance'), land('fulfilment'), land('shipping'), land('returns')]).toEqual(['/orders', '/queue/finance', '/queue/fulfilment', '/queue/shipping', '/returns']);
    expect([land('warehouse'), land('buyer'), land('planner'), land('merchandiser'), land('marketing')]).toEqual(['/stock/warehouse', '/stock/purchasing', '/stock', '/stock/merch', '/insights']);
  });

  it('keeps the whole floor for the people who run it', () => {
    for (const role of ['admin', 'ops', 'supply', 'viewer'] as Role[]) expect(canSee(job(role), 'home'), role).toBe(true);
    for (const role of ['care', 'finance', 'fulfilment', 'shipping', 'returns', 'warehouse', 'buyer', 'planner', 'marketing', 'merchandiser', 'brand'] as Role[]) {
      if (role === 'brand') continue; // a brand manager reads the whole floor for their brands

      expect(canSee(job(role), 'home'), role).toBe(false);
      expect(canSee(job(role), 'pipeline'), role).toBe(false);
    }
  });

  it('gives customer care the orders and returns, and no stock screens (the confirmation queue is retired)', () => {
    expect(sees('care')).toEqual(['orders', 'returns']);
    expect(landingFor(job('care'))).toBe('/orders');
  });

  it('gives finance its queue, cash, orders, returns, purchase orders, insights and the money picture', () => {
    expect(sees('finance')).toEqual(['orders', 'financeQueue', 'returns', 'brands', 'analytics', 'purchasing', 'production', 'insights', 'financials', 'cash']);
  });

  it('keeps the warehouse on picking, stock and its floor, away from the orders list and money', () => {
    expect(sees('warehouse')).toEqual(['pick', 'inventory', 'warehouse']);
    expect(sees('fulfilment')).toEqual(['pick', 'shipping', 'inventory', 'warehouse']);
    expect(canSee(job('warehouse'), 'cash')).toBe(false);
  });

  it('gives shipping and the returns desk their own queues', () => {
    expect(sees('shipping')).toEqual(['orders', 'shipping', 'couriers', 'returns', 'insights']);
    expect(sees('returns')).toEqual(['shipping', 'returns', 'inventory', 'warehouse']);
  });

  it('gives buying its plan, stock and purchase orders, and the planner the rules too', () => {
    expect(sees('buyer')).toEqual(['brands', 'analytics', 'stockBrief', 'inventory', 'planning', 'purchasing', 'warehouse', 'production']);
    expect(sees('planner')).toEqual(['brands', 'analytics', 'stockBrief', 'inventory', 'planning', 'purchasing', 'warehouse', 'merch', 'webItems', 'production', 'insights', 'rules']);
  });

  it('gives marketing and the merchandiser the numbers and the website, never orders', () => {
    expect(sees('marketing')).toEqual(['brands', 'analytics', 'stockBrief', 'inventory', 'merch', 'webItems', 'insights']);
    expect(sees('merchandiser')).toEqual(['brands', 'analytics', 'stockBrief', 'inventory', 'merch', 'webItems', 'teamPulse', 'insights']);
    expect(canSee(job('marketing'), 'orders')).toBe(false);
  });
});

describe('stored access', () => {
  it('keeps only what differs from the job, so a better preset reaches the person', () => {
    expect(overridesFor('care', scopesFor('care'))).toEqual({});
    expect(overridesFor('care', { ...scopesFor('care'), insights: 1 })).toEqual({ insights: 1 });
    expect(overridesFor('care', { stock: 0 })).toEqual({});
  });
});
