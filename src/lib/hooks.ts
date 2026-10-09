'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Browser-only values (the clock, localStorage) read through useSyncExternalStore, so the server render
// and the first client render agree (server snapshot) and the real value arrives right after.

const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockNow = 0;

function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    clockListeners.delete(cb);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Current time, ticking every 30s; null during server render and hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow || (clockNow = Date.now()),
    () => null,
  );
}

const localEvent = 'relay:local';
const parsed = new Map<string, { raw: string | null; value: unknown }>();

function readLocal<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = parsed.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  try {
    value = raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {}
  parsed.set(key, { raw, value });
  return value;
}

/** A small JSON value in localStorage, shared across components and tabs. */
export function useLocal<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      const on = (e: Event) => {
        if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent).detail === key) cb();
      };
      window.addEventListener('storage', on);
      window.addEventListener(localEvent, on);
      return () => {
        window.removeEventListener('storage', on);
        window.removeEventListener(localEvent, on);
      };
    },
    () => readLocal(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      window.dispatchEvent(new CustomEvent(localEvent, { detail: key }));
    },
    [key],
  );
  return [value, set];
}
