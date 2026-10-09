import { Italiana, Jost } from 'next/font/google';

/* The two faces the FIG and Labesny storefronts are built on: Italiana for display, Jost for
   everything else. They are declared here rather than in the root layout so the console — which
   nobody outside the company sees and which uses Geist — does not preload them on every page. */

export const italiana = Italiana({ subsets: ['latin'], weight: '400', variable: '--sf-display', display: 'swap' });
export const jost = Jost({ subsets: ['latin'], variable: '--sf-sans', display: 'swap' });
