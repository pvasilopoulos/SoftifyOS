import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

function preferredLocale(req: NextRequest) {
  const seg = req.nextUrl.pathname.split('/')[1];
  if ((routing.locales as readonly string[]).includes(seg)) return seg;
  const cookie = req.cookies.get('NEXT_LOCALE')?.value;
  return cookie && (routing.locales as readonly string[]).includes(cookie) ? cookie : routing.defaultLocale;
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLogin = /^\/((el|en)\/)?login\/?$/.test(pathname);
  // Customer offer link: public, the token in the URL is the access key
  const isPublic = /^\/(el|en)\/(p|invite)\/[A-Za-z0-9_-]+\/?$/.test(pathname);
  if (!req.cookies.has('sos_session') && !isLogin && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = `/${preferredLocale(req)}/login`;
    url.search = '';
    return NextResponse.redirect(url);
  }
  return intl(req);
}

export const config = {
  // Skip API, Next internals, icons and static files (anything with a dot: sw.js, manifest, images)
  matcher: ['/((?!api/|_next/|icons/|.*\\..*).*)'],
};
