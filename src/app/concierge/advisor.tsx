'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Mail, Phone, X } from 'lucide-react';

/* The client advisor's window. It holds the conversation, streams the advisor's words as they are
   written, and draws what the advisor puts on screen: product cards, tappable choices, and the
   hand-off to a person on WhatsApp.

   The conversation survives moving between pages of the shop (the frame reloads with every page),
   because it is kept in this tab's session storage; it is gone when the tab closes. */

type Card = {
  handle: string;
  title: string;
  brand: string;
  url: string;
  image: string | null;
  price: string;
  was: string | null;
  sizesInStock: string[];
};

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'products'; items: Card[]; caption?: string }
  | { kind: 'choices'; options: string[] }
  | { kind: 'handoff'; whatsapp: string; phone: string; email: string; hours: string; open: boolean };

type Turn = { role: 'user'; text: string } | { role: 'assistant'; parts: Part[] };

type Team = { open: boolean; hours: string; opens: number; phone: string; email: string; whatsapp: string };
type Lang = 'en' | 'ar';
type PageContext = { url?: string; title?: string; productHandle?: string } | null;
/** A customer signed in on the storefront, as the theme signed them; Relay checks the signature. */
type Customer = { email: string; id: string; sig: string; name?: string } | null;

const T = {
  en: {
    advisor: 'Customer Service',
    teamOpen: 'Our team is available',
    teamAway: (h: number) => `Our team is back at ${h}am`,
    greeting: (part: string, name?: string) => `Good ${part}${name ? `, ${name}` : ''}.`,
    intro: 'I’m here to help you find something beautiful — a gift, the right size, or anything about your order.',
    starters: ['New arrivals', 'On sale', 'Find a gift', 'Help with sizing', 'Delivery & payment', 'Returns & exchanges', 'Track my order'],
    placeholder: 'Write a message…',
    send: 'Send',
    close: 'Close',
    view: 'View',
    from: 'Sizes',
    handoffTitle: 'Continue with our team',
    handoffWa: 'Continue on WhatsApp',
    handoffAway: (h: number) => `We’re away right now and will reply from ${h}am.`,
    thinking: 'One moment…',
    note: 'Live prices and availability from the boutique.',
    lang: 'عربي',
    failed: 'I couldn’t reach the boutique just now. Please try again in a moment.',
    morning: 'morning',
    afternoon: 'afternoon',
    evening: 'evening',
  },
  ar: {
    advisor: 'خدمة العملاء',
    teamOpen: 'فريقنا متواجد الآن',
    teamAway: (h: number) => `يعود فريقنا الساعة ${h} صباحاً`,
    greeting: (part: string, name?: string) => (name ? `${part} ${name}` : part),
    intro: 'أنا هنا لمساعدتك في اختيار ما يناسبك — هدية مميزة، المقاس الصحيح، أو أي استفسار عن طلبك.',
    starters: ['وصل حديثاً', 'التخفيضات', 'أبحث عن هدية', 'مساعدة في اختيار المقاس', 'التوصيل والدفع', 'الاستبدال والاسترجاع', 'تتبع طلبي'],
    placeholder: 'اكتب رسالتك…',
    send: 'إرسال',
    close: 'إغلاق',
    view: 'عرض',
    from: 'المقاسات',
    handoffTitle: 'تابع مع فريقنا',
    handoffWa: 'المتابعة عبر واتساب',
    handoffAway: (h: number) => `نحن خارج أوقات العمل الآن، وسنرد عليك من الساعة ${h} صباحاً.`,
    thinking: 'لحظة من فضلك…',
    note: 'الأسعار والتوفر مباشرة من البوتيك.',
    lang: 'EN',
    failed: 'تعذّر الوصول إلى البوتيك الآن. حاول مرة أخرى بعد قليل.',
    morning: 'صباح الخير',
    afternoon: 'مساء الخير',
    evening: 'مساء الخير',
  },
} as const;

const KEY = (store: string) => `concierge:${store}`;

function partOfDay(): 'morning' | 'afternoon' | 'evening' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kuwait' }).format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

type Props = { store: string; brand: string; embedded: boolean; initialLang: Lang; team: Team };

/** The saved conversation lives in the browser, so the panel is drawn there and nowhere else. */
export function Advisor(props: Props) {
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return inBrowser ? <Panel {...props} /> : <section className="cg-panel" aria-busy />;
}

function restore(store: string): { turns?: Turn[]; lang?: Lang } {
  try {
    return JSON.parse(sessionStorage.getItem(KEY(store)) ?? '{}');
  } catch {
    /* private mode or cleared storage: start fresh */
    return {};
  }
}

