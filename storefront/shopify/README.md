# The returns portal on a Shopify storefront

The portal is one page — `/return`, served by Relay — and every shop embeds that same page. The
rules it applies (the return window, what is final sale, what the refund is worth and whether the
extra 5% for store credit is owed) live with the orders, so a change to the policy reaches all seven
storefronts at once and no two of them can disagree about what a customer is owed.

## Install, per store

1. Copy `fig-returns.liquid` into the theme's `sections/`.
2. Copy `page.returns.json` into the theme's `templates/`, and set `store_id` to that storefront's
   channel id (below).
3. In the admin: **Content → Pages → Add page**, title "Returns", template `page.returns`.
4. Open it in the theme editor and fill in **Portal address** — where Relay is served, with no
   trailing slash, e.g. `https://relay.figeg.com`.
5. Link it from the footer and from the account page. Labesny's footer already links to
   `/pages/return-exchange-policy`; the portal belongs next to it, as "Start a return".

| Storefront               | `store_id`    |
| ------------------------ | ------------- |
| FIG (Shopify)            | `fig-web`     |
| figeg.com (WooCommerce)  | `fig-woo`     |
| Labesny                  | `labesny-web` |
| Women'secret Egypt       | `ws-eg`       |
| Women'secret Kuwait      | `ws-kw`       |
| Women'secret Jordan      | `ws-jo`       |

The id only decides which name and which accent the portal wears before an order is found. Once the
customer's order is looked up, the portal takes that order's own brand — a Labesny parcel looked up
on FIG's page shows Labesny.

## Relay has to allow the shop to frame it

`/return` is served with `frame-ancestors`, so only the origins you name may embed it. Set this
where Relay runs, as a space-separated list:

```
RETURNS_EMBED_ORIGINS="https://labesny.com https://figeg.com https://womensecret.eg"
```

With nothing set only Relay's own origin may frame the page, and the shop gets an empty box.

## WooCommerce (figeg.com)

The same iframe, in a page template or a shortcode block — the markup and the resize script in
`fig-returns.liquid` are plain HTML and JavaScript, with only the two settings to fill in by hand.

## What this does not do

The portal needs Relay to be reachable from the public internet. Until it is deployed, the pages can
be installed and configured, but the frame will be empty for anyone outside the office.

# Website merchandising (cross-sells, upgrades, pop-ups)

Placements are chosen and published in the console (Stock & buying → Website merch). Each storefront
loads them with one line, once:

1. Copy `dh-merch.liquid` into the theme's `snippets/`.
2. In `layout/theme.liquid`, before `</body>`:
   `{% render 'dh-merch', store_id: 'labesny-web', console: 'https://<console address>' %}`
3. Optional: put `<div data-dh-merch></div>` in the product section where the row should sit.

Publishing, pausing or ending a placement then changes the shop within a minute, with no theme
release. The two apps read the same placements from `GET /api/merch/<store_id>?product=<handle>`.
