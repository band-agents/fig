'use client';

import { useEffect } from 'react';

// a small hanger on a clear ground; the tile colour comes from CSS (img[data-missing]) so it suits both themes
const TILE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Cpath d='M20 13.5a2.5 2.5 0 1 1 2.5 2.5c-1.4 0-2.5.9-2.5 2.2v.8m0 0-9.2 6.3c-.8.5-.4 1.7.5 1.7h17.4c.9 0 1.3-1.2.5-1.7L20 19' fill='none' stroke='%23a3a3a3' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const swap = (img: HTMLImageElement) => {
  if (img.dataset.missing) return;
  img.dataset.missing = '1';
  img.removeAttribute('srcset');
  img.src = TILE;
};

/**
 * Anywhere in the console, a product photo that fails to load (a store moved, a link expired) becomes a
 * quiet grey tile with a hanger instead of the browser's broken-image mark. Catches photos that failed
 * before this ran, and every one after.
 */
export function ImageFallback() {
  useEffect(() => {
    for (const img of Array.from(document.images)) if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) swap(img);
    const onError = (e: Event) => {
      if (e.target instanceof HTMLImageElement) swap(e.target);
    };
    document.addEventListener('error', onError, true);
    return () => document.removeEventListener('error', onError, true);
  }, []);
  return null;
}
