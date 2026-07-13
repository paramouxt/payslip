'use server';

import { z } from 'zod';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { formString } from '@/lib/strings';

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function savePushSubscriptionAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const subscription = subscriptionSchema.parse(JSON.parse(formString(formData, 'subscription')));
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId: tenant.userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    },
    update: { userId: tenant.userId, keys: subscription.keys },
  });
}
