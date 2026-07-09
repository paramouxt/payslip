import { z } from 'zod';
import { DomainError } from '../../errors';
import type { DayOfWeek, IsoDate } from '../../dates/iso-date';

/**
 * The rule DSL is a deliberately *closed* grammar (Phase 2 §7 / ADR 6):
 * boolean combinators over typed comparisons of shift facts, with effects
 * drawn from a fixed vocabulary. Rules are data — validated with zod at every
 * boundary, never evaluated as code. Extending expressiveness means extending
 * this module (with tests), not loosening validation.
 */

export interface ShiftFacts {
  roleSlug: string | null;
  dayOfWeek: DayOfWeek;
  scheduledHours: number;
  venue: string | null;
  date: IsoDate;
}

const factNameSchema = z.enum(['roleSlug', 'dayOfWeek', 'scheduledHours', 'venue', 'date']);
export type FactName = z.infer<typeof factNameSchema>;

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const comparisonSchema = z.union([
  z.object({ fact: factNameSchema, op: z.enum(['eq', 'neq']), value: scalarSchema }),
  z.object({ fact: factNameSchema, op: z.enum(['gt', 'gte', 'lt', 'lte']), value: z.number() }),
  z.object({ fact: factNameSchema, op: z.literal('in'), value: z.array(scalarSchema).min(1) }),
]);

export type Comparison = z.infer<typeof comparisonSchema>;

export type Condition =
  Comparison | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    comparisonSchema,
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
    z.object({ not: conditionSchema }),
  ])
);

const effectSchema = z.object({ assignRateClass: z.string().min(1) });
export type RuleEffect = z.infer<typeof effectSchema>;

export const ruleSchema = z.object({
  priority: z.number().int(),
  name: z.string().min(1),
  when: conditionSchema,
  then: effectSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleSetDocumentSchema = z.object({
  version: z.literal(1),
  rules: z.array(ruleSchema),
});
export type RuleSetDocument = z.infer<typeof ruleSetDocumentSchema>;

export function parseRuleSetDocument(raw: unknown): RuleSetDocument {
  const result = ruleSetDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new DomainError(`invalid rule set: ${result.error.message}`, 'CONFIG_INVALID');
  }
  return result.data;
}

function evaluateComparison(cmp: Comparison, facts: ShiftFacts): boolean {
  const actual = facts[cmp.fact];
  switch (cmp.op) {
    case 'eq':
      return actual === cmp.value;
    case 'neq':
      return actual !== cmp.value;
    case 'in':
      return cmp.value.some((v) => v === actual);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // Numeric comparison against a non-numeric fact is a non-match, not an
      // error: rules are user config and must degrade predictably.
      if (typeof actual !== 'number') return false;
      if (cmp.op === 'gt') return actual > cmp.value;
      if (cmp.op === 'gte') return actual >= cmp.value;
      if (cmp.op === 'lt') return actual < cmp.value;
      return actual <= cmp.value;
    }
  }
}

export function evaluateCondition(condition: Condition, facts: ShiftFacts): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, facts));
  if ('not' in condition) return !evaluateCondition(condition.not, facts);
  return evaluateComparison(condition, facts);
}
