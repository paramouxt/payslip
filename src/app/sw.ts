/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

/**
 * Offline-first READS (constitution §2.9 / §14.4): app shell precached,
 * Next.js defaults for runtime caching. Mutations are online-only in v1.
 * Push handling arrives with notifications (Phase 10).
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

self.addEventListener('push', (event) => {
  const data: { title?: string; body?: string; href?: string } = (() => {
    try {
      return event.data ? (event.data.json() as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'ShiftSync', {
      body: data.body,
      icon: '/icon-192.png',
      data: { href: data.href ?? '/dashboard' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = (event.notification.data as { href?: string } | undefined)?.href ?? '/dashboard';
  event.waitUntil(self.clients.openWindow(href));
});

serwist.addEventListeners();
