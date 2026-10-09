# Labesny returns portal — demo crib

Open: **http://localhost:3400/return?store=labesny-web** (already open in the browser pane)

## Real Labesny orders — Relay is connected to szk0ey-ns

Relay pulls from Labesny's live Shopify store with the app's client credentials (it mints its own
24-hour token; there is no long-lived one to keep). The first pull brought **74 orders**.

| Order   | Email                         | What it shows                                      |
| ------- | ----------------------------- | -------------------------------------------------- |
| `#1058` | Mahmoudhusseinqu114@gmail.com | 2 La Vie en Rose pieces, KWD 10.250, paid by card → **+KWD 0.513** on store credit, 9 days left |

Real order, real customer, real photographs off Labesny's own CDN. The delivery charge is not
refunded — the quote is on the goods.

To find more: **Orders → Labesny → Delivered**, open one, and the email and phone are on the right.
Only delivered orders can start a return, which is the policy doing its job.

Demo orders are still there too (`LB-81442` / maryam.behbehani92@outlook.com, 2 items, KWD 82.250)
if you would rather not touch a real customer's order on screen.

A phone works instead of the email — type it with or without the country code.

## The four steps

1. **Your order** — number + email (or phone). Both must match, and a wrong pair gets the same
   answer as a number that does not exist, so it cannot be used to find out who shops with us.
2. **Items** — pick what goes back, line by line. Final-sale pieces are shown greyed with the
   reason, and anything already returned cannot be returned twice.
3. **Reason** — eight reasons, a free note, and **a photo of the piece, which is required**. The
   picture is shrunk in the browser before it is sent, so a phone's full frame does not travel; the
   desk sees it on the return before anyone is sent to collect.
4. **Refund** — the three ways the money comes back, account credit first:
   - **account credit, plus 5%** — the figure is on screen before they choose
   - back to the card, or the cash they paid with
   - cash from one of our branches, collected in person
   Kuwait is drop-off at a branch, so the portal says so and the return is routed to a shop, not a
   courier — and the customer picks **which** shop, from the 27 D&H and D&Co counters across the 8
   malls. It only offers the counters that carry what is going back: send back an Etam dress and you
   are shown the five Etam shops, not all twenty-seven. `#1058` is two La Vie en Rose pieces, so it
   offers the six La Vie en Rose counters. The chosen shop is stored on the return and the desk sees
   it as *Collecting from*.

The 5% is only ever on orders paid by cash on delivery, card or KNET. An order paid **with account
credit earns nothing extra** — the option still appears, at face value.

## The other half: it lands on the desk

Open **http://localhost:3400/returns** — the request is there at `Requested`, marked
**Self-service**, with the customer's photograph under the item and the amount reading
`incl. KWD 1.538 account-credit bonus`, so finance can see what is bonus and what is the order's own
money. Approve / Reject are the desk's.

## Nothing here touches the Shopify store

Relay reads orders. Write-back is off, so opening a return writes a row in Relay and nothing else:
no refund is issued, no order is edited, no email reaches the customer. Approve and Reject on the
desk are the first point where a person decides anything.

## What is not live yet

The portal runs here, on this machine. Putting it on labesny.com is two steps: deploy Relay to a
public address, then add the page to the theme — the section and the page template are written and
sitting in `storefront/shopify/` (and already installed in the local `labesny-couture` theme).
Until Relay is deployed the page on labesny.com would show an empty frame, which is why the demo
runs from here.
