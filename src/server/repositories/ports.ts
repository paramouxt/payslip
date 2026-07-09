import type { IsoDate } from '@/core/dates/iso-date';
import type { EmployerConfig } from '@/core/domain/employer/employer-config';
import type { PeriodSpan } from '@/core/domain/payroll-period/scheme';
import type { Shift, ShiftEventRecord } from '@/core/domain/shift/shift';

/**
 * Repository ports. Implementations map between the domain model and
 * persistence; the domain never sees Prisma types, and every method on a
 * tenant-scoped repository is bound to one user by construction.
 */

export interface EmployerSummary {
  id: string;
  name: string;
  slug: string;
  currency: string;
  jurisdiction: string;
}

export interface LoadedEmployerConfig {
  employerId: string;
  config: EmployerConfig;
  roleIdsBySlug: Record<string, string>;
  rateClassIdsBySlug: Record<string, string>;
  activeRuleSetVersion: number | null;
}

export interface EmployerRepository {
  /** Creates the employer aggregate (roles, rate classes + versions, rule set v1). */
  createFromConfig(config: EmployerConfig): Promise<{ employerId: string }>;
  getConfig(employerId: string): Promise<LoadedEmployerConfig | null>;
  list(): Promise<EmployerSummary[]>;
}

export interface ContractRecord {
  id: string;
  employerId: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
  defaultRoleId: string | null;
  notes: string | null;
}

export interface ContractRepository {
  create(input: {
    employerId: string;
    startDate: IsoDate;
    endDate?: IsoDate | null;
    defaultRoleId?: string | null;
    notes?: string | null;
  }): Promise<ContractRecord>;
  getById(id: string): Promise<ContractRecord | null>;
  listByEmployer(employerId: string): Promise<ContractRecord[]>;
}

export interface ShiftRepository {
  /** Persists a freshly created aggregate (projection + CREATED event). */
  create(shift: Shift, event: ShiftEventRecord): Promise<void>;
  /**
   * Persists one new event and the updated projection, with optimistic
   * concurrency on the projection version. Throws ConcurrencyError when the
   * stored version is not event.seq - 1.
   */
  applyEvent(shift: Shift, event: ShiftEventRecord): Promise<void>;
  getById(id: string): Promise<Shift | null>;
  getWithHistory(id: string): Promise<{ shift: Shift; events: ShiftEventRecord[] } | null>;
  listBetween(from: IsoDate, to: IsoDate, filter?: { employerId?: string }): Promise<Shift[]>;
}

export interface EmailMessageRecord {
  id: string;
  dedupeKey: string;
  receivedAt: Date;
  subject: string;
  fromAddress: string;
  parseStatus: 'PENDING' | 'PARSED' | 'QUARANTINED' | 'IGNORED';
}

export interface EmailMessageRepository {
  /**
   * Idempotent insert. `dedupeKey` must be computed to include the tenant
   * (hash of userId + provider message id) so replays and multi-delivery
   * collapse safely. Returns created=false when the key already exists.
   */
  insertIfNew(input: {
    dedupeKey: string;
    providerMessageId?: string | null;
    mailboxConnectionId?: string | null;
    receivedAt: Date;
    subject: string;
    fromAddress: string;
    rawStorageKey?: string | null;
    sizeBytes?: number | null;
  }): Promise<{ created: boolean; id: string }>;
  listByStatus(status: EmailMessageRecord['parseStatus']): Promise<EmailMessageRecord[]>;
}

export interface PayrollPeriodRecord {
  id: string;
  employerId: string;
  sequence: number;
  startDate: IsoDate;
  endDate: IsoDate;
  expectedPayDate: IsoDate;
}

export interface PayrollPeriodRepository {
  /** Idempotent materialisation of a resolved period span. */
  ensure(employerId: string, span: PeriodSpan): Promise<PayrollPeriodRecord>;
  listRange(employerId: string, from: IsoDate, to: IsoDate): Promise<PayrollPeriodRecord[]>;
}

export interface NotificationRecord {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  readAt: Date | null;
}

export interface NotificationRepository {
  create(input: { type: string; payload: unknown }): Promise<NotificationRecord>;
  listUnread(): Promise<NotificationRecord[]>;
  markRead(id: string): Promise<void>;
}

/** Global (not tenant-scoped): statutory tables are shared reference data. */
export interface StatutoryConfigRepository {
  get(
    jurisdiction: string,
    taxYear: string
  ): Promise<{ id: string; effectiveFrom: IsoDate; config: unknown; source: string } | null>;
  upsert(input: {
    jurisdiction: string;
    taxYear: string;
    effectiveFrom: IsoDate;
    config: unknown;
    source: string;
  }): Promise<{ id: string }>;
}
