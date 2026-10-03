import { SESSION_COOKIE_NAMES } from '@cv/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * A cheap, optimistic check: no session cookie → /login. The authoritative check is the API's
 * 401 (handled by `apiFetch`); a stale cookie gets that far and is redirected from there.
 * Never redirects away from /login on a cookie alone, or a stale cookie would loop.
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Every page except the auth pages, the API rewrite, and static assets.
  matcher: [
    '/((?!login|signup|api/|_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
