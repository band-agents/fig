import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ChannelDef } from '../channels';
import { cardsByHandle, pairings, productDetail, searchProducts, type ProductCard } from './catalog';
import { myOrders, myProfile, orderDetail, type Identity } from './orders';
import { teamOpen, whatsappLink, type House } from './persona';

/**
 * The concierge's tools. Six read (products, one product, what pairs with it, an order, a signed-in
 * customer's orders and profile);
 * three put something on the shopper's screen (product cards, tappable choices, the WhatsApp
 * hand-off). Every input is checked against its schema before anything runs: the request streams
 * tool input as it is generated, which means the API no longer validates it for us.
 */

/** What the chat window draws besides text. */
export type UiEvent =
  | { t: 'products'; items: ProductCard[]; caption?: string }
  | { t: 'choices'; options: string[] }
  | { t: 'handoff'; whatsapp: string; phone: string; email: string; hours: string; open: boolean };

const Search = z.object({
  text: z.string().max(120).optional(),
  brand: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  department: z.enum(['women', 'men', 'kids']).optional(),
  on_sale: z.boolean().optional(),
  min_price: z.number().nonnegative().optional(),
  max_price: z.number().positive().optional(),
  size: z.string().max(20).optional(),
  colour: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
const Handle = z.object({ handle: z.string().min(1).max(200) });
const Order = z.object({ order_number: z.string().min(2).max(40), email_or_phone: z.string().min(5).max(120).optional() });
const Nothing = z.object({}).strict();
const Show = z.object({ handles: z.array(z.string().min(1).max(200)).min(1).max(6), caption: z.string().max(80).optional() });
const Choices = z.object({ options: z.array(z.string().min(1).max(40)).min(2).max(5) });
const Human = z.object({ summary: z.string().min(10).max(900), reason: z.string().max(120).optional() });

const SCHEMAS = {
  search_products: Search,
  get_product: Handle,
  find_pairings: Handle,
  get_order: Order,
  my_orders: Nothing,
  my_profile: Nothing,
  show_products: Show,
  offer_choices: Choices,
  connect_to_human: Human,
} as const;

export type ToolName = keyof typeof SCHEMAS;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_products',
    description:
      'Search the live catalogue. Returns only published pieces that are in stock right now, each with handle, name, brand, type, price (and the pre-sale price when reduced), colour and the sizes in stock. Combine free text with filters; leave filters out rather than guessing them.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'A few descriptive words: "lace bralette", "linen shirt", "satin pyjama", "gift". Not a sentence.' },
        brand: { type: 'string', description: 'Exactly as the store spells it, e.g. "La vie en rose", "Women Secret", "Hunkemoller", "Etam", "Yamamay", "Tomtailor", "Bebe", "Benetton", "Celio", "Springfield".' },
        category: { type: 'string', description: 'A product type or category word, e.g. "Bras", "Pyjamas", "Dresses", "Jeans", "T-shirts".' },
        department: { type: 'string', enum: ['women', 'men', 'kids'] },
        on_sale: { type: 'boolean', description: 'Only reduced pieces.' },
        min_price: { type: 'number', description: 'KWD' },
        max_price: { type: 'number', description: 'KWD' },
        size: { type: 'string', description: 'Only pieces with this size in stock, e.g. "M", "36B", "38".' },
        colour: { type: 'string', description: 'As the store names it, e.g. "Black", "Ecru", "Navy".' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'get_product',
    description:
      'One piece in full: description, fabric and fit notes, every size with whether it is in stock, and the same style in other colours. Use before describing a piece in detail.',
    input_schema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: 'find_pairings',
    description:
      'Pieces that complete a look with the given product — the matching brief for a bra, bottoms for a pyjama top, a robe for nightwear, trousers for a shirt. Same brand, same colour first, in stock.',
    input_schema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: 'get_order',
    description:
      "One order in full: status in the customer's terms, every item with brand, size, quantity and price, subtotal, delivery, discount and total, payment method and whether it is paid, the delivery address, courier and tracking, dates, and any returns on it. A signed-in customer needs only the order number (it must be one of theirs). A guest must also give the email or phone number used on the order; both must match. Returns nothing if they don't.",
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string' },
        email_or_phone: { type: 'string', description: 'Required for guests; leave out when the shopper is signed in.' },
      },
      required: ['order_number'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'my_orders',
    description: "The signed-in customer's orders, newest first: number, date, status, total, items and tracking. Only works when the shopper is signed in.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'my_profile',
    description: "The signed-in customer's details as the shop has them: name, email, phone, last delivery address, number of orders, customer since. Only works when the shopper is signed in.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'show_products',
    description:
      'Show product cards in the chat (image, name, brand, price, sizes, a link to the page). Pass handles from search_products / get_product / find_pairings results, best first. Sold-out pieces are left out automatically.',
    input_schema: {
      type: 'object',
      properties: {
        handles: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
        caption: { type: 'string', description: 'Optional, a few words above the cards, e.g. "To complete the set".' },
      },
      required: ['handles'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'offer_choices',
    description: 'Show two to five short options the shopper can tap to answer your question (each a few words). Ask the question in your text as well.',
    input_schema: {
      type: 'object',
      properties: { options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 } },
      required: ['options'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: 'connect_to_human',
    description:
      "Offer to continue with a member of the team on WhatsApp. Shows a card with a WhatsApp button (your summary is pre-filled in the message), the phone number, email and opening hours. Write the summary in the shopper's language, from their point of view, so the team can pick up without asking again.",
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What they need, products or order number involved, what is already established. Two to four sentences.' },
        reason: { type: 'string' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

export type ToolContext = { channel: ChannelDef; house: House; who: Identity | null; emit: (e: UiEvent) => void };

/** Runs one tool call. Returns what the model reads back; UI tools also emit what the shopper sees. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError?: boolean }> {
  const schema = SCHEMAS[name as ToolName];
  if (!schema) return { content: `Unknown tool ${name}.`, isError: true };
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    return { content: JSON.stringify({ INVALID_INPUT: JSON.stringify(rawInput), problems: parsed.error.issues.map((i) => i.message) }), isError: true };
  }
  const input = parsed.data as never;
  const { channel, house, who, emit } = ctx;
  const signedOut = 'The shopper is not signed in. Ask them to sign in to their account on the site, or to give an order number with the email or phone used on it.';

  switch (name as ToolName) {
    case 'search_products': {
      const i = input as z.infer<typeof Search>;
      const items = await searchProducts(channel, {
        text: i.text,
        brand: i.brand,
        category: i.category,
        department: i.department,
        onSale: i.on_sale,
        minPrice: i.min_price,
        maxPrice: i.max_price,
        size: i.size,
        colour: i.colour,
        limit: i.limit,
      });
      return { content: JSON.stringify(items.length ? items.map(brief) : { results: 0, hint: 'Nothing in stock matched. Try fewer filters or simpler words.' }) };
    }
    case 'get_product': {
      const p = await productDetail(channel, (input as z.infer<typeof Handle>).handle);
      if (!p) return { content: 'No live product with that handle.' };
      return {
        content: JSON.stringify({
          ...brief(p),
          description: p.description,
          sizes: p.sizes,
          otherColours: p.otherColours,
          tags: p.tags.slice(0, 12),
        }),
      };
    }
    case 'find_pairings': {
      const items = await pairings(channel, (input as z.infer<typeof Handle>).handle);
      return { content: JSON.stringify(items.length ? items.map(brief) : { results: 0, hint: 'No natural pairing in stock.' }) };
    }
    case 'get_order': {
      const i = input as z.infer<typeof Order>;
      if (!who && !i.email_or_phone) return { content: 'Ask for the email or phone number used on the order (or for them to sign in).' };
      try {
        const o = await orderDetail({ number: i.order_number, contact: i.email_or_phone, who, brand: house.brand });
        return { content: JSON.stringify(o ?? { found: false, note: who ? 'No order with that number on this account.' : 'No order matches that number and contact. Do not say which part was wrong.' }) };
      } catch (e) {
        return { content: e instanceof Error ? e.message : 'Could not read that contact.', isError: true };
      }
    }
    case 'my_orders': {
      if (!who) return { content: signedOut };
      const list = await myOrders(who, house.brand);
      return { content: JSON.stringify(list.length ? list : { orders: 0, note: 'No orders on this account yet.' }) };
    }
    case 'my_profile': {
      if (!who) return { content: signedOut };
      return { content: JSON.stringify(await myProfile(who, house.brand)) };
    }
    case 'show_products': {
      const i = input as z.infer<typeof Show>;
      const items = await cardsByHandle(channel, i.handles);
      if (items.length) emit({ t: 'products', items, caption: i.caption });
      const missing = i.handles.filter((h) => !items.some((p) => p.handle === h));
      return {
        content: items.length
          ? `Shown to the shopper: ${items.map((p) => `${p.title} (${p.handle})`).join('; ')}.${missing.length ? ` Not shown (sold out or not found): ${missing.join(', ')}.` : ''}`
          : 'None of those are available to show — they may have just sold out. Search again.',
      };
    }
    case 'offer_choices': {
      emit({ t: 'choices', options: (input as z.infer<typeof Choices>).options });
      return { content: 'Shown as tappable choices. Wait for the shopper to answer.' };
    }
    case 'connect_to_human': {
      const open = teamOpen(house);
      emit({
        t: 'handoff',
        whatsapp: whatsappLink(house, (input as z.infer<typeof Human>).summary),
        phone: house.phone,
        email: house.email,
        hours: house.hoursLabel,
        open,
      });
      return { content: `WhatsApp card shown with the summary pre-filled. The team is ${open ? 'available now' : `away until ${house.opens}:00`}.` };
    }
  }
}

/** What the model reads about a product: enough to choose and talk, without the image URLs. */
function brief(p: ProductCard) {
  return {
    handle: p.handle,
    name: p.title,
    brand: p.brand,
    type: p.type,
    price: p.price,
    ...(p.was ? { was: p.was } : {}),
    colour: p.colour,
    sizesInStock: p.sizesInStock,
    url: p.url,
  };
}
