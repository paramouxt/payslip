import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createDevSession } from '@/server/auth/dev-login';

/** Dev/e2e only (404s unless DEV_AUTH_EMAIL is set outside production). */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await createDevSession();
  if (!session) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const jar = await cookies();
  jar.set('authjs.session-token', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: session.expires,
  });
  return NextResponse.redirect(new URL('/dashboard', request.url), 303);
}
