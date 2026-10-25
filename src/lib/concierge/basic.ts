import 'server-only';
import type { ChannelDef } from '../channels';
import { searchProducts, storeKnowledge, type ProductCard, type StorePage } from './catalog';
import { myOrders, orderDetail, type Identity } from './orders';
import { teamOpen, whatsappLink, type House } from './persona';
import type { UiEvent } from './tools';

/**
 * The advisor without Claude: what it can still do when no API key is set, or Claude is down.
 *
 * It is not a model and does not pretend to be one. It recognises the handful of things shoppers
 * ask most — something new, something on sale, a gift, a brand or a category; delivery, payment,
 * returns, sizes, opening hours; their order — answers each from the live store and the shop's own
 * pages, and offers the next steps as tappable choices. The team is offered when the shopper asks
 * for a person, never as the first thing.
 */

type Send = (e: UiEvent | { t: 'text'; d: string }) => void;
type Lang = 'en' | 'ar';

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

const BRANDS: [RegExp, string][] = [
  [/la\s*vie\s*en\s*rose|lavie|لافي/i, 'La vie en rose'],
  [/women'?\s*secret|womensecret|ويمن/i, 'Women Secret'],
  [/hunkem[oö]ller|هونك/i, 'Hunkemoller'],
  [/\betam\b|ايتام|إيتام/i, 'Etam'],
  [/yamamay|يامامي/i, 'Yamamay'],
  [/tom\s*tailor|تومتيلور|توم تيلور/i, 'Tomtailor'],
  [/\bbebe\b|بيبي/i, 'Bebe'],
  [/benetton|بينيتون/i, 'Benetton'],
  [/celio|سيليو/i, 'Celio'],
  [/springfield|سبرينغفيلد/i, 'Springfield'],
];

const CATEGORIES: [RegExp, string][] = [
  [/bras?\b|bralette|صدري|ستيان/i, 'bra'],
  [/pant(y|ies)|brief|thong|knicker|كلسون|سروال داخلي/i, 'panty'],
  [/pyjama|pajama|sleep|nightwear|بيجام|نوم/i, 'pyjama'],
  [/lingerie|لانجري/i, 'lingerie'],
  [/dress|فستان/i, 'dress'],
  [/jean|denim|جينز/i, 'jeans'],
  [/shirt|قميص/i, 'shirt'],
  [/t-?shirt|tee|تيشيرت/i, 't-shirt'],
  [/swim|bikini|مايوه|بكيني/i, 'bikini'],
  [/robe|روب/i, 'robe'],
  [/sock|جوارب/i, 'socks'],
  [/jacket|coat|جاكيت|معطف/i, 'jacket'],
];

const has = (s: string, re: RegExp) => re.test(s);

const COPY = {
  en: {
    hello: (name?: string) => `Hello${name ? ` ${name}` : ''}, and welcome to Labesny. What can I help you with today?`,
    menu: ['New arrivals', 'On sale', 'Find a gift', 'Delivery & payment', 'Returns & exchanges', 'Track my order'],
    new: 'Here are a few of the newest pieces to arrive.',
    sale: 'A few of the pieces currently reduced.',
    found: (brand?: string) => `Here are a few ${brand ? `${brand} ` : ''}pieces you might like.`,
    none: 'I couldn’t find that in stock right now. Could you tell me a little more — a brand, a colour or a type of piece?',
    gift: 'A lovely idea. Who is the gift for?',
    giftFor: ['For her', 'For him', 'For kids', 'Under KWD 10'],
    delivery: 'Here is how delivery and payment work:',
    returns: 'Here is our exchange and refund policy:',
    size: 'Every product page shows the sizes currently in stock. Tell me the piece and your usual size, or the brand you usually wear, and I’ll show you what’s available.',
    hours: (h: House, open: boolean) => `Our team is with you ${h.hoursLabel}${open ? ' — they’re available right now.' : '.'} You can reach them on WhatsApp or by phone at ${h.phone}, or by email at ${h.email}.`,
    orderAsk: 'I can check that for you. Please send your order number together with the email or phone number you used for the order — or sign in to your account and I’ll find all your orders.',
    orderMissing: 'I couldn’t find an order with those details. Please check the order number and the email or phone used on the order.',
    myOrders: 'Here are your recent orders:',
    noOrders: 'I don’t see any orders on your account yet.',
    human: 'Of course — a member of our team will continue with you on WhatsApp.',
    fallback: 'I can help you find something from the collection, or answer questions about delivery, payment, returns and your orders. What would you like to do?',
    more: ['Show me more', 'Delivery & payment', 'Speak to the team'],
    readMore: 'Read the full page',
  },
  ar: {
    hello: (name?: string) => `أهلاً${name ? ` ${name}` : ''} ومرحباً بك في لابسني. كيف يمكنني مساعدتك اليوم؟`,
    menu: ['وصل حديثاً', 'التخفيضات', 'أبحث عن هدية', 'التوصيل والدفع', 'الاستبدال والاسترجاع', 'تتبع طلبي'],
    new: 'إليك بعض أحدث القطع التي وصلت.',
    sale: 'إليك بعض القطع المخفّضة حالياً.',
    found: () => 'إليك بعض القطع التي قد تعجبك.',
    none: 'لم أجد هذا متوفراً حالياً. هل يمكنك إخباري بالمزيد — الماركة أو اللون أو نوع القطعة؟',
    gift: 'فكرة جميلة. لمن الهدية؟',
    giftFor: ['لها', 'له', 'للأطفال', 'أقل من ١٠ د.ك'],
    delivery: 'إليك تفاصيل التوصيل والدفع:',
    returns: 'إليك سياسة الاستبدال والاسترجاع:',
    size: 'تعرض كل صفحة منتج المقاسات المتوفرة حالياً. أخبرني بالقطعة ومقاسك المعتاد أو الماركة التي تلبسها عادةً، وسأعرض لك المتوفر.',
    hours: (h: House, open: boolean) => `فريقنا متواجد ${h.hoursLabel}${open ? ' — وهو متاح الآن.' : '.'} يمكنك التواصل عبر واتساب أو الهاتف ${h.phone}، أو البريد ${h.email}.`,
    orderAsk: 'يسعدني التحقق من ذلك. أرسل رقم الطلب مع البريد الإلكتروني أو رقم الهاتف المستخدم في الطلب — أو سجّل الدخول إلى حسابك وسأعرض لك جميع طلباتك.',
    orderMissing: 'لم أجد طلباً بهذه البيانات. يرجى التأكد من رقم الطلب والبريد أو الهاتف المستخدم.',
    myOrders: 'إليك طلباتك الأخيرة:',
    noOrders: 'لا توجد طلبات على حسابك بعد.',
    human: 'بكل سرور — سيتابع معك أحد أعضاء فريقنا عبر واتساب.',
    fallback: 'يمكنني مساعدتك في اختيار قطعة من المجموعة، أو الإجابة عن التوصيل والدفع والاسترجاع وطلباتك. ماذا تودّ أن تفعل؟',
    more: ['عرض المزيد', 'التوصيل والدفع', 'التحدث مع الفريق'],
    readMore: 'اقرأ الصفحة كاملة',
  },
} as const;

function page(pages: StorePage[], re: RegExp) {
  return pages.find((p) => re.test(p.handle) || re.test(p.title));
}

export async function basicReply(opts: { text: string; channel: ChannelDef; house: House; who: Identity | null; send: Send }) {
  const { text, channel, house, who, send } = opts;
  const lang: Lang = isArabic(text) ? 'ar' : 'en';
  const c = COPY[lang];
  const s = text.trim().toLowerCase();
  const say = (d: string) => send({ t: 'text', d });
  const choices = (options: readonly string[]) => send({ t: 'choices', options: [...options] });
  const show = (items: ProductCard[], caption?: string) => items.length && send({ t: 'products', items, caption });

  /* A person, when they ask for one. */
  if (has(s, /whats\s*app|human|agent|real person|someone|speak to|talk to|call me|the team|complain|manager|واتساب|موظف|شخص|اكلم|أكلم|التحدث مع|شكوى|الفريق/)) {
    say(c.human);
    send({ t: 'handoff', whatsapp: whatsappLink(house, text), phone: house.phone, email: house.email, hours: house.hoursLabel, open: teamOpen(house) });
    return;
  }

  /* Their order. */
  /* An order number stands on its own ("1058", "#1058", "LB-81442"); the tail of a phone number does not. */
  const number = text.match(/(?:^|[\s#])([a-z]{1,4}-?\d{3,8}|\d{4,8})\b/i)?.[1];
  const contact = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0] ?? text.match(/\+?\d[\d\s-]{7,}\d/)?.[0];
  if (has(s, /order|track|parcel|shipment|where is my|طلب|تتبع|شحنة|وين/) || (number && (contact || who))) {
    if (number && (contact || who)) {
      const o = await orderDetail({ number, contact: contact ?? undefined, who, brand: house.brand });
      if (!o) return say(c.orderMissing);
      const lines = [
        `**${o.number}** — ${o.status}`,
        `${o.placed} · ${o.total} · ${o.payment} (${o.paymentStatus})`,
        o.items.map((i) => `• ${i.quantity > 1 ? `${i.quantity} × ` : ''}${i.name}${i.size ? ` (${i.size})` : ''} — ${i.price}`).join('\n'),
        o.deliverTo ? `${lang === 'ar' ? 'التوصيل إلى' : 'Delivering to'}: ${o.deliverTo}` : '',
        o.trackingNumber ? `${o.courier ?? 'Courier'}: ${o.trackingNumber}${o.trackingUrl ? ` — ${o.trackingUrl}` : ''}` : '',
        o.returns.length ? o.returns.map((r) => `${lang === 'ar' ? 'إرجاع' : 'Return'} ${r.number}: ${r.status}`).join('\n') : '',
      ].filter(Boolean);
      say(lines.join('\n\n'));
      return choices(lang === 'ar' ? ['الاستبدال والاسترجاع', 'التحدث مع الفريق'] : ['Returns & exchanges', 'Speak to the team']);
    }
    if (who) {
      const list = await myOrders(who, house.brand, 6);
      if (!list.length) return say(c.noOrders);
      say(`${c.myOrders}\n\n${list.map((o) => `**${o.number}** · ${o.placed} · ${o.status} · ${o.total}`).join('\n')}`);
      return choices(list.slice(0, 4).map((o) => o.number));
    }
    return say(c.orderAsk);
  }

  const { pages } = await storeKnowledge(channel);

  /* Delivery and payment. */
  if (has(s, /deliver|shipping|ship\b|how long|courier|pay|payment|knet|card|cash|cod|توصيل|شحن|دفع|كي ?نت|بطاقة|كاش/)) {
    const p = page(pages, /shipping|delivery/i);
    say(p ? `${c.delivery}\n\n${p.text}\n\n[${c.readMore}](${p.url})` : c.fallback);
    return choices(c.menu.filter((m) => !/delivery|التوصيل/i.test(m)).slice(0, 4));
  }

  /* Returns and exchanges. */
  if (has(s, /return|exchange|refund|cancel|استرجاع|استبدال|ارجاع|إرجاع|استرداد|الغاء|إلغاء/)) {
    const p = page(pages, /exchange|refund|return/i);
    say(p ? `${c.returns}\n\n${p.text.slice(0, 1400)}\n\n[${c.readMore}](${p.url})` : c.fallback);
    return choices(lang === 'ar' ? ['تتبع طلبي', 'التحدث مع الفريق'] : ['Track my order', 'Speak to the team']);
  }

  /* Sizes. */
  if (has(s, /size|sizing|fit|measure|مقاس|قياس|مقاسات/)) {
    say(c.size);
    return choices(BRANDS.slice(0, 5).map(([, b]) => b));
  }

  /* Hours and contact. */
  if (has(s, /hours|open|contact|phone|number|email|store|branch|mall|location|اوقات|أوقات|ساعات|رقم|تواصل|فرع|محل|مول/)) {
    say(c.hours(house, teamOpen(house)));
    return choices(c.menu.slice(0, 4));
  }

  /* Gifts: ask who for, then show. */
  if (has(s, /gift|present|هدية|هديه/)) {
    say(c.gift);
    return choices(c.giftFor);
  }

  /* Shopping. */
  const brand = BRANDS.find(([re]) => re.test(text))?.[1];
  const category = CATEGORIES.find(([re]) => re.test(text))?.[1];
  const forHer = has(s, /for her|women|woman|ladies|wife|mother|mum|mom|sister|لها|نسائي|زوجتي|امي|أمي|اختي|أختي/);
  const forHim = has(s, /for him|\bmen\b|\bman\b|husband|father|dad|brother|له|رجالي|زوجي|ابوي|أبي|اخوي|أخي/);
  const forKids = has(s, /kid|child|baby|boy|girl|أطفال|اطفال|ولد|بنت/);
  const under = Number(text.match(/(?:under|below|less than|أقل من|اقل من|تحت)\s*(?:kwd|kd|د\.?ك)?\s*([\d٠-٩]+)/i)?.[1]?.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  const isNew = has(s, /new|latest|arrival|season|جديد|وصل|حديث|الموسم/);
  const onSale = has(s, /sale|offer|discount|deal|reduced|تخفيض|خصم|عرض|عروض|تنزيلات/);
  const more = has(s, /more|المزيد/);

  if (brand || category || forHer || forHim || forKids || under || isNew || onSale || more) {
    const items = await searchProducts(channel, {
      brand,
      text: category,
      department: forKids ? 'kids' : forHim ? 'men' : forHer ? 'women' : undefined,
      onSale: onSale || undefined,
      maxPrice: Number.isFinite(under) && under > 0 ? under : undefined,
      /* "For her" means the best-sellers in that department; only "new", or nothing at all, means New Arrivals. */
      newest: isNew || (!category && !brand && !forHer && !forHim && !forKids && !onSale),
      limit: 6,
    });
    if (!items.length) return say(c.none);
    say(isNew ? c.new : onSale ? c.sale : c.found(brand));
    show(items);
    return choices(c.more);
  }

  /* A greeting, or something it doesn't recognise: say hello and offer the ways in. */
  const greeting = has(s, /^(hi|hey|hello|hiya|good (morning|afternoon|evening)|salam|السلام|سلام|مرحبا|مرحباً|هلا|أهلا|اهلا|صباح|مساء)/);
  say(greeting ? c.hello() : c.fallback);
  choices(c.menu);
}
