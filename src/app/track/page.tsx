import { CHANNEL } from '@/lib/channels';
import { trackBySignedLink, type PortalTrack } from '@/lib/track-portal';
import { EmbedHeight } from '../return/embed';
import { italiana, jost } from '../return/fonts';
import { Tracker } from './tracker';
import '../return/storefront.css';
import './track.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: { absolute: 'Track your order' },
  description: 'See where your parcel is right now.',
  robots: { index: false },
};

/* The customer's tracking page. Like /return it sits outside the (console) group: no session, the
   storefront's own type and palette, and each shop embeds it in an iframe on its own /pages/track. */

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; embed?: string; o?: string; t?: string; number?: string }>;
}) {
  const { store, embed, o, t, number } = await searchParams;
  const embedded = embed === '1';

  let initial: PortalTrack | null = null;
  let error: string | null = null;
  if (o && t) {
    try {
      initial = await trackBySignedLink(o, t);
    } catch (e) {
      error = e instanceof Error ? e.message : 'This tracking link is not valid.';
    }
  }
  const brand = initial?.brand ?? (store ? CHANNEL[store]?.brand : undefined) ?? 'FIG';

  return (
    <div className={`sf ${italiana.variable} ${jost.variable}`} data-brand={brand} data-embedded={embedded || undefined}>
      {embedded && <EmbedHeight />}
      <Tracker brand={brand} chrome={!embedded} initial={initial ? JSON.parse(JSON.stringify(initial)) : null} initialError={error} number={number ?? ''} />
      {!embedded && <footer className="sf-foot">Questions about your delivery? Reply to your order email and our team will help.</footer>}
    </div>
  );
}
