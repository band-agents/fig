'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell as BellIcon, BellRing, Check } from 'lucide-react';
import type { Note, Notifications } from '@/lib/notifications';
import { toast } from '@/components/ui/toast';

const SEEN = (id: string) => `relay.seen.${id}`;
const ALERTS = 'relay.alerts';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private window: the bell still works, it just forgets
  }
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/**
 * The bell: what needs this person, not every queue's count. The number is what is new since they
 * last opened it plus what is assigned to them; a red ring means something in their queues is late.
 * New arrivals also show once as a toast, and as a desktop alert when they switched those on.
 */
export function Bell({ userId, notes, queues }: { userId: string; notes: Notifications; queues: { label: string; href: string; n: number; late: number }[] }) {
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>(() => new Date(Date.now() - 12 * 3_600_000).toISOString());
  const [alerts, setAlerts] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    // after hydration: when this person last looked, and whether desktop alerts are on
    const t = requestAnimationFrame(() => {
      const s = read(SEEN(userId));
      if (s) setSeenAt(s);
      setAlerts(read(ALERTS) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted');
    });
    return () => cancelAnimationFrame(t);
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // something new arrived since the last render (a live refresh): say so once
  useEffect(() => {
    const ids = new Set(notes.recent.map((n) => n.id));
    if (known.current) {
      const fresh = notes.recent.filter((n) => !known.current!.has(n.id));
      if (fresh.length) {
        const first = fresh[0];
        toast(fresh.length === 1 ? `${first.title} · ${first.detail}` : `${fresh.length} new in your queues · ${first.title}`, { tone: first.tone === 'critical' ? 'error' : 'live' });
        if (alerts && document.visibilityState !== 'visible') {
          try {
            new Notification(fresh.length === 1 ? first.title : `${fresh.length} new in your queues`, { body: fresh.length === 1 ? first.detail : fresh.slice(0, 3).map((n) => n.title).join(' · '), tag: 'relay' });
          } catch {
            // the browser said no
          }
        }
      }
    }
    known.current = ids;
  }, [notes.recent, alerts]);

  const unseen = notes.recent.filter((n) => n.at > seenAt);
  const count = unseen.length + notes.mine.length;
  const late = notes.lateTotal;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      // opening it is looking: what is new now counts as seen (shown as new until it closes)
      write(SEEN(userId), new Date().toISOString());
    } else setSeenAt(read(SEEN(userId)) ?? seenAt);
  };
  const switchAlerts = async () => {
    if (alerts) {
      write(ALERTS, 'off');
      return setAlerts(false);
    }
    if (typeof Notification === 'undefined') return toast('This browser has no desktop alerts.', { tone: 'error' });
    const ok = (await Notification.requestPermission()) === 'granted';
    write(ALERTS, ok ? 'on' : 'off');
    setAlerts(ok);
    toast(ok ? 'Desktop alerts on: new work in your queues shows even when the console is in the background.' : 'The browser blocked desktop alerts.', { tone: ok ? 'live' : 'error' });
  };

  const Row = ({ n, fresh }: { n: Note; fresh?: boolean }) => (
    <li>
      <Link href={n.href} onClick={() => setOpen(false)} className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-elev-2">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.tone === 'critical' ? 'bg-[var(--signal)]' : n.tone === 'warn' ? 'bg-[var(--warn)]' : 'bg-[var(--s1)]'} ${fresh ? '' : 'opacity-40'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[12.5px] ${fresh ? 'font-semibold' : 'font-medium'}`}>{n.title}</span>
          {n.detail && <span className="block truncate text-[11.5px] text-ink-3">{n.detail}</span>}
        </span>
        {n.at && <span className="shrink-0 pt-0.5 text-[10.5px] text-ink-4">{ago(n.at)}</span>}
      </Link>
    </li>
  );

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="icon-btn" aria-label={`Notifications${count ? `, ${count} new` : ''}${late ? `, ${late} late` : ''}`} style={late ? { boxShadow: '0 0 0 2px var(--signal), var(--card-shadow)' } : undefined}>
        {count ? <BellRing className="size-[17px]" strokeWidth={1.8} /> : <BellIcon className="size-[17px]" strokeWidth={1.8} />}
        {count > 0 && <span className="badge-n">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-[80] w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl bg-elev shadow-[var(--shadow-lg)] rise">
          <div className="scroll-thin max-h-[70vh] overflow-y-auto p-2">
            {late > 0 && (
              <section className="mb-1">
                <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
                  <span className="text-[12px] font-semibold text-critical">Late in your queues</span>
                  <span className="pill" data-tone="critical">
                    {late}
                  </span>
                </div>
                <ul>{notes.late.map((n) => <Row key={n.id} n={n} fresh />)}</ul>
              </section>
            )}
            <section className="mb-1">
              <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
                <span className="text-[12px] font-semibold">New</span>
                {unseen.length > 0 && <span className="text-[11px] text-ink-3">{unseen.length} since you looked</span>}
              </div>
              {notes.recent.length ? (
                <ul>
                  {notes.recent.slice(0, 12).map((n) => (
                    <Row key={n.id} n={n} fresh={n.at > seenAt} />
                  ))}
                </ul>
              ) : (
                <p className="px-2.5 pb-2 text-[12px] text-ink-3">Nothing new in your queues.</p>
              )}
            </section>
            {notes.mine.length > 0 && (
              <section className="mb-1">
                <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold">Yours</div>
                <ul>{notes.mine.map((n) => <Row key={n.id} n={n} fresh />)}</ul>
              </section>
            )}
            {queues.length > 0 && (
              <section className="border-t border-line px-2.5 pb-1 pt-2">
                <div className="mb-1 text-[11px] font-medium text-ink-3">Waiting</div>
                <div className="flex flex-wrap gap-1.5">
                  {queues.map((q) => (
                    <Link key={q.href} href={q.href} onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 rounded-full bg-elev-2 px-2.5 py-1 text-[11.5px] hover:bg-elev-3">
                      {q.label} <b className="font-mono">{q.n}</b>
                      {q.late > 0 && <span className="font-mono text-critical">{q.late} late</span>}
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line px-3.5 py-2">
            <button onClick={switchAlerts} className="text-[11.5px] text-ink-3 hover:text-ink">
              Desktop alerts: {alerts ? 'on' : 'off'}
            </button>
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-4">
              <Check className="size-3" /> marked as seen
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
