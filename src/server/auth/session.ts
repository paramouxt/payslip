import { redirect } from 'next/navigation';
import { auth } from './config';
import type { TenantContext } from '@/server/tenant';

/**
 * The only sanctioned way for delivery code to obtain a TenantContext.
 * Server components/actions call this; repositories are then constructed
 * with the result. There is no anonymous data access.
 */
export async function requireTenant(): Promise<
  TenantContext & { email: string; name: string | null }
> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) redirect('/sign-in');
  return { userId: user.id, email: user.email, name: user.name ?? null };
}

export async function currentTenantOrNull(): Promise<TenantContext | null> {
  const session = await auth();
  return session?.user.id ? { userId: session.user.id } : null;
}
