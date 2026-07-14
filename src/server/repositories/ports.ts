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
  /** Latest events across all shifts — the dashboard's "recent changes" feed. */
  listRecentEvents(
    limit: number
  ): Promise<(ShiftEventRecord & { shiftId: string; shiftDate: IsoDate })[]>;
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
  getById(id: string): Promise<(EmailMessageRecord & { classification: string | null }) | null>;
  setArchive(id: string, rawStorageKey: string, sizeBytes: number): Promise<void>;
  setClassification(id: string, classification: string): Promise<void>;
  setParseOutcome(
    id: string,
    outcome: {
      status: EmailMessageRecord['parseStatus'];
      parserId?: string | null;
      parserVersion?: string | null;
      parseError?: string | null;
    }
  ): Promise<void>;
  listByStatus(status: EmailMessageRecord['parseStatus']): Promise<EmailMessageRecord[]>;
  countByStatus(status: EmailMessageRecord['parseStatus']): Promise<number>;
}

export interface MailboxConnectionRecord {
  id: string;
  provider: string;
  label: string;
  emailAddress: string | null;
  lastEventAt: Date | null;
  activeKeyVersion: number;
  createdAt: Date;
}

export interface MailboxConnectionRepository {
  create(input: {
    provider: 'APPS_SCRIPT_PUSH' | 'GENERIC_WEBHOOK';
    label: string;
    emailAddress?: string | null;
    keyVersion: number;
    verificationHash: string;
  }): Promise<MailboxConnectionRecord>;
  list(): Promise<MailboxConnectionRecord[]>;
  getById(id: string): Promise<MailboxConnectionRecord | null>;
  /** Adds a new key version and revokes prior ones. */
  rotateKey(connectionId: string, keyVersion: number, verificationHash: string): Promise<void>;
  touchLastEvent(connectionId: string, at: Date): Promise<void>;
}

/**
 * Machine-path lookup for the ingestion endpoint: there is no session, so the
 * tenant is derived FROM the connection row. Global by necessity, documented
 * as the exception it is (§4.3 allows only statutory config + this).
 */
export interface IngestConnectionLookup {
  findForIngest(connectionId: string): Promise<{
    id: string;
    userId: string;
    activeKeyVersion: number;
    verificationHash: string;
  } | null>;
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

export interface ExpectedPaySnapshot {
  id: string;
  payrollPeriodId: string;
  computedAt: Date;
  engineVersion: string;
  ruleSetVersion: number | null;
  statutoryConfigId: string | null;
  ytdAnchorPayslipId: string | null;
  grossPence: number;
  taxPence: number;
  niPence: number;
  pensionPence: number;
  netPence: number;
  lines: unknown;
}

export interface ExpectedPayRepository {
  /** Supersede current=true rows for the period (kept, flagged) and insert the new current. */
  supersedeAndCreate(
    input: Omit<ExpectedPaySnapshot, 'id' | 'computedAt'>
  ): Promise<{ id: string }>;
  currentForPeriod(payrollPeriodId: string): Promise<ExpectedPaySnapshot | null>;
  historyForPeriod(payrollPeriodId: string): Promise<ExpectedPaySnapshot[]>;
}

export interface PayslipRecord {
  id: string;
  employerId: string;
  contractId: string;
  payrollPeriodId: string | null;
  documentStorageKey: string | null;
  payDate: IsoDate;
  grossPence: number;
  taxPence: number;
  niPence: number;
  pensionPence: number;
  netPence: number;
  ytd: unknown;
  lines: unknown;
}

export interface PayslipRepository {
  create(
    input: Omit<PayslipRecord, 'id' | 'documentStorageKey' | 'lines'> & {
      sourceEmailId?: string | null;
      documentStorageKey?: string | null;
      lines?: unknown;
    }
  ): Promise<PayslipRecord>;
  list(): Promise<PayslipRecord[]>;
  getById(id: string): Promise<PayslipRecord | null>;
  forPeriod(payrollPeriodId: string): Promise<PayslipRecord | null>;
  /** In-tax-year totals strictly before `payDate` for the YTD anchor. */
  aggregateBefore(
    employerId: string,
    payDate: IsoDate,
    taxYearStart: IsoDate
  ): Promise<{
    count: number;
    sumGrossPence: number;
    sumTaxPence: number;
    latestId: string | null;
    latestYtd: unknown;
  }>;
}

export interface DiscrepancyRecord {
  id: string;
  payrollPeriodId: string;
  payslipId: string | null;
  kind: string;
  severity: 'INFO' | 'MINOR' | 'MAJOR';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'EXPECTED_WRONG';
  expectedPence: number | null;
  actualPence: number | null;
  deltaPence: number;
  summary: string;
  createdAt: Date;
}

export interface DiscrepancyDraftInput {
  kind: string;
  severity: 'INFO' | 'MINOR' | 'MAJOR';
  expectedPence: number;
  actualPence: number;
  deltaPence: number;
  summary: string;
  evidence: unknown;
}

export interface DiscrepancyRepository {
  /** OPEN rows for the period are superseded by the fresh reconciliation;
   *  human-touched rows (ACK/RESOLVED/EXPECTED_WRONG) are never removed. */
  replaceOpenForPeriod(
    payrollPeriodId: string,
    payslipId: string | null,
    drafts: DiscrepancyDraftInput[]
  ): Promise<DiscrepancyRecord[]>;
  list(filter?: { status?: DiscrepancyRecord['status'] }): Promise<DiscrepancyRecord[]>;
  setStatus(id: string, status: DiscrepancyRecord['status']): Promise<void>;
}

export interface TaxProfileRecord {
  jurisdiction: string;
  taxYear: string;
  taxCode: string;
  taxBasis: 'CUMULATIVE' | 'WEEK1MONTH1';
  niCategory: string;
  pension: unknown;
  studentLoan: string | null;
}

export interface TaxProfileRepository {
  get(jurisdiction: string, taxYear: string): Promise<TaxProfileRecord | null>;
  upsert(input: TaxProfileRecord): Promise<void>;
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
