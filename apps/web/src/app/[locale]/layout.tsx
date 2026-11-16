import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { Providers } from '@/components/providers';
import '../globals.css';

const inter = Inter({ subsets: ['latin', 'greek'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'SoftifyOS', template: '%s · SoftifyOS' },
  description: 'Enterprise Business OS',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'SoftifyOS', statusBarStyle: 'default' },
  icons: { icon: '/icons/192', apple: '/icons/180' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0c1f' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Applies the saved theme before first paint (no flash)
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`;

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
