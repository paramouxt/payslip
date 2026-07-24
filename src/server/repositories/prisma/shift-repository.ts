import type { PrismaClient } from '@/generated/prisma/client';
import { ConcurrencyError } from '@/core/errors';
import type { IsoDate } from '@/core/dates/iso-date';
import type { Shift, ShiftEventRecord } from '@/core/domain/shift/shift';
import type { TenantContext } from '@/server/tenant';
import type { ShiftRepository } from '../ports';
import {
  fromDbDate,
  serializeDiff,
  serializeSnapshot,
  shiftEventFromRow,
  shiftFromRow,
  toDbDate,
} from './mappers';

export function createPrismaShiftRepository(
  db: PrismaClient,
  tenant: TenantContext
): ShiftRepository {
  const { userId } = tenant;

  function projectionData(shift: Shift) {
    const s = shift.snapshot;
    return {
      externalRef: s.externalRef,
      date: toDbDate(s.date),
      startAt: s.startAt,
      endAt: s.endAt,
      timezone: s.timezone,
      roleId: s.roleId,
      venue: s.venue,
      notes: s.notes,
      status: s.status,
      rateClassOverrideId: s.rateClassOverrideId,
      version: shift.version,
    };
  }

  function eventData(shiftId: string, event: ShiftEventRecord) {
    return {
      shiftId,
      userId,
      seq: event.seq,
      kind: event.kind,
      snapshot: serializeSnapshot(event.snapshot),
      diff: event.diff ? serializeDiff(event.diff) : undefined,
      sourceEmailId: event.sourceEmailId,
      actor: event.actor,
      occurredAt: event.occurredAt,
    };
  }

  return {
    async create(shift, event) {
      await db.$transaction(async (tx) => {
        await tx.shift.create({
          data: {
            id: shift.id,
            userId,
            employerId: shift.employerId,
            contractId: shift.contractId,
            ...projectionData(shift),
          },
        });
        await tx.shiftEvent.create({ data: eventData(shift.id, event) });
      });
    },

    async applyEvent(shift, event) {
      await db.$transaction(async (tx) => {
        const updated = await tx.shift.updateMany({
          where: { id: shift.id, userId, version: event.seq - 1 },
          data: projectionData(shift),
        });
        if (updated.count === 0) {
          throw new ConcurrencyError(
            `shift ${shift.id} is not at version ${(event.seq - 1).toString()} (or not visible to tenant)`
          );
        }
        await tx.shiftEvent.create({ data: eventData(shift.id, event) });
      });
    },

    async getById(id) {
      const row = await db.shift.findFirst({ where: { id, userId } });
      return row ? shiftFromRow(row) : null;
    },

    async getWithHistory(id) {
      const row = await db.shift.findFirst({
        where: { id, userId },
        include: { events: { orderBy: { seq: 'asc' } } },
      });
      if (!row) return null;
      return {
        shift: shiftFromRow(row),
        events: row.events.map(shiftEventFromRow),
      };
    },

    async listRecentEvents(limit) {
      const rows = await db.shiftEvent.findMany({
        where: { userId },
        orderBy: { recordedAt: 'desc' },
        take: limit,
        include: { shift: { select: { date: true } } },
      });
      return rows.map((row) => ({
        ...shiftEventFromRow(row),
        shiftId: row.shiftId,
        shiftDate: fromDbDate(row.shift.date),
      }));
    },

    async listBetween(from: IsoDate, to: IsoDate, filter) {
      const rows = await db.shift.findMany({
        where: {
          userId,
          date: { gte: toDbDate(from), lte: toDbDate(to) },
          ...(filter?.employerId ? { employerId: filter.employerId } : {}),
        },
        orderBy: [{ date: 'asc' }, { startAt: 'asc' }],
      });
      return rows.map(shiftFromRow);
    },
  };
}
