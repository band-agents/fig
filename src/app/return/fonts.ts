import { IBM_Plex_Sans_Arabic, Italiana, Jost } from 'next/font/google';

/* The two faces the FIG and Labesny storefronts are built on: Italiana for display, Jost for
   everything else. They are declared here rather than in the root layout so the console — which
   nobody outside the company sees and which uses Geist — does not preload them on every page. */

export const italiana = Italiana({ subsets: ['latin'], weight: '400', variable: '--sf-display', display: 'swap' });
export const jost = Jost({ subsets: ['latin'], variable: '--sf-sans', display: 'swap' });

/* For Arabic. Jost has no Arabic glyphs; IBM Plex Sans Arabic has the same calm, geometric
   proportions, so a sentence that mixes the two does not change voice halfway through. */
export const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic'], weight: ['300', '400', '500'], variable: '--sf-arabic', display: 'swap' });
