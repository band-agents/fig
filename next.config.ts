import type { NextConfig } from 'next';

/* Who may frame /return, /track and /concierge is decided per request in src/proxy.ts (RETURNS_EMBED_ORIGINS). */

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a new build (or a staging dev server) sit beside the one being served, so the
  // console can be rebuilt without going down
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // PGlite ships its Postgres as WASM + data files that must load from node_modules at runtime.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // Dan, 22 and 24 Oct: a page must open as fast as the click. A page opened or loaded ahead (on hover,
  // or the menu pages in the background) stays in memory for 5 minutes; a live change or any action
  // refreshes it anyway, so nothing shown is older than the last change.
  // imports upload a sheet through a server action: room for a whole catalogue's costs (default 1 MB)
  experimental: { staleTimes: { dynamic: 300, static: 300 }, serverActions: { bodySizeLimit: '9mb' } },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: 'figeg.com' },
    ],
  },
};

export default nextConfig;