function Panel({ store, brand, embedded, initialLang, team }: Props) {
  const [saved] = useState(() => restore(store));
  const [lang, setLang] = useState<Lang>(saved.lang === 'ar' || saved.lang === 'en' ? saved.lang : initialLang);
  const [turns, setTurns] = useState<Turn[]>(Array.isArray(saved.turns) ? saved.turns : []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState<PageContext>(null);
  const [customer, setCustomer] = useState<Customer>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const t = T[lang];

  /* The page the shopper is on, from the launcher on the storefront. */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string; title?: string; productHandle?: string; lang?: string; customer?: Customer };
      if (d?.type !== 'concierge:page') return;
      setPage({ url: d.url?.slice(0, 500), title: d.title?.slice(0, 200), productHandle: d.productHandle?.slice(0, 200) });
      const c = d.customer;
      setCustomer(c?.email && c.id && c.sig ? { email: String(c.email), id: String(c.id), sig: String(c.sig), name: c.name ? String(c.name).slice(0, 60) : undefined } : null);
      if (d.lang === 'ar') setLang('ar');
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: 'concierge:ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY(store), JSON.stringify({ turns: turns.slice(-40), lang }));
    } catch {
      /* not essential */
    }
  }, [turns, lang, store]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, status]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim().slice(0, 2000);
      if (!clean || busy) return;
      const next: Turn[] = [...turns, { role: 'user', text: clean }];
      setTurns([...next, { role: 'assistant', parts: [] }]);
      setDraft('');
      setBusy(true);
      setStatus(null);
      abort.current = new AbortController();

      /* What the server reads: the text of each turn, and which products an advisor turn showed. */
      /* The recent part of the conversation is plenty to answer from; a long chat stays within what
         the server accepts. */
      const history = next.slice(-20).map((turn) =>
        turn.role === 'user'
          ? { role: 'user' as const, text: turn.text }
          : {
              role: 'assistant' as const,
              text: turn.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('').slice(0, 2000) || '…',
              shown: turn.parts.flatMap((p) => (p.kind === 'products' ? p.items.map((i) => i.handle) : [])).slice(0, 12),
            },
      );

      const append = (fn: (parts: Part[]) => Part[]) =>
        setTurns((all) => {
          const copy = all.slice();
          const last = copy[copy.length - 1];
          if (last?.role === 'assistant') copy[copy.length - 1] = { role: 'assistant', parts: fn(last.parts) };
          return copy;
        });

      try {
        const res = await fetch('/api/concierge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ store, page, customer: customer && { email: customer.email, id: customer.id, sig: customer.sig }, messages: history }),
          signal: abort.current.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { message?: string };
          append((parts) => [...parts, { kind: 'text', text: j.message ?? t.failed }]);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const line = buffer.slice(0, cut).replace(/^data: /, '');
            buffer = buffer.slice(cut + 2);
            let e: { t: string; d?: string } & Record<string, unknown>;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.t === 'text' && e.d) {
              setStatus(null);
              append((parts) => {
                const last = parts[parts.length - 1];
                return last?.kind === 'text' ? [...parts.slice(0, -1), { kind: 'text', text: last.text + e.d }] : [...parts, { kind: 'text', text: e.d! }];
              });
            } else if (e.t === 'status' && e.d) {
              setStatus(e.d);
            } else if (e.t === 'products') {
              append((parts) => [...parts, { kind: 'products', items: e.items as Card[], caption: e.caption as string | undefined }]);
            } else if (e.t === 'choices') {
              append((parts) => [...parts, { kind: 'choices', options: e.options as string[] }]);
            } else if (e.t === 'handoff') {
              append((parts) => [...parts, { kind: 'handoff', ...(e as unknown as Omit<Extract<Part, { kind: 'handoff' }>, 'kind'>) }]);
            } else if (e.t === 'error' && e.d) {
              append((parts) => [...parts, { kind: 'text', text: e.d! }]);
            }
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) append((parts) => [...parts, { kind: 'text', text: t.failed }]);
      } finally {
        setBusy(false);
        setStatus(null);
        abort.current = null;
        input.current?.focus();
      }
    },
    [busy, customer, page, store, t.failed, turns],
  );

  /* The quick replies belong to the advisor's latest turn only, and only until the shopper answers. */
  const lastIndex = turns.length - 1;
  const welcome = turns.length === 0;
  const part = partOfDay();
  const firstName = customer?.name?.split(/s+/)[0];
  const greeting = lang === 'ar' ? t.greeting(t[part], firstName) : t.greeting(part, firstName);

  const close = () => window.parent !== window && window.parent.postMessage({ type: 'concierge:close' }, '*');
  const switchLang = () => setLang((l) => (l === 'en' ? 'ar' : 'en'));

  const statusLine = useMemo(() => (team.open ? t.teamOpen : t.teamAway(team.opens)), [t, team]);

  return (
    <section className="cg-panel" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} aria-label={`${brand} ${t.advisor}`}>
      <header className="cg-head">
        <div className="cg-id">
          <span className="cg-mark">{brand}</span>
          <span className="cg-role">{t.advisor}</span>
        </div>
        <div className="cg-head-tools">
          <button type="button" className="cg-lang" onClick={switchLang} lang={lang === 'en' ? 'ar' : 'en'}>
            {t.lang}
          </button>
          {embedded && (
            <button type="button" className="cg-icon" onClick={close} aria-label={t.close}>
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>
      <p className="cg-presence" data-open={team.open || undefined}>
        <i aria-hidden />
        {statusLine} · {team.hours}
      </p>

      <div className="cg-scroll" ref={scroller} aria-live="polite">
        {welcome && (
          <div className="cg-welcome">
            <h1 className="cg-greet">{greeting}</h1>
            <p>{t.intro}</p>
            <div className="cg-chips">
              {t.starters.map((s) => (
                <button key={s} type="button" className="cg-chip" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <p key={i} className="cg-you" dir="auto">
              {turn.text}
            </p>
          ) : (
            <div key={i} className="cg-them">
              {turn.parts.length === 0 && busy && i === lastIndex && (
                <p className="cg-wait">
                  <span className="cg-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  {status ?? t.thinking}
                </p>
              )}
              {turn.parts.map((p, j) => {
                if (p.kind === 'text') return <Prose key={j} text={p.text} />;
                if (p.kind === 'products') return <Products key={j} items={p.items} caption={p.caption} viewLabel={t.view} sizesLabel={t.from} />;
                if (p.kind === 'choices')
                  return i === lastIndex && !busy ? (
                    <div key={j} className="cg-chips">
                      {p.options.map((o) => (
                        <button key={o} type="button" className="cg-chip" onClick={() => void send(o)} dir="auto">
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : null;
                return <Handoff key={j} h={p} t={t} opens={team.opens} />;
              })}
              {turn.parts.length > 0 && busy && i === lastIndex && status && (
                <p className="cg-wait">
                  <span className="cg-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  {status}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="cg-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          dir="auto"
        />
        <button type="submit" className="cg-send" disabled={busy || !draft.trim()} aria-label={t.send}>
          <ArrowUp className="size-4" />
        </button>
      </form>
      <p className="cg-note">{t.note}</p>
    </section>
  );
}

/** The advisor's words: paragraphs, **bold**, and links, nothing else. */
function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} className="cg-says" dir="auto">
          {inline(para)}
        </p>
      ))}
    </>
  );
}

function inline(s: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>);
    else {
      const href = m[3] ?? m[4];
      out.push(
        <a key={k++} href={href} target="_top" rel="noopener">
          {m[2] ?? href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function Products({ items, caption, viewLabel, sizesLabel }: { items: Card[]; caption?: string; viewLabel: string; sizesLabel: string }) {
  return (
    <div className="cg-products">
      {caption && <span className="cg-caption">{caption}</span>}
      <ul className="cg-rail">
        {items.map((p) => (
          <li key={p.handle}>
            <a className="cg-card" href={p.url} target="_top" rel="noopener">
              <span className="cg-card-img">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : null}
              </span>
              <span className="cg-card-brand">{p.brand}</span>
              <span className="cg-card-title" dir="auto">
                {p.title}
              </span>
              <span className="cg-card-price">
                <b className="cg-money" data-sale={p.was ? '' : undefined}>
                  {p.price}
                </b>
                {p.was && <s className="cg-money">{p.was}</s>}
              </span>
              {p.sizesInStock.length > 0 && (
                <span className="cg-card-sizes">
                  {sizesLabel}: {p.sizesInStock.slice(0, 6).join(' · ')}
                  {p.sizesInStock.length > 6 ? ' …' : ''}
                </span>
              )}
              <span className="cg-card-view">{viewLabel}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Handoff({ h, t, opens }: { h: Extract<Part, { kind: 'handoff' }>; t: (typeof T)[Lang]; opens: number }) {
  return (
    <div className="cg-handoff">
      <span className="cg-caption">{t.handoffTitle}</span>
      <a className="cg-wa" href={h.whatsapp} target="_blank" rel="noopener">
        <WhatsAppGlyph />
        {t.handoffWa}
      </a>
      {!h.open && <p className="cg-away">{t.handoffAway(opens)}</p>}
      <div className="cg-contact">
        <a href={`tel:${h.phone.replace(/\s/g, '')}`}>
          <Phone className="size-3.5" />
          <span className="cg-money">{h.phone}</span>
        </a>
        <a href={`mailto:${h.email}`}>
          <Mail className="size-3.5" />
          <span>{h.email}</span>
        </a>
      </div>
      <p className="cg-hours">{h.hours}</p>
    </div>
  );
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2Zm5.8 14.13c-.24.69-1.42 1.32-1.96 1.4-.5.08-1.13.11-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.02-2.42.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.66.5.24.58.82 2.01.89 2.16.07.14.12.31.02.5-.1.19-.14.31-.29.48-.14.17-.3.38-.43.5-.14.14-.29.3-.13.59.17.29.74 1.22 1.59 1.98 1.09.97 2.01 1.27 2.3 1.42.29.14.46.12.63-.07.17-.19.72-.84.92-1.13.19-.29.38-.24.65-.14.27.1 1.68.79 1.97.94.29.14.48.22.55.34.07.12.07.69-.17 1.37Z" />
    </svg>
  );
}
