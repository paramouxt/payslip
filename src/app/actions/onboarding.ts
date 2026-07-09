'use server';

import { revalidatePath } from 'next/cache';
import { isoDate } from '@/core/dates/iso-date';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';

/**
 * One-click onboarding from the Tracsis template (an employer *plugin
 * instance* — pure config, constitution §12). Idempotent per slug.
 */
export async function createEmployerFromTracsisTemplate(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);

  const existing = await repos.employers.list();
  if (!existing.some((e) => e.slug === 'tracsis-events')) {
    const { employerId } = await repos.employers.createFromConfig(buildTracsisEmployerTemplate());
    const startRaw = formData.get('startDate');
    const startDate =
      typeof startRaw === 'string' && startRaw.length > 0
        ? isoDate(startRaw)
        : isoDate('2026-04-06');
    await repos.contracts.create({ employerId, startDate });
  }
  revalidatePath('/', 'layout');
}
