import { DomainError } from '../../errors';
import { isIsoDate, type IsoDate } from '../../dates/iso-date';

/**
 * Shift is an aggregate over an append-only event stream. The projection (this
 * class) is convenience; the events are the truth and the evidence — every
 * change links to the rota email that caused it, or to the human who made it.
 * All mutating operations are immutable: they return the next Shift plus the
 * event that must be persisted with it.
 */

export type ShiftStatus = 'SCHEDULED' | 'AMENDED' | 'CANCELLED' | 'COMPLETED';

export type ShiftEventKind =
  | 'CREATED'
  | 'AMENDED'
  | 'CANCELLED'
  | 'REINSTATED'
  | 'MANUAL_EDIT'
  | 'OVERRIDE_SET'
  | 'OVERRIDE_CLEARED';

/** Where a change came from: a source email (ingestion) or a human/system actor. */
export interface ShiftEvidence {
  sourceEmailId?: string;
  actor?: 'user' | 'system';
  occurredAt: Date;
}

export interface ShiftDetails {
  externalRef: string | null;
  date: IsoDate;
  startAt: Date;
  endAt: Date;
  timezone: string;
  roleId: string | null;
  venue: string | null;
  notes: string | null;
}

export interface ShiftSnapshot extends ShiftDetails {
  status: ShiftStatus;
  rateClassOverrideId: string | null;
}

export type ShiftDiff = Partial<Record<keyof ShiftSnapshot, { from: unknown; to: unknown }>>;

export interface ShiftEventRecord {
  seq: number;
  kind: ShiftEventKind;
  snapshot: ShiftSnapshot;
  diff: ShiftDiff | null;
  sourceEmailId: string | null;
  actor: string | null;
  occurredAt: Date;
}

export interface ShiftIdentity {
  id: string;
  userId: string;
  employerId: string;
  contractId: string;
}

interface ShiftProps extends ShiftIdentity {
  snapshot: ShiftSnapshot;
  version: number;
}

function validateDetails(details: ShiftDetails): void {
  if (!isIsoDate(details.date)) {
    throw new DomainError(`invalid shift date: ${String(details.date)}`, 'INVALID_ARGUMENT');
  }
  if (details.endAt.getTime() <= details.startAt.getTime()) {
    throw new DomainError('shift must end after it starts', 'INVARIANT_VIOLATION');
  }
  const hours = (details.endAt.getTime() - details.startAt.getTime()) / 3_600_000;
  if (hours > 24) {
    throw new DomainError('a single shift cannot exceed 24 hours', 'INVARIANT_VIOLATION');
  }
  if (details.timezone.length === 0) {
    throw new DomainError('shift requires a timezone', 'INVALID_ARGUMENT');
  }
}

function snapshotValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

function diffSnapshots(before: ShiftSnapshot, after: ShiftSnapshot): ShiftDiff {
  const diff: ShiftDiff = {};
  for (const key of Object.keys(after) as (keyof ShiftSnapshot)[]) {
    const from = snapshotValue(before[key]);
    const to = snapshotValue(after[key]);
    if (from !== to) diff[key] = { from, to };
  }
  return diff;
}

function evidenceFields(evidence: ShiftEvidence): {
  sourceEmailId: string | null;
  actor: string | null;
} {
  if (!evidence.sourceEmailId && !evidence.actor) {
    throw new DomainError('evidence requires a source email or an actor', 'INVALID_ARGUMENT');
  }
  return { sourceEmailId: evidence.sourceEmailId ?? null, actor: evidence.actor ?? null };
}

export class Shift {
  private constructor(private readonly props: ShiftProps) {}

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get employerId(): string {
    return this.props.employerId;
  }
  get contractId(): string {
    return this.props.contractId;
  }
  get version(): number {
    return this.props.version;
  }
  get snapshot(): ShiftSnapshot {
    return { ...this.props.snapshot };
  }
  get status(): ShiftStatus {
    return this.props.snapshot.status;
  }

  /** Scheduled duration in hours — instant arithmetic, so DST-safe. */
  get scheduledHours(): number {
    const { startAt, endAt } = this.props.snapshot;
    return (endAt.getTime() - startAt.getTime()) / 3_600_000;
  }

  static create(input: {
    identity: ShiftIdentity;
    details: ShiftDetails;
    evidence: ShiftEvidence;
  }): { shift: Shift; event: ShiftEventRecord } {
    validateDetails(input.details);
    const snapshot: ShiftSnapshot = {
      ...input.details,
      status: 'SCHEDULED',
      rateClassOverrideId: null,
    };
    const event: ShiftEventRecord = {
      seq: 1,
      kind: 'CREATED',
      snapshot,
      diff: null,
      ...evidenceFields(input.evidence),
      occurredAt: input.evidence.occurredAt,
    };
    return { shift: new Shift({ ...input.identity, snapshot, version: 1 }), event };
  }

