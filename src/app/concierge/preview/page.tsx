import Script from 'next/script';
import { italiana, jost } from '../../return/fonts';

export const metadata = { title: 'Customer Service — preview' };

/* A stand-in for a Labesny page, for trying the launcher before it is on the real theme. It loads
   /concierge/launcher.js exactly as the storefront will, so what works here works there. */

export default function ConciergePreview() {
  return (
    <div
      className={`${italiana.variable} ${jost.variable}`}
      style={{ minHeight: '100dvh', background: '#fff', color: '#0f0f10', fontFamily: 'var(--sf-sans), system-ui, sans-serif' }}
    >
      <header style={{ borderBottom: '1px solid #ebe5dd' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 76, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <nav style={{ display: 'flex', gap: 28, fontSize: 11, letterSpacing: '0.2em' }}>
            <span>WOMEN</span>
            <span>MEN</span>
            <span>KIDS</span>
            <span>SALE</span>
          </nav>
          <span style={{ fontFamily: 'var(--sf-display), Georgia, serif', fontSize: 28, letterSpacing: '0.38em' }}>LABESNY</span>
          <span style={{ fontSize: 11, letterSpacing: '0.2em' }}>KWD · BAG (0)</span>
        </div>
      </header>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 24px' }}>
        <p style={{ fontSize: 11, letterSpacing: '0.24em', color: '#6b665f', margin: 0 }}>PREVIEW</p>
        <h1 style={{ fontFamily: 'var(--sf-display), Georgia, serif', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 72px)', margin: '16px 0 20px', lineHeight: 1 }}>
          The new season, curated.
        </h1>
        <p style={{ maxWidth: 520, color: '#2a3743', lineHeight: 1.7 }}>
          This page stands in for labesny.com. The Customer Service button in the corner is loaded from Relay exactly as it will be on the
          live theme. Open it to talk about the collection, sizes, gifts, orders, delivery or returns.
        </p>
      </main>
      <Script src="/concierge/launcher.js" data-store="labesny-web" strategy="afterInteractive" />
    </div>
  );
}
