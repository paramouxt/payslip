'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isoDateSchema, addDays } from '@/core/dates/iso-date';
import { instantFromZoned } from '@/core/dates/zoned';
import { resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import { Shift, type ShiftEventRecord } from '@/core/domain/shift/shift';
import { DomainError } from '@/core/errors';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { formString } from '@/lib/strings';

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const createShiftSchema = z.object({
  employerId: z.string().min(1),
  date: isoDateSchema,
  startTime: timeSchema,
  endTime: timeSchema,
  roleId: z.string().optional(),
  venue: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  sourceEmailId: z.string().optional(),
});

/** Manual shift entry — same domain path as ingestion (§4.3): aggregate +
 *  evidence-carrying event; the actor is the human. */
export async function createShiftAction(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);

  const parsed = createShiftSchema.safeParse({
    employerId: formString(formData, 'employerId'),
    date: formString(formData, 'date'),
    startTime: formString(formData, 'startTime'),
    endTime: formString(formData, 'endTime'),
    roleId: formString(formData, 'roleId') || undefined,
    venue: formString(formData, 'venue') || undefined,
    notes: formString(formData, 'notes') || undefined,
    sourceEmailId: formString(formData, 'sourceEmailId') || undefined,
  });
  if (!parsed.success) {
    redirect(`/shifts/new?error=${encodeURIComponent('Invalid input — check date and times')}`);
  }
  const input = parsed.data;

  try {
    const config = await repos.employers.getConfig(input.employerId);
    if (!config) throw new DomainError('employer not found', 'INVALID_ARGUMENT');
    const contracts = await repos.contracts.listByEmployer(input.employerId);
    const active = contracts.filter((c) => c.endDate === null);
    const contract = active[0];
    if (active.length !== 1 || !contract) {
      throw new DomainError('exactly one active contract is required', 'INVALID_ARGUMENT');
    }

    const timezone = config.config.timezone;
    const startAt = instantFromZoned(input.date, input.startTime, timezone);
    const endDate = input.endTime <= input.startTime ? addDays(input.date, 1) : input.date;
    const endAt = instantFromZoned(endDate, input.endTime, timezone);

    const { shift, event } = Shift.create({
      identity: {
        id: crypto.randomUUID(),
        userId: tenant.userId,
        employerId: input.employerId,
        contractId: contract.id,
      },
      details: {
        externalRef: null,
        date: input.date,
        startAt,
        endAt,
        timezone,
        roleId: input.roleId ?? null,
        venue: input.venue ?? null,
        notes: input.notes ?? null,
      },
      evidence: input.sourceEmailId
        ? { sourceEmailId: input.sourceEmailId, occurredAt: new Date() }
        : { actor: 'user', occurredAt: new Date() },
    });
    await repos.shifts.create(shift, event);

    try {
      await repos.payrollPeriods.ensure(
        input.employerId,
        resolvePeriodFor(config.config.payPeriodScheme, input.date)
      );
    } catch {
      // Date outside the scheme (e.g. pre-transition): shift stands, period doesn't.
    }

    if (input.sourceEmailId) {
      await repos.emailMessages.setParseOutcome(input.sourceEmailId, {
        status: 'PARSED',
        parserId: 'manual-resolution',
        parserVersion: '-',
      });
    }
  } catch (e) {
    const message = e instanceof DomainError ? e.message : 'could not create shift';
    redirect(`/shifts/new?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/', 'layout');
  redirect('/shifts');
}

async function mutateShift(
  shiftId: string,
  mutate: (shift: Shift) => { shift: Shift; event: ShiftEventRecord }
): Promise<string | null> {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const shift = await repos.shifts.getById(shiftId);
  if (!shift) return 'shift not found';
  try {
    const next = mutate(shift);
    await repos.shifts.applyEvent(next.shift, next.event);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'failed';
  }
}

export async function cancelShiftAction(formData: FormData): Promise<void> {
  const shiftId = formString(formData, 'shiftId');
  await mutateShift(shiftId, (s) => s.cancel({ actor: 'user', occurredAt: new Date() }));
  revalidatePath('/', 'layout');
  redirect(`/shifts/${shiftId}`);
}

export async function reinstateShiftAction(formData: FormData): Promise<void> {
  const shiftId = formString(formData, 'shiftId');
  await mutateShift(shiftId, (s) => s.reinstate({ actor: 'user', occurredAt: new Date() }));
  revalidatePath('/', 'layout');
  redirect(`/shifts/${shiftId}`);
}

export async function setShiftOverrideAction(formData: FormData): Promise<void> {
  const shiftId = formString(formData, 'shiftId');
  const rateClassId = formString(formData, 'rateClassId');
  await mutateShift(shiftId, (s) =>
    s.setRateClassOverride(rateClassId === '' ? null : rateClassId, {
      actor: 'user',
      occurredAt: new Date(),
    })
  );
  revalidatePath('/', 'layout');
  redirect(`/shifts/${shiftId}`);
}
