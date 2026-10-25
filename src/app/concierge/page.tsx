import { CHANNEL } from '@/lib/channels';
import { houseFor, teamOpen } from '@/lib/concierge/persona';
import { italiana, jost, plexArabic } from '../return/fonts';
import { Advisor } from './advisor';
import './concierge.css';

export const metadata = {
  title: 'Customer Service',
  description: 'Talk to our client advisor about the collection, sizing, gifts and your orders.',
};

/* The shopping concierge's window. Each storefront opens it in a frame from a small launcher on its
   own pages (storefront/shopify/fig-concierge.liquid); opened directly it is a full page. Like the
   returns portal it sits outside the console: no session, no staff data path. */

export default async function ConciergePage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; embed?: string; lang?: string }>;
}) {
  const { store, embed, lang } = await searchParams;
  const channel = CHANNEL[store ?? ''] ?? CHANNEL['labesny-web'];
  const house = houseFor(channel.brand);

  return (
    <div
      className={`cg ${italiana.variable} ${jost.variable} ${plexArabic.variable}`}
      data-embedded={embed === '1' || undefined}
    >
      <Advisor
        store={channel.id}
        brand={house.brand}
        embedded={embed === '1'}
        initialLang={lang === 'ar' ? 'ar' : 'en'}
        team={{ open: teamOpen(house), hours: house.hoursLabel, opens: house.opens, phone: house.phone, email: house.email, whatsapp: house.whatsapp }}
      />
    </div>
  );
}
