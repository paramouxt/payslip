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
  noopPayrollProjector,
} from '@/server/services/ingestion-service';

/**
 * Composition root (§3): the only place infrastructure is chosen and wired.
 * Everything else takes dependencies as arguments. Serverless-safe lazy
 * singletons.
 */
const singletons: {
  storage?: ObjectStorage;
  realtime?: RealtimePublisher;
  ingestion?: IngestionService;
  projector?: PayrollProjector;
} = {};

export function getStorage(): ObjectStorage {
  singletons.storage ??= createObjectStorageFromEnv();
  return singletons.storage;
}

export function getRealtime(): RealtimePublisher {
  singletons.realtime ??= createRealtimePublisherFromEnv();
  return singletons.realtime;
}

export function getPayrollProjector(): PayrollProjector {
  singletons.projector ??= noopPayrollProjector; // replaced in Phase 8
  return singletons.projector;
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
