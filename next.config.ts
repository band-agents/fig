import type { NextConfig } from 'next';

/**
 * Who may put the returns portal in a frame.
 *
 * Each storefront embeds `/return` in one of its own pages, so the customer never leaves the shop.
 * That only works if those origins — and nothing else — are allowed to frame it, which is what
 * `frame-ancestors` says. The list comes from the environment because it is different in
 * development, on staging and in production; with nothing set, nobody may frame it.
 *
 * `RETURNS_EMBED_ORIGINS="https://labesny.com https://figeg.com"`
 */
const embedOrigins = (process.env.RETURNS_EMBED_ORIGINS ?? '').trim();
const frameAncestors = embedOrigins ? `frame-ancestors 'self' ${embedOrigins}` : "frame-ancestors 'self'";

const nextConfig: NextConfig = {
  // PGlite ships its Postgres as WASM + data files that must load from node_modules at runtime.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  async headers() {
    return [
      {
        source: '/return',
        headers: [{ key: 'Content-Security-Policy', value: frameAncestors }],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: 'figeg.com' },
    ],
  },
};

export default nextConfig;
