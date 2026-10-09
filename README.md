# Relay · FIG

Every order and every return, from checkout to cash, in one place. Relay listens to every FIG storefront
(FIG website and app, Women'secret Egypt and Kuwait, Labesny website and app, and figeg.com until the
Shopify store launches) and moves each order through the departments that touch it. Every team sees
where each order is and who has it right now.

```
New → Confirming → Finance check → Ready to pick → Picking → Packed → Shipped → Out for delivery → Delivered → Settled
       Customer care   Finance        └──────── Fulfilment ────────┘   └──────── Shipping ────────┘   Finance (courier cash)
Off-track: Cancelled · Returning to origin (refused) → RTO closed
Returns:   Requested → Approved → Pickup → In transit → Received → Inspected → Refund pending → Refunded
```

Built as a web dashboard first. Every screen works at phone width, and `/api/*` is the base for the mobile app.

## Run it

```bash
npm install
npm run seed      # a month of demo trading (stop `npm run dev` first; the embedded DB is single-process)
npm run dev       # http://localhost:3400
```

In demo mode the sign-in page lists one door per department (Admin, Operations, Customer care,
Finance, Warehouse Cairo/Kuwait, Shipping, Returns, Marketing). Each one shows exactly what that job
sees. An admin can rebuild the demo floor from **Rules & SLAs**.

No database to install: locally Relay runs an embedded Postgres (PGlite) in `.data/`. In production,
set `DATABASE_URL` to a real Postgres. The same migrations (`drizzle/`) run on start in both cases.

## What's smart about it

- **Autopilot** clears hand-offs that need no judgement and writes why on the timeline. Paid online
  orders skip the confirmation call. Trusted cash customers skip it too. Low-risk cash orders under a
  value limit clear finance, and prepaid deliveries close themselves. Tune or switch off in **Rules & SLAs**.
- **Delivery-risk score** (0–100) on every order, with named reasons. It counts past refusals across
  every store (customers are matched by phone), invalid phones, thin addresses, duplicate orders, unusual
  basket size, and **size bracketing** (one piece in three sizes). It also learns the refusal rate for
  each governorate from this floor's own history.
- **Relay noticed**: plain-language findings, each computed by a query and linked to where you act on it:
  - the stage that's the bottleneck
  - parcels the courier has gone quiet on
  - refusal hotspots
  - a product that keeps coming back "too small"
  - a short Aramex remittance
  - cash still with the courier
  - try-on baskets to call about
  - how much Autopilot saved
- **SLA clocks** on every stage, paused by holds, with live countdowns and late flags everywhere.
- **Ask Relay** (⌘J): questions in plain words, answered by Claude from live data through tools that
  run with the asker's own access. Without an API key it still answers with the computed findings.
- **Live floor**: every hand-off streams to every open screen (server-sent events), with presence.

## Access

A job preset plus a level per area, and an optional store scope. For example, the Kuwait team only
ever sees Kuwait.

| Area | Levels |
| --- | --- |
| Orders, Confirmation, Finance, Pick & pack, Shipping, Returns desk | hidden · view · act · manage |
| Customer data | masked · name & city · full contact |
| Money | hidden · totals · payments · refunds |
| Insights, Channels, Team, Rules | hidden · view · edit · manage |

Rules that always hold:

- Every stage change is checked on the server against the area that owns that hand-off.
- Nobody can grant more than they hold. Only an admin grants admin. The last active admin can't be
  switched off.
- Five wrong passwords lock an account for 15 minutes.
- New teammates get a one-time join link (7 days) and set their own password.

## Connecting the stores

Everything is in `.env.example`, and `/channels` shows what each store still needs, its webhook
address, and a **Check connection** button that verifies the token and its scopes.

- **Shopify** (FIG, Women'secret EG/KW, Labesny): Admin GraphQL `2025-07`, incremental pull plus
  signed webhooks. App orders that FIG's Medusa apps push into Shopify are filed under the app channel
  and de-duplicated against the direct Medusa feed.
- **Medusa** (FIG app, Labesny app): admin API with a secret API key.
- **WooCommerce** (figeg.com): REST v3 until the Shopify store launches.
- **Aramex**: tracking moves orders to out for delivery, delivered, or refused, and flags exceptions.
  Shipment creation is only drafted. Real creation needs an explicit go-ahead, because the account is
  shared with the live website.
- **Lucida**: stock by barcode (both company databases are merged; the username picks the database).
- **Write-back** (`RELAY_WRITE_BACK=true`): sends fulfilment and tracking to Shopify, marks COD orders
  paid when settled, and adds `relay:<stage>` tags. It never replaces a tag list, and every attempt is
  logged on the timeline.

Store facts only ever move an order forward. A late webhook can't undo work the floor already did.

## Checks

```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
```

## Layout

```
src/lib/domain/     pure rules: stages & transitions, access, risk, autopilot, SLAs, return policies
src/lib/engine.ts   the only path that changes an order or a return (ingest, move, hold, note, return)
src/lib/connectors/ Shopify, Medusa, WooCommerce, Aramex, Lucida (pure mappers + tested)
src/lib/sync.ts     pull + courier tracking; /api/webhooks/[platform]/[channel]; /api/cron
src/lib/insights.ts "Relay noticed"   src/lib/copilot/ Ask Relay tools
src/app/(console)/  command centre, orders, pipeline, queues, returns, cash, insights, setup
src/seed/           the demo floor (fictional people, real public catalogue)
```
