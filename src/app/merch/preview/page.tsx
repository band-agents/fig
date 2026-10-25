import Script from 'next/script';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { CHANNEL, channelLabel } from '@/lib/channels';
import { money } from '@/lib/format';

export const metadata = { title: 'Website merchandising — preview' };
export const dynamic = 'force-dynamic';

/* A stand-in product page for trying the embed before it is on a real theme. It loads
   /merch/embed.js exactly as a storefront will, for the first page a live placement shows on, so
   what appears here is what shoppers see. */

export default async function MerchPreview(props: PageProps<'/merch/preview'>) {
  const sp = await props.searchParams;
  const store = typeof sp.store === 'string' && CHANNEL[sp.store] ? sp.store : 'labesny-web';
  const db = await getDb();
  const [pl] = await db
    .select()
    .from(schema.placements)
    .where(and(eq(schema.placements.status, 'live'), sql`${schema.placements.channels} ? ${store}`, sql`jsonb_array_length(${schema.placements.anchors}) > 0`))
    .limit(1);
  const [anchor] = pl ? await db.select().from(schema.products).where(eq(schema.products.id, pl.anchors[0])) : [];
  const site = channelLabel(store);
  return (
    <div style={{ minHeight: '100dvh', background: '#fff', color: '#111', fontFamily: 'var(--font-geist), system-ui, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #ece8e2' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.22em' }}>NEW IN · WOMEN · SALE</span>
          <span style={{ fontSize: 20, letterSpacing: '0.34em', textTransform: 'uppercase' }}>{site}</span>
          <span style={{ fontSize: 11, letterSpacing: '0.22em' }}>BAG (0)</span>
        </div>
      </header>
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 24px 80px' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.24em', color: '#777', margin: '0 0 24px' }}>PREVIEW · THIS PAGE STANDS IN FOR A PRODUCT PAGE ON {site.toUpperCase()}</p>
        {anchor ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 48 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {anchor.image ? <img src={anchor.image} alt="" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', background: '#f2f0ec' }} /> : <div style={{ aspectRatio: '3/4', background: '#f2f0ec' }} />}
            <section>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#777' }}>{anchor.brand.toUpperCase()}</div>
              <h1 style={{ fontWeight: 400, fontSize: 32, margin: '10px 0', lineHeight: 1.15 }}>{anchor.title}</h1>
              <div style={{ fontSize: 16 }}>{money(anchor.price, anchor.currency)}</div>
              <form action="/cart/add" style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {anchor.sizes.slice(0, 5).map((s) => (
                    <span key={s} style={{ border: '1px solid #ccc', padding: '8px 12px', fontSize: 12 }}>
                      {s}
                    </span>
                  ))}
                </div>
                <div style={{ background: '#111', color: '#fff', textAlign: 'center', padding: 14, fontSize: 11, letterSpacing: '0.22em' }}>ADD TO BAG</div>
              </form>
              <div data-dh-merch="" />
            </section>
          </div>
        ) : (
          <p style={{ color: '#555' }}>No placement is live on {site} with a product page to show it on. Publish one from the console and reload.</p>
        )}
      </main>
      <Script src="/merch/embed.js" data-store={store} data-product={anchor?.handle ?? ''} strategy="afterInteractive" />
    </div>
  );
}
