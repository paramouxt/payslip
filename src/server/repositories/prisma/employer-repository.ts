import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { DomainError } from '@/core/errors';
import {
  parseEmployerConfig,
  rateComponentSpecSchema,
  type EmployerConfig,
} from '@/core/domain/employer/employer-config';
import { ruleSetDocumentSchema } from '@/core/domain/rules/rules';
import type { TenantContext } from '@/server/tenant';
import type { EmployerRepository, LoadedEmployerConfig } from '../ports';
import { fromDbDate, toDbDate } from './mappers';

const componentsSchema = z.array(rateComponentSpecSchema).min(1);

export function createPrismaEmployerRepository(
  db: PrismaClient,
  tenant: TenantContext
): EmployerRepository {
  const { userId } = tenant;

  return {
    async createFromConfig(rawConfig) {
      const config = parseEmployerConfig(rawConfig);
      return db.$transaction(async (tx) => {
        const employer = await tx.employer.create({
          data: {
            userId,
            name: config.name,
            slug: config.slug,
            timezone: config.timezone,
            currency: config.currency,
            jurisdiction: config.jurisdiction,
            payPeriodScheme: config.payPeriodScheme,
            roundingPolicy: config.roundingPolicy,
            senderPatterns: config.senderPatterns,
            rosterNames: config.rosterNames,
          },
        });

        const rateClassIdsBySlug: Record<string, string> = {};
        for (const rc of config.rateClasses) {
          const row = await tx.rateClass.create({
            data: { employerId: employer.id, name: rc.name, slug: rc.slug },
          });
          rateClassIdsBySlug[rc.slug] = row.id;
          await tx.rateVersion.createMany({
            data: rc.versions.map((v) => ({
              rateClassId: row.id,
              effectiveFrom: toDbDate(v.effectiveFrom),
              effectiveTo: v.effectiveTo ? toDbDate(v.effectiveTo) : null,
              components: v.components,
            })),
          });
        }

        for (const role of config.roles) {
          await tx.role.create({
            data: {
              employerId: employer.id,
              name: role.name,
              slug: role.slug,
              defaultRateClassId: role.defaultRateClassSlug
                ? rateClassIdsBySlug[role.defaultRateClassSlug]
                : null,
            },
          });
        }

        if (config.rules.length > 0) {
          await tx.ruleSet.create({
            data: {
              employerId: employer.id,
              version: 1,
              status: 'ACTIVE',
              effectiveFrom: toDbDate(
                config.rulesEffectiveFrom ?? config.payPeriodScheme.anchorStart
              ),
              rules: { version: 1, rules: config.rules },
            },
          });
        }

        return { employerId: employer.id };
      });
    },

    async getConfig(employerId): Promise<LoadedEmployerConfig | null> {
      const row = await db.employer.findFirst({
        where: { id: employerId, userId },
        include: {
          roles: { orderBy: { slug: 'asc' } },
          rateClasses: {
            orderBy: { slug: 'asc' },
            include: { rateVersions: { orderBy: { effectiveFrom: 'asc' } } },
          },
          ruleSets: { where: { status: 'ACTIVE' }, orderBy: { version: 'desc' }, take: 1 },
        },
      });
      if (!row) return null;

      const rateClassIdsBySlug: Record<string, string> = {};
      const rateClassSlugsById: Record<string, string> = {};
      for (const rc of row.rateClasses) {
        rateClassIdsBySlug[rc.slug] = rc.id;
        rateClassSlugsById[rc.id] = rc.slug;
      }
      const roleIdsBySlug: Record<string, string> = {};
      for (const role of row.roles) roleIdsBySlug[role.slug] = role.id;

      const activeRuleSet = row.ruleSets[0] ?? null;
      const rules = activeRuleSet ? ruleSetDocumentSchema.parse(activeRuleSet.rules).rules : [];

      const config: EmployerConfig = parseEmployerConfig({
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        currency: row.currency,
        jurisdiction: row.jurisdiction,
        payPeriodScheme: row.payPeriodScheme,
        roundingPolicy: row.roundingPolicy,
        senderPatterns: row.senderPatterns,
        rosterNames: z.array(z.string().min(1)).parse(row.rosterNames),
        roles: row.roles.map((r) => ({
          slug: r.slug,
          name: r.name,
          defaultRateClassSlug: r.defaultRateClassId
            ? (rateClassSlugsById[r.defaultRateClassId] ?? null)
            : null,
        })),
        rateClasses: row.rateClasses.map((rc) => ({
          slug: rc.slug,
          name: rc.name,
          versions: rc.rateVersions.map((v) => ({
            effectiveFrom: fromDbDate(v.effectiveFrom),
            effectiveTo: v.effectiveTo ? fromDbDate(v.effectiveTo) : null,
            components: componentsSchema.parse(v.components),
          })),
        })),
        rules,
        rulesEffectiveFrom: activeRuleSet ? fromDbDate(activeRuleSet.effectiveFrom) : undefined,
      });

      return {
        employerId: row.id,
        config,
        roleIdsBySlug,
        rateClassIdsBySlug,
        activeRuleSetVersion: activeRuleSet?.version ?? null,
      };
    },

    async list() {
      const rows = await db.employer.findMany({
        where: { userId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, currency: true, jurisdiction: true },
      });
      return rows;
    },
  };
}

/** Guard shared by repositories that take an employerId from the caller. */
export async function assertEmployerOwned(
  db: PrismaClient,
  tenant: TenantContext,
  employerId: string
): Promise<void> {
  const found = await db.employer.findFirst({
    where: { id: employerId, userId: tenant.userId },
    select: { id: true },
  });
  if (!found) {
    throw new DomainError(`employer ${employerId} not found for tenant`, 'INVALID_ARGUMENT');
  }
}
