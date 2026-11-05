// The Playbook: the team's SOPs, policies, decisions and ready replies, in one typed library.
// Every article is plain data so the list, the search and the article page read the same thing.

export type SectionKey =
  | 'customer-service'
  | 'operations'
  | 'shipping'
  | 'returns'
  | 'payments'
  | 'website'
  | 'policies'
  | 'team'
  | 'apps'
  | 'faq'
  | 'templates';

export type BrandKey = 'fig' | 'labesny' | 'womensecret' | 'all';

export type Kind = 'sop' | 'policy' | 'decision' | 'guide' | 'faq' | 'reference';

export type Step = {
  title: string;
  /** what exactly to do, in one or two sentences */
  detail?: string;
  /** a short warning or shortcut for this step */
  tip?: string;
};

export type Rule = {
  text: string;
  /** a hard rule (shown red): breaking it costs money or a customer */
  hard?: boolean;
};

export type KbLink = {
  label: string;
  /** a console path ("/returns") or a full URL */
  href: string;
  note?: string;
};

export type Template = {
  name: string;
  channel: 'whatsapp' | 'email' | 'instagram' | 'phone' | 'any';
  lang: 'en' | 'ar';
  /** {{placeholders}} in double braces are highlighted for the agent to fill */
  body: string;
};

/** A point on a screenshot: x and y are percentages of the image, from the top-left. */
export type Mark = {
  x: number;
  y: number;
  label: string;
  /** which side the note sits on, the arrow points back at the point */
  side?: 'left' | 'right' | 'top' | 'bottom';
};

export type Shot = {
  /** under /public: "/kb/returns-board.png" */
  src: string;
  caption: string;
  marks: Mark[];
};

export type Article = {
  slug: string;
  title: string;
  section: SectionKey;
  kind: Kind;
  brands: BrandKey[];
  /** one line under the title and in search results */
  summary: string;
  purpose: string;
  /** when to open this: situations, in the agent's words */
  when: string[];
  steps: Step[];
  rules: Rule[];
  links: KbLink[];
  templates: Template[];
  shots: Shot[];
  /** other articles' slugs */
  related: string[];
  tags: string[];
  /** who decided it and when, e.g. "Dan, 3 Nov 2026" */
  owner?: string;
  /** ISO date the content was last true */
  updated: string;
};

export type Decision = {
  /** ISO date */
  date: string;
  who: string;
  title: string;
  decision: string;
  why: string;
  section: SectionKey;
  brands: BrandKey[];
  /** the article that carries it out */
  article?: string;
};
