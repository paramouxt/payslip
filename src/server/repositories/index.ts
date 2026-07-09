import type { PrismaClient } from '@prisma/client';
import type { TenantContext } from '@/server/tenant';
import type {
  ContractRepository,
  EmailMessageRepository,
  EmployerRepository,
  NotificationRepository,
  PayrollPeriodRepository,
  ShiftRepository,
  StatutoryConfigRepository,
} from './ports';
import { createPrismaContractRepository } from './prisma/contract-repository';
import { createPrismaEmailMessageRepository } from './prisma/email-message-repository';
import { createPrismaEmployerRepository } from './prisma/employer-repository';
import { createPrismaNotificationRepository } from './prisma/notification-repository';
import { createPrismaPayrollPeriodRepository } from './prisma/payroll-period-repository';
import { createPrismaShiftRepository } from './prisma/shift-repository';
import { createPrismaStatutoryConfigRepository } from './prisma/statutory-config-repository';

export interface TenantRepositories {
  employers: EmployerRepository;
  contracts: ContractRepository;
  shifts: ShiftRepository;
  emailMessages: EmailMessageRepository;
  payrollPeriods: PayrollPeriodRepository;
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
    payrollPeriods: createPrismaPayrollPeriodRepository(db, tenant),
    notifications: createPrismaNotificationRepository(db, tenant),
  };
}

export interface GlobalRepositories {
  statutoryConfigs: StatutoryConfigRepository;
}

export function createGlobalRepositories(db: PrismaClient): GlobalRepositories {
  return { statutoryConfigs: createPrismaStatutoryConfigRepository(db) };
}
