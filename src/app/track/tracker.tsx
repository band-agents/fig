'use client';

import { useState, type FormEvent } from 'react';

type Track = {
  number: string;
  brand: string;
  storeLabel: string;
  placedAt: string;
  status: 'preparing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'problem' | 'cancelled' | 'returned';
  steps: { key: string; label: string; at: string | null; done: boolean; current: boolean }[];
  courier: { name: string; tracking: string; url: string | null } | null;
  updates: { at: string; text: string; place: string | null }[];
  items: { title: string; variant: string | null; image: string | null; quantity: number }[];
  destination: string;
  eta: string | null;
  note: string | null;
};

const HEADLINE: Record<Track['status'], string> = {
  preparing: 'Being prepared',
  shipped: 'On its way',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  problem: 'A short delay',
  cancelled: 'Cancelled',
  returned: 'Returning to us',
};

/* Fixed time zone per brand so the server and the browser print the same thing. */
const zoneOf = (brand: string) => (brand === 'FIG' ? 'Africa/Cairo' : 'Asia/Kuwait');
const day = (iso: string, brand: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: zoneOf(brand) }).format(new Date(iso));
const time = (iso: string, brand: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zoneOf(brand) }).format(new Date(iso));

export function Tracker({ brand, chrome, initial, initialError, number: initialNumber }: { brand: string; chrome: boolean; initial: Track | null; initialError: string | null; number: string }) {
  const [track, setTrack] = useState<Track | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState(initialNumber);
  const [contact, setContact] = useState('');
  const [copied, setCopied] = useState(false);

  const mark = brand === 'Labesny' ? 'Labesny' : brand;

  async function find(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number, contact }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? 'Something went wrong. Try again.');
      setTrack(j.track);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* no clipboard in this frame: the number is selectable anyway */
    }
  }

  return (
    <>
      {chrome && (
        <header className="sf-hdr">
          <div className="sf-hdr-in">
            <span className="sf-mark">{mark}</span>
            <span className="sf-eyebrow">Track order</span>
          </div>
        </header>
      )}
      <main className="sf-main tr">
        {!track && (
          <section className="tr-find">
            <p className="sf-eyebrow">Where is my order</p>
            <h1 className="sf-display">Track your order</h1>
            <p className="sf-sub">Enter your order number and the email or phone you ordered with.</p>
            {error && (
              <p role="alert" className="tr-alert">
                {error}
              </p>
            )}
            <form onSubmit={find} className="tr-form">
              <label className="sf-label">
                <span>Order number</span>
                <input className="sf-field" inputMode="numeric" autoComplete="off" placeholder="e.g. 1186" value={number} onChange={(e) => setNumber(e.target.value)} required />
              </label>
              <label className="sf-label">
                <span>Email or phone</span>
                <input className="sf-field" autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} required />
              </label>
              <button className="sf-btn wide" disabled={busy}>
                {busy ? 'Looking…' : 'Track'}
              </button>
            </form>
          </section>
        )}

        {track && (
          <article className="tr-card" data-status={track.status}>
            <p className="sf-eyebrow">
              Order {track.number} · placed {day(track.placedAt, brand)}
            </p>
            <h1 className="sf-display tr-head">{HEADLINE[track.status]}</h1>
            {track.destination && track.status !== 'cancelled' && <p className="sf-sub">To {track.destination}</p>}
            {track.eta && <p className="tr-eta">{track.eta}</p>}
            {track.note && <p className="tr-note">{track.note}</p>}

            {track.status !== 'cancelled' && (
              <ol className="tr-rail" aria-label="Delivery progress">
                {track.steps.map((s) => (
                  <li key={s.key} data-done={s.done || undefined} data-current={s.current || undefined}>
                    <i aria-hidden />
                    <span className="tr-rail-label">{s.label}</span>
                    <span className="tr-rail-at">{s.done && s.at ? day(s.at, brand) : ''}</span>
                  </li>
                ))}
              </ol>
            )}

            {track.courier && (
              <section className="tr-courier">
                <div>
                  <span className="tr-k">Courier</span>
                  <span className="tr-v">{track.courier.name}</span>
                </div>
                <div>
                  <span className="tr-k">Tracking number</span>
                  <button type="button" className="tr-v tr-copy" onClick={() => copy(track.courier!.tracking)} title="Copy">
                    {track.courier.tracking}
                    <small>{copied ? 'Copied' : 'Copy'}</small>
                  </button>
                </div>
                {track.courier.url && (
                  <a className="sf-btn quiet tr-out" href={track.courier.url} target="_blank" rel="noopener noreferrer">
                    Track on {track.courier.name} ↗
                  </a>
                )}
              </section>
            )}

            {(track.updates.length > 0 || track.status === 'shipped') && (
              <section className="tr-log">
                <h2 className="sf-eyebrow">Latest updates</h2>
                {track.updates.length === 0 ? (
                  <p className="tr-empty">The courier&apos;s first scans show here within a few hours of pickup.</p>
                ) : (
                  <ol>
                    {track.updates.map((u, i) => (
                      <li key={i} data-first={i === 0 || undefined}>
                        <time dateTime={u.at}>
                          <b>{day(u.at, brand)}</b>
                          {time(u.at, brand)}
                        </time>
                        <span>
                          {u.text}
                          {u.place && <em>{u.place}</em>}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {track.items.length > 0 && (
              <section className="tr-items">
                <h2 className="sf-eyebrow">In this order</h2>
                <ul>
                  {track.items.map((it, i) => (
                    <li key={i}>
                      {it.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image} alt="" loading="lazy" />
                      ) : (
                        <span className="tr-ph" aria-hidden />
                      )}
                      <span>
                        <b>{it.title}</b>
                        {it.variant && <small>{it.variant}</small>}
                      </span>
                      <span className="tr-qty">×{it.quantity}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <button type="button" className="tr-again" onClick={() => setTrack(null)}>
              Track another order
            </button>
          </article>
        )}
      </main>
    </>
  );
}
