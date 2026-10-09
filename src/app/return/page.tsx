import { CHANNEL } from '@/lib/channels';
import { EmbedHeight } from './embed';
import { italiana, jost } from './fonts';
import { ReturnsPortal } from './portal';
import './storefront.css';

export const metadata = {
  title: 'Return an item',
  description: 'Start a return in a couple of minutes. No account needed.',
};

/* The one page in Relay a customer sees. It sits outside the (console) group on purpose: no
   session, no sidebar, no store scope — the layout and the data path are both separate from the
   staff application, so nothing here can reach a query that assumes a signed-in principal.
   It also wears the storefront rather than the console: FIG's own type and palette, so arriving
   from figeg.com or labesny.com does not feel like leaving the shop. */

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; embed?: string }>;
}) {
  /* Each storefront links to its own door: /return?store=labesny-web. FIG is the default, and an
     order found under the wrong mark moves the page to its own brand. */
  const { store, embed } = await searchParams;
  const brand = (store ? CHANNEL[store]?.brand : undefined) ?? 'FIG';
  /* Inside a shop's own page the shop supplies the header and the footer, so the portal drops its
     own and is nothing but the four steps. */
  const embedded = embed === '1';

  return (
    <div className={`sf ${italiana.variable} ${jost.variable}`} data-brand={brand} data-embedded={embedded || undefined}>
      {embedded && <EmbedHeight />}
      <ReturnsPortal brand={brand} chrome={!embedded} />
      {!embedded && (
        <footer className="sf-foot">
          Having trouble? Reply to your order confirmation email and someone will pick it up.
        </footer>
      )}
    </div>
  );
}
