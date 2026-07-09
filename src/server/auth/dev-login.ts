import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db';
import { devAuthEnabled, env } from '@/lib/env';

/**
 * Dev/e2e session bootstrap. Creates a database session for DEV_AUTH_EMAIL
 * exactly as the Prisma adapter would, so the rest of the stack is identical
 * to production. Triple-gated: NODE_ENV !== production, DEV_AUTH_EMAIL set,
 * and the route 404s otherwise. This exists so the app can be developed and
 * end-to-end tested without Google credentials; it is not a login system.
 */
export async function createDevSession(): Promise<{ token: string; expires: Date } | null> {
  if (!devAuthEnabled || !env.DEV_AUTH_EMAIL) return null;
  const email = env.DEV_AUTH_EMAIL;
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Dev User' },
    update: {},
  });
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires },
  });
  return { token, expires };
}
