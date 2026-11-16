import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['el', 'en'],
  defaultLocale: 'el',
  localePrefix: 'always', // /el/... and /en/... (no internal rewrites: reliable behind nginx and in standalone mode)
});
export type Locale = (typeof routing.locales)[number];
