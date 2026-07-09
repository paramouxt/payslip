import type { Prisma } from '@prisma/client';
import { fromUtcInstant, isoDate, toUtcMidnight, type IsoDate } from '@/core/dates/iso-date';
import {
  Shift,
  type ShiftEventRecord,
  type ShiftSnapshot,
  type ShiftStatus,
} from '@/core/domain/shift/shift';

/** Prisma `@db.Date` columns round-trip as UTC-midnight Date objects. */
export function toDbDate(date: IsoDate): Date {
  return toUtcMidnight(date);
}

export function fromDbDate(value: Date): IsoDate {
  return fromUtcInstant(value);
}

/**
 * Diff values are JSON-safe by construction (the aggregate stringifies
 * instants before diffing) — the cast just tells Prisma so.
 */
export function serializeDiff(diff: NonNullable<ShiftEventRecord['diff']>): Prisma.InputJsonValue {
  return diff as unknown as Prisma.InputJsonValue;
}

/** JSON-safe form of a shift snapshot (instants become ISO strings). */
export function serializeSnapshot(s: ShiftSnapshot): Prisma.InputJsonValue {
  return {
    ...s,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
  };
}

export function deserializeSnapshot(raw: unknown): ShiftSnapshot {
  const o = raw as Record<string, unknown>;
  return {
    externalRef: (o.externalRef as string | null) ?? null,
    date: isoDate(o.date as string),
    startAt: new Date(o.startAt as string),
    endAt: new Date(o.endAt as string),
    timezone: o.timezone as string,
    roleId: (o.roleId as string | null) ?? null,
    venue: (o.venue as string | null) ?? null,
    notes: (o.notes as string | null) ?? null,
    status: o.status as ShiftStatus,
    rateClassOverrideId: (o.rateClassOverrideId as string | null) ?? null,
  };
}

export interface ShiftRow {
  id: string;
  userId: string;
  employerId: string;
  contractId: string;
  externalRef: string | null;
  date: Date;
  startAt: Date;
  endAt: Date;
  timezone: string;
  roleId: string | null;
  venue: string | null;
  notes: string | null;
  status: string;
  rateClassOverrideId: string | null;
  version: number;
}

export function shiftFromRow(row: ShiftRow): Shift {
  return Shift.rehydrate({
    id: row.id,
    userId: row.userId,
    employerId: row.employerId,
    contractId: row.contractId,
    version: row.version,
    snapshot: {
      externalRef: row.externalRef,
      date: fromDbDate(row.date),
      startAt: row.startAt,
      endAt: row.endAt,
      timezone: row.timezone,
      roleId: row.roleId,
      venue: row.venue,
      notes: row.notes,
      status: row.status as ShiftStatus,
      rateClassOverrideId: row.rateClassOverrideId,
    },
  });
}

export interface ShiftEventRow {
  seq: number;
  kind: string;
  snapshot: unknown;
  diff: unknown;
  sourceEmailId: string | null;
  actor: string | null;
  occurredAt: Date;
}

export function shiftEventFromRow(row: ShiftEventRow): ShiftEventRecord {
  return {
    seq: row.seq,
    kind: row.kind as ShiftEventRecord['kind'],
    snapshot: deserializeSnapshot(row.snapshot),
    diff: (row.diff as ShiftEventRecord['diff'] | null) ?? null,
    sourceEmailId: row.sourceEmailId,
    actor: row.actor,
    occurredAt: row.occurredAt,
  };
}
