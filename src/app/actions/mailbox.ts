'use server';

import { revalidatePath } from 'next/cache';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { createMailboxService } from '@/server/services/mailbox-service';
import { formString } from '@/lib/strings';

export async function createMailboxConnectionAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const service = createMailboxService(repos);
  const label = formString(formData, 'label').trim() || 'My Gmail';
  const emailAddress = formString(formData, 'emailAddress').trim();
  await service.createAppsScriptConnection({
    label,
    ...(emailAddress ? { emailAddress } : {}),
  });
  revalidatePath('/settings');
}

export async function rotateMailboxKeyAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const service = createMailboxService(repos);
  await service.rotate(formString(formData, 'connectionId'));
  revalidatePath('/settings');
}
