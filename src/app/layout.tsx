import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { ImageFallback } from '@/components/ui/image-fallback';


export const metadata: Metadata = {
  title: { default: 'DH & DCO', template: '%s · DH & DCO' },
  description: 'D&H and D&Co operations: every order, return, piece of stock and purchase order, in one place.',
  // an internal tool: nothing here belongs in a search engine, the landing page included
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#141414' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Light is the house default; dark is a choice each person makes from the top bar.
  const theme = (await cookies()).get('dh_theme')?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <div className="atmosphere" aria-hidden />
        <div className="relative z-[1]">{children}</div>
        <ImageFallback />
      </body>
    </html>
  );
}
