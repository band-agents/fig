import { CHANNELS, channelConfigured, type ChannelDef } from './channels';

/**
 * The two businesses the console runs: FIG (Egypt) and Labesny (D&H and D&Co, Kuwait, with Women'secret
 * Jordan shipping from the Kuwait warehouse). Dan, 24 Oct: the team switches between them at the top of
 * every page, and only between the ones they have access to. The choice narrows the person's stores for
 * the request (session.ts), so every list, figure and export follows without knowing about it.
 */
export type Business = 'fig' | 'labesny';
export type BusinessView = Business | 'all';

export const BUSINESSES: { id: Business; label: string; country: 'EG' | 'KW'; currency: 'EGP' | 'KWD' }[] = [
  { id: 'labesny', label: 'Labesny', country: 'KW', currency: 'KWD' },
  { id: 'fig', label: 'FIG', country: 'EG', currency: 'EGP' },
];

export const BUSINESS_COOKIE = 'relay_business';

export const businessOf = (c: Pick<ChannelDef, 'country'>): Business => (c.country === 'EG' ? 'fig' : 'labesny');

/** The stores a person covers: their own list, or every store when it is empty. */
const storesOf = (p: { channels: string[] }) => (p.channels.length ? CHANNELS.filter((c) => p.channels.includes(c.id)) : CHANNELS);

/**
 * The businesses this person can switch between: the ones holding at least one store they cover that
 * is connected. A business with nothing connected yet (FIG before its keys are in) is not offered.
 */
export function businessesFor(p: { channels: string[] }): Business[] {
  const mine = storesOf(p).filter((c) => !c.parked && channelConfigured(c));
  return BUSINESSES.map((b) => b.id).filter((b) => mine.some((c) => businessOf(c) === b));
}

/** The person's stores inside one business; their full list for 'all' or when there is nothing to narrow. */
export function channelsIn(p: { channels: string[] }, view: BusinessView): string[] {
  if (view === 'all') return p.channels;
  const inside = storesOf(p)
    .filter((c) => businessOf(c) === view)
    .map((c) => c.id);
  return inside.length ? inside : p.channels;
}

export const readView = (v: string | undefined): BusinessView => (v === 'fig' || v === 'labesny' ? v : 'all');
