// npm run purge:demo [-- --apply] — takes the demo floor out of the console's own database and keeps only
// what came from live stores (Dan, 22 Oct 2026: "only keep Labesny real data from the website").
//
// Without --apply it only counts what would go. With --apply it removes, in one transaction, every
// demo order with its items, timeline, returns and customers; the demo products (the 440 Egypt samples)
// with their sizes, stock, two years of made-up weekly sales, moves, transfers and suggestions; the demo
// suppliers and their purchase orders; the courier settlements; the seeded month of team work; the
// fictional teammates (@relay.local) with their sessions and invitations; and switches the demo stores
// off. Live store data (source 'shopify') and real accounts are never touched. The shop list stays.
//
// The server and this script share one database: on PGlite stop the server first. Back up before.

import { sql } from 'drizzle-orm';
import { getDb } from '../src/lib/db';

const apply = process.argv.includes('--apply');

const DEMO_ORDERS = sql`select id from orders where source = 'demo'`;
const DEMO_PRODUCTS = sql`select id from products where source = 'demo'`;
const DEMO_USERS = sql`select id from users where email like '%@relay.local'`;
const DEMO_SUPPLIERS = sql`select id from suppliers where source = 'demo'`;

// in the order they can go: what points at a row before the row itself
const steps: { label: string; count: ReturnType<typeof sql>; remove: ReturnType<typeof sql> }[] = [
  {
    label: 'order and return timeline entries of demo orders',
    count: sql`select count(*)::int n from events where order_id in (${DEMO_ORDERS}) or return_id in (select id from returns where order_id in (${DEMO_ORDERS}))`,
    remove: sql`delete from events where order_id in (${DEMO_ORDERS}) or return_id in (select id from returns where order_id in (${DEMO_ORDERS}))`,
  },
  {
    label: 'demo orders (their items and returns go with them)',
    count: sql`select count(*)::int n from orders where source = 'demo'`,
    remove: sql`delete from orders where source = 'demo'`,
  },
  {
    label: 'customers left with no order',
    count: sql`select count(*)::int n from customers c where not exists (select 1 from orders o where o.customer_id = c.id and o.source <> 'demo')`,
    remove: sql`delete from customers c where not exists (select 1 from orders o where o.customer_id = c.id)`,
  },
  {
    label: 'courier settlements (all demo)',
    count: sql`select count(*)::int n from settlements`,
    remove: sql`delete from settlements`,
  },
  {
    label: 'weekly sales of demo products',
    count: sql`select count(*)::int n from sales_weekly where product_id in (${DEMO_PRODUCTS})`,
    remove: sql`delete from sales_weekly where product_id in (${DEMO_PRODUCTS})`,
  },
  {
    label: 'stock moves of demo products, demo stores or demo teammates',
    count: sql`select count(*)::int n from stock_moves where product_id in (${DEMO_PRODUCTS}) or channel_id in (select id from channels where mode = 'demo') or actor_id in (${DEMO_USERS})`,
    remove: sql`delete from stock_moves where product_id in (${DEMO_PRODUCTS}) or channel_id in (select id from channels where mode = 'demo') or actor_id in (${DEMO_USERS})`,
  },
  {
    label: 'transfers holding demo products (their lines go with them)',
    count: sql`select count(*)::int n from transfers where id in (select transfer_id from transfer_lines where product_id in (${DEMO_PRODUCTS}))`,
    remove: sql`delete from transfers where id in (select transfer_id from transfer_lines where product_id in (${DEMO_PRODUCTS}))`,
  },
  {
    label: 'purchase orders of demo suppliers or demo products (their lines go with them)',
    count: sql`select count(*)::int n from purchase_orders where supplier_id in (${DEMO_SUPPLIERS}) or id in (select po_id from po_lines where product_id in (${DEMO_PRODUCTS}))`,
    remove: sql`delete from purchase_orders where supplier_id in (${DEMO_SUPPLIERS}) or id in (select po_id from po_lines where product_id in (${DEMO_PRODUCTS}))`,
  },
  {
    label: 'AI suggestions about demo products, suppliers or Egypt',
    count: sql`select count(*)::int n from recommendations where product_id in (${DEMO_PRODUCTS}) or supplier_id in (${DEMO_SUPPLIERS}) or market = 'EG'`,
    remove: sql`delete from recommendations where product_id in (${DEMO_PRODUCTS}) or supplier_id in (${DEMO_SUPPLIERS}) or market = 'EG'`,
  },
  {
    label: 'website placements made by demo teammates (their daily counts go with them)',
    count: sql`select count(*)::int n from placements where created_by in (${DEMO_USERS}) or created_by is null or market = 'EG'`,
    remove: sql`delete from placements where created_by in (${DEMO_USERS}) or created_by is null or market = 'EG'`,
  },
  {
    label: 'tasks of the seeded month of team work (any not created by a real teammate)',
    count: sql`select count(*)::int n from tasks where created_by is null or created_by in (${DEMO_USERS}) or assignee_id in (${DEMO_USERS})`,
    remove: sql`delete from tasks where created_by is null or created_by in (${DEMO_USERS}) or assignee_id in (${DEMO_USERS})`,
  },
  {
    label: 'team activity by demo teammates or the planner on demo data',
    count: sql`select count(*)::int n from activity where actor_id is null or actor_id in (${DEMO_USERS})`,
    remove: sql`delete from activity where actor_id is null or actor_id in (${DEMO_USERS})`,
  },
  {
    label: 'demo products (their sizes and stock go with them)',
    count: sql`select count(*)::int n from products where source = 'demo'`,
    remove: sql`delete from products where source = 'demo'`,
  },
  {
    label: 'demo suppliers',
    count: sql`select count(*)::int n from suppliers where source = 'demo'`,
    remove: sql`delete from suppliers where source = 'demo'`,
  },
  {
    label: 'invitations to demo teammates',
    count: sql`select count(*)::int n from invitations where email like '%@relay.local'`,
    remove: sql`delete from invitations where email like '%@relay.local'`,
  },
  {
    label: 'demo teammates @relay.local (their sessions go with them)',
    count: sql`select count(*)::int n from users where email like '%@relay.local'`,
    remove: sql`delete from users where email like '%@relay.local'`,
  },
  {
    label: 'demo stores switched off',
    count: sql`select count(*)::int n from channels where mode = 'demo'`,
    remove: sql`update channels set mode = 'off' where mode = 'demo'`,
  },
];

