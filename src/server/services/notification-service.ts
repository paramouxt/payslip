import type { PrismaClient } from '@prisma/client';
import webPush from 'web-push';
import { env } from '@/lib/env';
import { asString } from '@/lib/strings';

/**
 * Notification delivery (constitution: notifications state the PAYROLL
 * consequence, §5). One entry point creates the in-app row and, when the
 * user has Web Push subscriptions and VAPID is configured, pushes to the
 * device via the service worker. Push is best-effort: failures never break
 * the pipeline; dead subscriptions (404/410) are pruned.
 */

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

export function describeForPush(
  type: string,
  payload: Record<string, unknown>
): {
  title: string;
  body: string;
  href: string;
} {
  switch (type) {
    case 'ROTA_INGESTED':
      return {
        title: 'ShiftSync — rota processed',
        body: `“${asString(payload.subject)}” → ${asString(payload.parseStatus)}`,
        href: '/inbox',
      };
    case 'PAYSLIP_RECEIVED':
      return {
        title: 'ShiftSync — payslip received',
        body: 'Add it under Payslips to reconcile against your expected pay.',
        href: '/payslips',
      };
    case 'DISCREPANCY_FOUND':
      return {
        title: 'ShiftSync — payslip differs from expectation',
        body: asString(payload.summary, 'Open the discrepancies view for details.'),
        href: '/discrepancies',
      };
    case 'SYSTEM_HEALTH':
      return {
        title: 'ShiftSync — health warning',
        body: `Mailbox forwarder “${asString(payload.label)}” has gone quiet — check the Apps Script.`,
        href: '/settings',
      };
    default:
      return { title: 'ShiftSync', body: type, href: '/dashboard' };
  }
}

export async function notifyUser(
  db: PrismaClient,
  userId: string,
  type: 'ROTA_INGESTED' | 'PAYSLIP_RECEIVED' | 'DISCREPANCY_FOUND' | 'SYSTEM_HEALTH',
  payload: Record<string, unknown>
): Promise<void> {
  const notification = await db.notification.create({
    data: { userId, type, payload: payload as never },
  });

  if (!ensureVapid()) return;
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  const message = JSON.stringify(describeForPush(type, payload));
  let pushed = false;
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys as { p256dh: string; auth: string },
        },
        message
      );
      pushed = true;
    } catch (e: unknown) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => null);
      }
      // Anything else: swallow — push is an enhancement, never load-bearing.
    }
  }
  if (pushed) {
    await db.notification.update({
      where: { id: notification.id },
      data: { pushedAt: new Date() },
    });
  }
}
