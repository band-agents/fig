'use client';

import { useEffect } from 'react';

/**
 * Tells the storefront how tall the portal is.
 *
 * Each shop puts this page in an iframe on its own returns page, and an iframe has no idea how tall
 * its contents are: left alone it keeps a fixed height and the customer gets a second scrollbar
 * inside the page. So the portal measures itself and posts the number out; the shop's snippet
 * listens and sets the height. The message carries nothing but a number, which is why it can be
 * sent to any parent — it is the parent that has to check where it came from.
 *
 * Does nothing when the page is opened directly.
 */
export function EmbedHeight() {
  useEffect(() => {
    if (window.parent === window) return;
    /* The portal's own surface, not the document: the document keeps the console's full-height body
       behind it, and reporting that would leave a band of empty page under the last step. */
    const surface = document.querySelector('.sf');
    if (!surface) return;

    const post = () => {
      const height = Math.ceil(surface.getBoundingClientRect().height);
      window.parent.postMessage({ type: 'relay:returns:height', height }, '*');
    };

    const observer = new ResizeObserver(post);
    observer.observe(surface);
    post();
    return () => observer.disconnect();
  }, []);

  return null;
}
