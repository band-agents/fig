'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { REFRESHED } from './instant-links';
import type { Me } from './nav';

export type LiveEvent = { kind: string; id?: string; number?: string; channelId?: string; stage?: string; actor?: string; message?: string; at: string };
type Online = { id: string; name: string; hue: number };

type Ctx = {
  me: Me;
  connected: boolean;
  online: Online[];
  feed: LiveEvent[];
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
};

const LiveCtx = createContext<Ctx | null>(null);
export const useLive = () => {
  const c = useContext(LiveCtx);
  if (!c) throw new Error('useLive outside LiveProvider');
  return c;
};

/** One SSE connection per tab. Changes anywhere on the floor refresh the open page (debounced) so
 *  every department sees the same truth without reloading. */
export function LiveProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<Online[]>([]);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [paletteOpen, setPalette] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource('/api/stream');
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 4000);
      };
      es.addEventListener('presence', (m) => setOnline(JSON.parse((m as MessageEvent).data)));
      es.addEventListener('live', (m) => {
        const e = JSON.parse((m as MessageEvent).data) as LiveEvent;
        setFeed((f) => [e, ...f].slice(0, 60));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (document.visibilityState === 'visible' && !document.querySelector('[data-editing="true"]')) {
            router.refresh();
            // the refresh empties the pages kept in memory: the menu pages are loaded again behind it
            window.dispatchEvent(new Event(REFRESHED));
          }
        }, 900);
      });
    };
    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      me,
      connected,
      online,
      feed,
      paletteOpen,
      openPalette: () => setPalette(true),
      closePalette: () => setPalette(false),
    }),
    [me, connected, online, feed, paletteOpen],
  );
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}
