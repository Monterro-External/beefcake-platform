/**
 * Tells the request which surface it is on. Development only in effect: the
 * header exists so the persona resolution in `src/lib/session.ts` can pick a
 * default that fits the surface. See the comment on `SURFACE_HEADER`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SURFACE_HEADER, surfaceOf } from '@/lib/surface';

export function middleware(request: NextRequest) {
  const surface = surfaceOf(request.nextUrl.pathname);
  const requestHeaders = new Headers(request.headers);
  // Never trust a header the client sent; the path is the only source.
  requestHeaders.delete(SURFACE_HEADER);
  if (surface !== null) requestHeaders.set(SURFACE_HEADER, surface);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/app/:path*', '/me/:path*', '/admin/:path*'],
};
