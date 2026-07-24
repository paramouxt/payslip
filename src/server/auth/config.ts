import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { PrismaClient as AdapterPrismaClient } from '@prisma/client';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';

/**
 * Auth.js v5. Google with BASIC scopes only (openid/email/profile) — adding
 * sensitive/restricted Google scopes here is a constitution violation (§7):
 * mailbox access never flows through sign-in.
 *
 * Sessions are database-backed (revocable). Dev/e2e sessions are created by
 * the gated dev-login route (server/auth/dev-login.ts), not by a credentials
 * provider, so the database strategy stays uniform.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter's published type targets the default Node client; the generated
  // Cloudflare client implements the same runtime contract.
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  session: { strategy: 'database' },
  providers:
    env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
      ? [Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET })]
      : [],
  pages: { signIn: '/sign-in' },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
