'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { formString } from '@/lib/strings';

export async function ignoreEmailAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  await repos.emailMessages.setParseOutcome(formString(formData, 'emailId'), {
    status: 'IGNORED',
  });
  revalidatePath('/inbox');
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  await repos.notifications.markRead(formString(formData, 'notificationId'));
  revalidatePath('/', 'layout');
}
