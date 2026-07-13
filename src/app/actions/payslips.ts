'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { addDays, isoDateSchema } from '@/core/dates/iso-date';
import { periodsBetween } from '@/core/domain/payroll-period/scheme';
import { parsePoundsToPence } from '@/core/money/money';
import { DomainError } from '@/core/errors';
import { requireTenant } from '@/server/auth/session';
import { getPayrollService } from '@/server/container';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { formString } from '@/lib/strings';

const payslipSchema = z.object({
  employerId: z.string().min(1),
  payDate: isoDateSchema,
  gross: z.string().min(1),
  tax: z.string().min(1),
  ni: z.string().min(1),
  pension: z.string().min(1),
  net: z.string().min(1),
  ytdGross: z.string().optional(),
  ytdTax: z.string().optional(),
});

/** Manual payslip entry (the payslip parser lands with real samples). Matches
 *  the payslip to its payroll period by payday, then triggers recomputation +
 *  reconciliation. */
export async function createPayslipAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);

  const parsed = payslipSchema.safeParse({
    employerId: formString(formData, 'employerId'),
    payDate: formString(formData, 'payDate'),
    gross: formString(formData, 'gross'),
    tax: formString(formData, 'tax') || '0',
    ni: formString(formData, 'ni') || '0',
    pension: formString(formData, 'pension') || '0',
    net: formString(formData, 'net'),
    ytdGross: formString(formData, 'ytdGross') || undefined,
    ytdTax: formString(formData, 'ytdTax') || undefined,
  });
  if (!parsed.success) {
    redirect(`/payslips/new?error=${encodeURIComponent('Invalid input — check the amounts')}`);
  }
  const input = parsed.data;
  let payslipId = '';

  try {
    const loaded = await repos.employers.getConfig(input.employerId);
    if (!loaded) throw new DomainError('employer not found', 'INVALID_ARGUMENT');
    const contracts = await repos.contracts.listByEmployer(input.employerId);
    const contract = contracts.find((c) => c.endDate === null);
    if (!contract) throw new DomainError('no active contract', 'INVALID_ARGUMENT');

    // Match by payday: scan the periods paying out in the surrounding window.
    const spans = periodsBetween(
      loaded.config.payPeriodScheme,
      addDays(input.payDate, -45),
      input.payDate
    );
    const span = spans.find((s) => s.payDate === input.payDate) ?? null;
    const period = span ? await repos.payrollPeriods.ensure(input.employerId, span) : null;

    const ytd =
      input.ytdGross && input.ytdTax
        ? {
            grossPence: parsePoundsToPence(input.ytdGross),
            taxPence: parsePoundsToPence(input.ytdTax),
          }
        : null;

    const payslip = await repos.payslips.create({
      employerId: input.employerId,
      contractId: contract.id,
      payrollPeriodId: period?.id ?? null,
      payDate: input.payDate,
      grossPence: parsePoundsToPence(input.gross),
      taxPence: parsePoundsToPence(input.tax),
      niPence: parsePoundsToPence(input.ni),
      pensionPence: parsePoundsToPence(input.pension),
      netPence: parsePoundsToPence(input.net),
      ytd,
    });
    payslipId = payslip.id;

    if (period) {
      await getPayrollService().recomputePeriod(tenant, input.employerId, period);
    }
  } catch (e) {
    const message = e instanceof DomainError ? e.message : 'could not save payslip';
    redirect(`/payslips/new?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/', 'layout');
  redirect(`/payslips/${payslipId}`);
}

export async function setDiscrepancyStatusAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const status = z
    .enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPECTED_WRONG'])
    .parse(formString(formData, 'status'));
  await repos.discrepancies.setStatus(formString(formData, 'discrepancyId'), status);
  revalidatePath('/', 'layout');
}

const taxProfileSchema = z.object({
  taxYear: z.string().regex(/^\d{4}-\d{2}$/),
  taxCode: z.string().min(2).max(8),
  taxBasis: z.enum(['CUMULATIVE', 'WEEK1MONTH1']),
  niCategory: z.string().min(1).max(2),
  pensionEnrolled: z.boolean(),
  pensionPercent: z.number().nonnegative().max(100),
  studentLoan: z.string().nullable(),
});

export async function saveTaxProfileAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const input = taxProfileSchema.parse({
    taxYear: formString(formData, 'taxYear'),
    taxCode: formString(formData, 'taxCode').toUpperCase(),
    taxBasis: formString(formData, 'taxBasis'),
    niCategory: formString(formData, 'niCategory').toUpperCase(),
    pensionEnrolled: formString(formData, 'pensionEnrolled') === 'on',
    pensionPercent: Number(formString(formData, 'pensionPercent') || '0'),
    studentLoan: formString(formData, 'studentLoan') || null,
  });
  await repos.taxProfiles.upsert({
    jurisdiction: 'GB',
    taxYear: input.taxYear,
    taxCode: input.taxCode,
    taxBasis: input.taxBasis,
    niCategory: input.niCategory,
    pension: input.pensionEnrolled
      ? { kind: 'QUALIFYING_EARNINGS', employeePercent: input.pensionPercent }
      : null,
    studentLoan: input.studentLoan,
  });
  revalidatePath('/settings');
  redirect('/settings?saved=tax-profile');
}
