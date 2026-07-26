import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrismaClient } from '@/server/prisma-client';

/**
 * Application-wide Prisma client access.
 *
 * On Cloudflare Workers a pg connection belongs to the request (I/O context)
 * that opened it. A pool built at module scope — i.e. during isolate startup,
 * outside any request — hands later requests a socket they do not own: the
 * query then hangs or the socket is already dead, which Auth.js's adapter
 * reports as `Error: Connection terminated unexpectedly` mid `queryRaw`. That
 * is why sign-in failed on the Google callback (a *later* request in a warm
 * isolate) while endpoints that never touch the database kept working.
 *
 * So on Workers the client is created lazily, inside a request, and memoised
 * per request via the OpenNext execution context. Connections are never
 * shared across requests; Cloudflare reclaims each request's sockets when the
 * request ends. Node (dev, tests, CI) keeps the ordinary long-lived
 * singleton, which is correct there and avoids reconnecting on every call.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const perRequestClients = new WeakMap<object, PrismaClient>();

function isCloudflareWorkers(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as { userAgent?: string }).userAgent === 'Cloudflare-Workers'
  );
}

/**
 * A per-request identity to memoise against. `getCloudflareContext()` is
 * AsyncLocalStorage-backed, so its execution context object is unique to the
 * in-flight request. Absent a request (build-time evaluation, warmup) this
 * returns null and the caller builds a throwaway client rather than caching
 * one that a later request could inherit.
 */
function requestScope(): object | null {
  try {
    const context: unknown = getCloudflareContext().ctx;
    return typeof context === 'object' && context !== null ? context : null;
  } catch {
    return null;
  }
}

function resolveClient(): PrismaClient {
  if (isCloudflareWorkers()) {
    const scope = requestScope();
    if (!scope) return createPrismaClient();
    const existing = perRequestClients.get(scope);
    if (existing) return existing;
    const created = createPrismaClient();
    perRequestClients.set(scope, created);
    return created;
  }

  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * Kept as a `PrismaClient`-shaped export so every existing call site
 * (`import { prisma } from '@/server/db'`) is unchanged. The proxy defers
 * construction until a property is actually used, which is always inside a
 * request.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolveClient() as unknown as Record<string | symbol, unknown>;
    const value = client[property];
    return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(client) : value;
  },
  has(_target, property) {
    return property in (resolveClient() as unknown as Record<string | symbol, unknown>);
  },
});
