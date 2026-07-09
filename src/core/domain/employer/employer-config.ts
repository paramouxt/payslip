import { z } from 'zod';
import { DomainError } from '../../errors';
import { isoDateSchema } from '../../dates/iso-date';
import { payPeriodSchemeSchema } from '../payroll-period/scheme';
import { ruleSchema } from '../rules/rules';

/**
 * The full, validated configuration document for one employer: everything the
 * payroll engine needs, and nothing hardcoded. Employers are created from a
 * config (template or hand-built) and always load back into this shape —
 * zod-validated at the repository boundary so bad config cannot reach engines.
 */

export const rateComponentSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('BASE'), pencePerHour: z.number().int().positive() }),
  z.object({ type: z.literal('HOLIDAY_ROLLED_UP'), percentOfBase: z.number().positive() }),
]);
export type RateComponentSpec = z.infer<typeof rateComponentSpecSchema>;

export const rateVersionSpecSchema = z.object({
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable(),
  components: z.array(rateComponentSpecSchema).min(1),
});
export type RateVersionSpec = z.infer<typeof rateVersionSpecSchema>;

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slugs are lowercase-kebab');

export const rateClassSpecSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  versions: z.array(rateVersionSpecSchema).min(1),
});
export type RateClassSpec = z.infer<typeof rateClassSpecSchema>;

export const roleSpecSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  defaultRateClassSlug: slugSchema.nullable(),
});
export type RoleSpec = z.infer<typeof roleSpecSchema>;

export const roundingPolicySchema = z.object({
  version: z.literal(1),
  /** Where fractions are rounded to pence. Validated against real payslips
   *  during employer onboarding (Phase 3 §5). */
  level: z.literal('PER_SHIFT_COMPONENT'),
  mode: z.enum(['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL', 'TRUNCATE']),
});
export type RoundingPolicy = z.infer<typeof roundingPolicySchema>;

export const senderPatternSchema = z.object({
  fromDomain: z.string().min(1).optional(),
  fromAddress: z.string().min(1).optional(),
  subjectContains: z.string().min(1).optional(),
});

export const employerConfigSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  timezone: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  payPeriodScheme: payPeriodSchemeSchema,
  roundingPolicy: roundingPolicySchema,
  senderPatterns: z.array(senderPatternSchema).default([]),
  roles: z.array(roleSpecSchema).min(1),
  rateClasses: z.array(rateClassSpecSchema).min(1),
  rules: z.array(ruleSchema).default([]),
  /** When the initial rule set takes effect; defaults to the scheme anchor. */
  rulesEffectiveFrom: isoDateSchema.optional(),
});
export type EmployerConfig = z.infer<typeof employerConfigSchema>;

export function parseEmployerConfig(raw: unknown): EmployerConfig {
  const result = employerConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new DomainError(`invalid employer config: ${result.error.message}`, 'CONFIG_INVALID');
  }
  const config = result.data;
  const classSlugs = new Set(config.rateClasses.map((c) => c.slug));
  for (const role of config.roles) {
    if (role.defaultRateClassSlug && !classSlugs.has(role.defaultRateClassSlug)) {
      throw new DomainError(
        `role "${role.slug}" defaults to unknown rate class "${role.defaultRateClassSlug}"`,
        'CONFIG_INVALID'
      );
    }
  }
  for (const rule of config.rules) {
    if (!classSlugs.has(rule.then.assignRateClass)) {
      throw new DomainError(
        `rule "${rule.name}" assigns unknown rate class "${rule.then.assignRateClass}"`,
        'CONFIG_INVALID'
      );
    }
  }
  return config;
}