const KEPT = sql`select
  (select count(*)::int from orders) as orders,
  (select count(*)::int from orders where source <> 'shopify') as not_from_a_store,
  (select count(*)::int from customers) as customers,
  (select count(*)::int from products) as products,
  (select count(*)::int from variants) as sizes,
  (select count(*)::int from stock_levels) as stock_rows,
  (select count(*)::int from sales_weekly) as weekly_sales,
  (select count(*)::int from suppliers) as suppliers,
  (select count(*)::int from users) as people,
  (select string_agg(email, ', ' order by email) from users) as logins,
  (select string_agg(id || '=' || mode, ', ' order by id) from channels) as stores`;

(async () => {
  if (process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && !process.argv.includes('--remote')) {
    console.error('A remote database: add --remote if this is really the one to clean.');
    process.exit(1);
  }
  const db = await getDb();
  console.log(apply ? 'Removing the demo floor…' : 'Dry run (add --apply to remove):');
  if (apply) {
    await db.transaction(async (tx) => {
      for (const s of steps) {
        const n = (await tx.execute<{ n: number }>(s.count)).rows[0]?.n ?? 0;
        await tx.execute(s.remove);
        console.log(`  ${String(n).padStart(6)}  ${s.label}`);
      }
    });
  } else {
    for (const s of steps) console.log(`  ${String((await db.execute<{ n: number }>(s.count)).rows[0]?.n ?? 0).padStart(6)}  ${s.label}`);
  }
  console.log(apply ? 'What is left:' : 'Left today (before removing):', (await db.execute(KEPT)).rows[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