  /** Rehydrate the projection from persistence (no events needed). */
  static rehydrate(props: ShiftProps): Shift {
    return new Shift(props);
  }

  /** Rebuild from the event stream — used to verify projections and in tests. */
  static fromEvents(identity: ShiftIdentity, events: readonly ShiftEventRecord[]): Shift {
    if (events.length === 0) throw new DomainError('cannot rebuild a shift from zero events');
    events.forEach((e, i) => {
      if (e.seq !== i + 1) {
        throw new DomainError(
          `event stream gap: expected seq ${(i + 1).toString()}, got ${e.seq.toString()}`
        );
      }
    });
    const last = events.at(-1);
    if (!last) throw new DomainError('cannot rebuild a shift from zero events');
    return new Shift({ ...identity, snapshot: { ...last.snapshot }, version: last.seq });
  }

  private next(
    kind: ShiftEventKind,
    snapshot: ShiftSnapshot,
    diff: ShiftDiff | null,
    evidence: ShiftEvidence
  ): { shift: Shift; event: ShiftEventRecord } {
    const event: ShiftEventRecord = {
      seq: this.props.version + 1,
      kind,
      snapshot,
      diff,
      ...evidenceFields(evidence),
      occurredAt: evidence.occurredAt,
    };
    return {
      shift: new Shift({ ...this.props, snapshot, version: event.seq }),
      event,
    };
  }

  /** Amend details. Ingestion-sourced amendments are AMENDED; human ones MANUAL_EDIT. */
  amend(
    changes: Partial<ShiftDetails>,
    evidence: ShiftEvidence
  ): { shift: Shift; event: ShiftEventRecord } {
    if (this.status === 'CANCELLED') {
      throw new DomainError('cannot amend a cancelled shift — reinstate it first');
    }
    const details: ShiftDetails = {
      externalRef: this.props.snapshot.externalRef,
      date: this.props.snapshot.date,
      startAt: this.props.snapshot.startAt,
      endAt: this.props.snapshot.endAt,
      timezone: this.props.snapshot.timezone,
      roleId: this.props.snapshot.roleId,
      venue: this.props.snapshot.venue,
      notes: this.props.snapshot.notes,
      ...changes,
    };
    validateDetails(details);
    const snapshot: ShiftSnapshot = {
      ...details,
      status: 'AMENDED',
      rateClassOverrideId: this.props.snapshot.rateClassOverrideId,
    };
    const diff = diffSnapshots(this.props.snapshot, snapshot);
    const materialKeys = Object.keys(diff).filter((k) => k !== 'status');
    if (materialKeys.length === 0) {
      throw new DomainError('amendment changes nothing', 'NO_OP');
    }
    return this.next(evidence.sourceEmailId ? 'AMENDED' : 'MANUAL_EDIT', snapshot, diff, evidence);
  }

  cancel(evidence: ShiftEvidence): { shift: Shift; event: ShiftEventRecord } {
    if (this.status === 'CANCELLED') throw new DomainError('shift is already cancelled', 'NO_OP');
    const snapshot: ShiftSnapshot = { ...this.props.snapshot, status: 'CANCELLED' };
    return this.next('CANCELLED', snapshot, diffSnapshots(this.props.snapshot, snapshot), evidence);
  }

  reinstate(evidence: ShiftEvidence): { shift: Shift; event: ShiftEventRecord } {
    if (this.status !== 'CANCELLED') {
      throw new DomainError('only a cancelled shift can be reinstated', 'INVARIANT_VIOLATION');
    }
    const snapshot: ShiftSnapshot = { ...this.props.snapshot, status: 'SCHEDULED' };
    return this.next(
      'REINSTATED',
      snapshot,
      diffSnapshots(this.props.snapshot, snapshot),
      evidence
    );
  }

  /** Manual rate-class override — beats rules, which beat role defaults. */
  setRateClassOverride(
    rateClassId: string | null,
    evidence: ShiftEvidence
  ): { shift: Shift; event: ShiftEventRecord } {
    if (this.props.snapshot.rateClassOverrideId === rateClassId) {
      throw new DomainError('override unchanged', 'NO_OP');
    }
    const snapshot: ShiftSnapshot = { ...this.props.snapshot, rateClassOverrideId: rateClassId };
    return this.next(
      rateClassId === null ? 'OVERRIDE_CLEARED' : 'OVERRIDE_SET',
      snapshot,
      diffSnapshots(this.props.snapshot, snapshot),
      evidence
    );
  }
}
