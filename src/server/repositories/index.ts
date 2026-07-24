import type { PrismaClient } from '@/generated/prisma/client';
import type { TenantContext } from '@/server/tenant';
import type {
  ContractRepository,
  DiscrepancyRepository,
  EmailMessageRepository,
  EmployerRepository,
  ExpectedPayRepository,
  IngestConnectionLookup,
  MailboxConnectionRepository,
  NotificationRepository,
  PayrollPeriodRepository,
  PayslipRepository,
  ShiftRepository,
  StatutoryConfigRepository,
  TaxProfileRepository,
} from './ports';
import {
  createPrismaDiscrepancyRepository,
  createPrismaExpectedPayRepository,
  createPrismaPayslipRepository,
  createPrismaTaxProfileRepository,
} from './prisma/payroll-projection-repositories';
import { createPrismaContractRepository } from './prisma/contract-repository';
import { createPrismaEmailMessageRepository } from './prisma/email-message-repository';
import { createPrismaEmployerRepository } from './prisma/employer-repository';
import {
  createPrismaIngestConnectionLookup,
  createPrismaMailboxConnectionRepository,
} from './prisma/mailbox-connection-repository';
import { createPrismaNotificationRepository } from './prisma/notification-repository';
import { createPrismaPayrollPeriodRepository } from './prisma/payroll-period-repository';
import { createPrismaShiftRepository } from './prisma/shift-repository';
import { createPrismaStatutoryConfigRepository } from './prisma/statutory-config-repository';

export interface TenantRepositories {
  employers: EmployerRepository;
  contracts: ContractRepository;
  shifts: ShiftRepository;
  emailMessages: EmailMessageRepository;
  mailboxConnections: MailboxConnectionRepository;
  payrollPeriods: PayrollPeriodRepository;
  expectedPay: ExpectedPayRepository;
  payslips: PayslipRepository;
  discrepancies: DiscrepancyRepository;
  taxProfiles: TaxProfileRepository;
  notifications: NotificationRepository;
}

/** The only way to obtain tenant-scoped data access: with a TenantContext. */
export function createTenantRepositories(
  db: PrismaClient,
  tenant: TenantContext
): TenantRepositories {
  return {
    employers: createPrismaEmployerRepository(db, tenant),
    contracts: createPrismaContractRepository(db, tenant),
    shifts: createPrismaShiftRepository(db, tenant),
    emailMessages: createPrismaEmailMessageRepository(db, tenant),
    mailboxConnections: createPrismaMailboxConnectionRepository(db, tenant),
    payrollPeriods: createPrismaPayrollPeriodRepository(db, tenant),
    expectedPay: createPrismaExpectedPayRepository(db, tenant),
    payslips: createPrismaPayslipRepository(db, tenant),
    discrepancies: createPrismaDiscrepancyRepository(db, tenant),
    taxProfiles: createPrismaTaxProfileRepository(db, tenant),
    notifications: createPrismaNotificationRepository(db, tenant),
  };
}

export interface GlobalRepositories {
  statutoryConfigs: StatutoryConfigRepository;
  ingestConnections: IngestConnectionLookup;
}

export function createGlobalRepositories(db: PrismaClient): GlobalRepositories {
  return {
    statutoryConfigs: createPrismaStatutoryConfigRepository(db),
    ingestConnections: createPrismaIngestConnectionLookup(db),
  };
}
