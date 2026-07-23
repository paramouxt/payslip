'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formString } from '@/lib/strings';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { encryptField } from '@/server/security/crypto';

const payslipPasswordSchema = z.object({
  employerId: z.string().min(1),
  password: z.string().min(1).max(128),
});

export async function savePayslipPdfPasswordAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const input = payslipPasswordSchema.parse({
    employerId: formString(formData, 'employerId'),
    password: formString(formData, 'password'),
  });
  const repos = createTenantRepositories(prisma, tenant);
  await repos.employers.setPayslipPdfPasswordEncrypted(
    input.employerId,
    encryptField(input.password)
  );
  revalidatePath('/settings');
}
