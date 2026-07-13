import { buildDefaultParserRegistry } from '@/core/parsing/registry';
import { prisma } from '@/server/db';
import {
  createObjectStorageFromEnv,
  type ObjectStorage,
} from '@/server/integrations/storage/object-storage';
import {
  createRealtimePublisherFromEnv,
  type RealtimePublisher,
} from '@/server/integrations/realtime/publisher';
import {
  createIngestionService,
  type IngestionService,
  type PayrollProjector,
} from '@/server/services/ingestion-service';
import { createPayrollService, type PayrollService } from '@/server/services/payroll-service';

/**
 * Composition root (§3): the only place infrastructure is chosen and wired.
 * Everything else takes dependencies as arguments. Serverless-safe lazy
 * singletons.
 */
const singletons: {
  storage?: ObjectStorage;
  realtime?: RealtimePublisher;
  ingestion?: IngestionService;
  payroll?: PayrollService;
} = {};

export function getStorage(): ObjectStorage {
  singletons.storage ??= createObjectStorageFromEnv();
  return singletons.storage;
}

export function getRealtime(): RealtimePublisher {
  singletons.realtime ??= createRealtimePublisherFromEnv();
  return singletons.realtime;
}

export function getPayrollService(): PayrollService {
  singletons.payroll ??= createPayrollService({ db: prisma, realtime: getRealtime() });
  return singletons.payroll;
}

export function getPayrollProjector(): PayrollProjector {
  return getPayrollService().projector;
}

export function getIngestionService(): IngestionService {
  singletons.ingestion ??= createIngestionService({
    db: prisma,
    storage: getStorage(),
    realtime: getRealtime(),
    registry: buildDefaultParserRegistry(),
    projector: getPayrollProjector(),
  });
  return singletons.ingestion;
}
