import type { Article, BrandKey, Decision, Kind, SectionKey } from './types';
import * as care from './content/care';
import * as ops from './content/ops';
import * as web from './content/web';
import * as team from './content/team';

export type { Article, Decision, SectionKey, BrandKey, Kind } from './types';

/** The Playbook's sections, in the order the home page shows them. tint is a console tint name. */
export const SECTIONS: { key: SectionKey; label: string; blurb: string; icon: string; tint: string }[] = [
  { key: 'customer-service', label: 'Customer Service', blurb: 'Chats, calls, tone, order questions and escalation', icon: 'MessagesSquare', tint: 'rose' },
  { key: 'operations', label: 'Operations', blurb: 'The order floor: queues, pick & pack, Lucida, daily routine', icon: 'Workflow', tint: 'blue' },
  { key: 'shipping', label: 'Shipping & Delivery', blurb: 'Couriers, zones, fees, waybills and delivery problems', icon: 'Truck', tint: 'cyan' },
  { key: 'returns', label: 'Returns & Exchanges', blurb: 'From the request to the refund or store credit', icon: 'Undo2', tint: 'amber' },
  { key: 'payments', label: 'Payments', blurb: 'Card, KNET, cash on delivery, refunds and checks', icon: 'CreditCard', tint: 'green' },
  { key: 'website', label: 'Website / Shopify', blurb: 'Products, photos, sale and promo rules, the themes', icon: 'Store', tint: 'violet' },
  { key: 'policies', label: 'Policies', blurb: 'The rules customers and the team live by', icon: 'Scale', tint: 'red' },
  { key: 'team', label: 'Team Processes', blurb: 'Access, approvals, the console and how we work', icon: 'Users', tint: 'neutral' },
  { key: 'apps', label: 'Mobile Apps', blurb: 'The FIG and Labesny apps: rules and status', icon: 'Smartphone', tint: 'blue' },
  { key: 'faq', label: 'FAQ', blurb: 'Quick answers to what the team asks most', icon: 'CircleHelp', tint: 'amber' },
  { key: 'templates', label: 'Ready Responses', blurb: 'Copy-ready replies in English and Arabic', icon: 'MessageSquareQuote', tint: 'green' },
];

export const SECTION_OF = Object.fromEntries(SECTIONS.map((s) => [s.key, s])) as Record<SectionKey, (typeof SECTIONS)[number]>;

export const BRANDS: Record<BrandKey, { label: string; short: string; color: string }> = {
  all: { label: 'All brands', short: 'All', color: 'var(--ink-3)' },
  fig: { label: 'FIG Egypt', short: 'FIG', color: 'var(--signal)' },
  labesny: { label: 'Labesny Kuwait', short: 'Labesny', color: '#f2a7b0' },
  womensecret: { label: "Women'secret", short: 'WS', color: '#c9b8a6' },
};

export const KINDS: Record<Kind, string> = {
  sop: 'SOP',
  policy: 'Policy',
  decision: 'Decision',
  guide: 'Guide',
  faq: 'FAQ',
  reference: 'Reference',
};

const all = [...care.ARTICLES, ...ops.ARTICLES, ...web.ARTICLES, ...team.ARTICLES];
// one article per slug: the first writer wins if two areas wrote the same one
export const ARTICLES: Article[] = all.filter((a, i) => all.findIndex((b) => b.slug === a.slug) === i);

export const DECISIONS: Decision[] = [...care.DECISIONS, ...ops.DECISIONS, ...web.DECISIONS, ...team.DECISIONS].sort((a, b) => b.date.localeCompare(a.date));

export const article = (slug: string) => ARTICLES.find((a) => a.slug === slug) ?? null;

/** Every ready reply in the library, with the article it belongs to. */
export const TEMPLATES = ARTICLES.flatMap((a) => a.templates.map((t, i) => ({ ...t, id: `${a.slug}-${i}`, slug: a.slug, article: a.title, section: a.section, brands: a.brands })));

/** The words an article is found by: its title weighs most, then its summary and tags, then the body. */
export function searchText(a: Article) {
  return {
    head: `${a.title} ${a.summary} ${a.tags.join(' ')}`.toLowerCase(),
    body: [a.purpose, ...a.when, ...a.steps.flatMap((s) => [s.title, s.detail ?? '', s.tip ?? '']), ...a.rules.map((r) => r.text), ...a.templates.map((t) => `${t.name} ${t.body}`)].join(' ').toLowerCase(),
  };
}

/** The slim card the home page lists and searches, so the page does not ship every article's body twice. */
export type Card = {
  slug: string;
  title: string;
  summary: string;
  section: SectionKey;
  kind: Kind;
  brands: BrandKey[];
  updated: string;
  steps: number;
  templates: number;
  shots: number;
  head: string;
  body: string;
};

export const cards = (): Card[] =>
  ARTICLES.map((a) => ({ slug: a.slug, title: a.title, summary: a.summary, section: a.section, kind: a.kind, brands: a.brands, updated: a.updated, steps: a.steps.length, templates: a.templates.length, shots: a.shots.length, ...searchText(a) }));

/** What the Ctrl K palette searches: every article's title, summary and tags, small enough to send with each page. */
export const kbIndex = () => ARTICLES.map((a) => ({ slug: a.slug, title: a.title, words: `${a.title} ${a.summary} ${a.tags.join(' ')}`.toLowerCase() }));
