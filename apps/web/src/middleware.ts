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

/**
 * Behind nginx (production) Next builds URLs from its own address (http://localhost:3000), so a
 * redirect would send the browser there. Rewrite such Location headers to the public origin the
 * browser actually used (Host / X-Forwarded-Host + X-Forwarded-Proto, set by nginx).
 */
function publicRedirect(req: NextRequest, res: NextResponse) {
  const loc = res.headers.get('location');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!loc || !host) return res;
  const target = new URL(loc, req.nextUrl.origin);
  if (target.origin !== req.nextUrl.origin) return res; // external redirect: leave as is
  const proto = (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
  res.headers.set('location', `${proto}://${host}${target.pathname}${target.search}${target.hash}`);
  return res;
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
    return publicRedirect(req, NextResponse.redirect(url));
  }
  return publicRedirect(req, intl(req));
}

export const config = {
  // Skip API, Next internals, icons and static files (anything with a dot: sw.js, manifest, images)
  matcher: ['/((?!api/|_next/|icons/|.*\\..*).*)'],
};
