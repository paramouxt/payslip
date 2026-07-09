import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX-level redirect only: real enforcement is requireTenant() in server
 * components/actions (database sessions cannot be verified at the edge).
 */
export function middleware(request: NextRequest) {
  const hasSession =
    request.cookies.has('authjs.session-token') ||
    request.cookies.has('__Secure-authjs.session-token');
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/shifts/:path*',
    '/payslips/:path*',
    '/discrepancies/:path*',
    '/inbox/:path*',
    '/settings/:path*',
  ],
};
