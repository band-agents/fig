import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument' });

export const metadata: Metadata = {
  title: { default: 'Relay · FIG', template: '%s · Relay' },
  description: 'Every order and every return, from checkout to cash, in one place.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08080a' },
    { media: '(prefers-color-scheme: light)', color: '#f4f2ee' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('relay_theme')?.value === 'light' ? 'light' : 'dark';
  return (
    <html lang="en" data-theme={theme} className={`${geist.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <div className="atmosphere" aria-hidden />
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  );
}
