// Where an order came from (Dan, 7 Nov: "tell me which orders are coming from"). Shopify's customer
// journey names the visit's source; the landing page's fbclid / utm_* say when it was an ad. Pure, so
// the connector, the webhook and the tests all read it the same way.

export type TrafficKind = 'meta_ad' | 'google_ad' | 'social' | 'search' | 'ai' | 'email' | 'referral' | 'direct' | 'app';

export type OrderTraffic = {
  kind: TrafficKind;
  /** what staff read: "Instagram", "Meta ad", "Google (search)", "Direct" */
  label: string;
  campaign?: string | null;
  /** the first visit's label, when the customer first came another way */
  first?: string | null;
  landing?: string | null;
  referrer?: string | null;
  /** read from the webhook's landing page only: a full journey replaces it, never the other way round */
  rough?: boolean;
};

export const TRAFFIC_KINDS: { kind: TrafficKind; label: string }[] = [
  { kind: 'meta_ad', label: 'Meta ad' },
  { kind: 'google_ad', label: 'Google ad' },
  { kind: 'social', label: 'Social (not paid)' },
  { kind: 'search', label: 'Google search' },
  { kind: 'ai', label: 'AI chat' },
  { kind: 'email', label: 'Email' },
  { kind: 'referral', label: 'Other site' },
  { kind: 'direct', label: 'Direct' },
  { kind: 'app', label: 'App' },
];

type Utm = { source?: string | null; medium?: string | null; campaign?: string | null } | null | undefined;

export type JourneyVisit = {
  source?: string | null;
  sourceType?: string | null;
  referrerUrl?: string | null;
  landingPage?: string | null;
  utmParameters?: Utm;
} | null;

export type JourneySummary = { firstVisit?: JourneyVisit; lastVisit?: JourneyVisit } | null | undefined;

const META = /^(facebook|fb|instagram|ig|meta|messenger)$/i;
const PAID = /^(paid|cpc|ppc|cpm|ads?|paid[_-]?social|paidsocial|sponsored)$/i;
const AI = /chatgpt|openai|perplexity|gemini|copilot|claude/i;

function params(url: string | null | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  try {
    return new URL(url, 'https://x.invalid').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

const social = (s: string) => (/insta|^ig$/i.test(s) ? 'Instagram' : /tiktok/i.test(s) ? 'TikTok' : /snap/i.test(s) ? 'Snapchat' : /whatsapp/i.test(s) ? 'WhatsApp' : 'Facebook');

/** One visit → kind and label. `shop` is the store's own host: a referrer from it is not a source. */
export function visitTraffic(v: JourneyVisit, shop?: string | null): Omit<OrderTraffic, 'first'> | null {
  if (!v) return null;
  const q = params(v.landingPage);
  const utm = {
    source: (v.utmParameters?.source ?? q.get('utm_source') ?? '').trim(),
    medium: (v.utmParameters?.medium ?? q.get('utm_medium') ?? '').trim(),
    campaign: (v.utmParameters?.campaign ?? q.get('utm_campaign') ?? '').trim() || null,
  };
  const src = (v.source ?? '').trim();
  const ref = host(v.referrerUrl);
  // the store's own pages as referrer (a visit that restarted mid-browse) are not a source
  const home = (shop ?? host(v.landingPage) ?? '').replace(/^www\./, '').toLowerCase();
  const own = !!ref && !!home && (ref === home || ref.endsWith(`.${home}`) || /(^|\.)myshopify\.com$/.test(ref));
  const base = { campaign: utm.campaign, landing: v.landingPage ?? null, referrer: own ? null : (v.referrerUrl ?? null) };
  const out = (kind: TrafficKind, label: string) => ({ kind, label, ...base });

  // fbclid alone is not an ad: Meta adds it to every link out of Facebook and Instagram, posts and bios too.
  // An ad says so in its tags (utm_medium=paid), which the ads carry once Ads Manager's URL parameters are set.
  if (META.test(utm.source) && PAID.test(utm.medium)) return out('meta_ad', 'Meta ad');
  if (q.has('gclid') || q.has('gbraid') || q.has('wbraid') || (/google/i.test(utm.source) && PAID.test(utm.medium)) || /^sem$/i.test(v.sourceType ?? '')) return out('google_ad', 'Google ad');
  if (PAID.test(utm.medium) && utm.source) return out('referral', `${utm.source} ad`);
  if (/^e?mail$|newsletter/i.test(utm.medium) || /^email$/i.test(v.sourceType ?? '')) return out('email', 'Email');
  if (AI.test(src) || AI.test(utm.source) || AI.test(ref ?? '')) return out('ai', /chatgpt|openai/i.test(`${src} ${utm.source} ${ref}`) ? 'ChatGPT' : 'AI chat');
  const socialName = [src, utm.source, ref ?? ''].find((s) => /facebook|^fb$|insta|^ig$|tiktok|snap|whatsapp|messenger/i.test(s));
  if (socialName || /^social$/i.test(v.sourceType ?? '')) return out('social', social(socialName ?? src));
  if (q.has('fbclid')) return out('social', 'Facebook / Instagram');
  if (/^seo$/i.test(v.sourceType ?? '') || /google|bing|yahoo|duckduckgo/i.test(src || ref || '')) return out('search', `${/bing/i.test(src || ref || '') ? 'Bing' : 'Google'} (search)`);
  if (utm.source) return out('referral', utm.source);
  if (ref && !own && !/^direct$/i.test(src)) return out('referral', ref);
  return out('direct', 'Direct');
}

/** Orders placed in FIG's and Labesny's apps. */
export const APP_TRAFFIC: OrderTraffic = { kind: 'app', label: 'App' };

/** The order's source from Shopify's customer journey: the last visit decides, the first is kept beside it. */
export function journeyTraffic(j: JourneySummary, shop?: string | null): OrderTraffic | null {
  const last = visitTraffic(j?.lastVisit ?? null, shop);
  const first = visitTraffic(j?.firstVisit ?? null, shop);
  const pick = last ?? first;
  if (!pick) return null;
  // a "direct" last visit after an ad or a post: the ad brought them, the return visit only closed it
  const lead = last?.kind === 'direct' && first && first.kind !== 'direct' ? first : pick;
  return { ...lead, first: first && first.label !== lead.label ? first.label : null };
}

/** The REST webhook only carries landing_site and referring_site. */
export function sitesTraffic(landing: string | null | undefined, referrer: string | null | undefined, shop?: string | null): OrderTraffic | null {
  if (!landing && !referrer) return null;
  const t = visitTraffic({ landingPage: landing ?? null, referrerUrl: referrer ?? null, source: host(referrer) ?? '' }, shop);
  return t ? { ...t, first: null, rough: true } : null;
}
