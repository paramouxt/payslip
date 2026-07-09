import { evaluateCondition, type Rule, type ShiftFacts } from './rules';

/**
 * Domain service resolving which rate class a shift is paid at.
 * Precedence (Phase 1 §3.3): manual override → first matching rule in
 * ascending priority order → the role's default rate class.
 * The decision explains itself — explanations are load-bearing (Phase 3 §2).
 */
export interface RateClassDecision {
  rateClassSlug: string;
  decidedBy: 'OVERRIDE' | 'RULE' | 'ROLE_DEFAULT';
  ruleName?: string;
}

export function resolveRateClass(input: {
  facts: ShiftFacts;
  overrideRateClassSlug: string | null;
  roleDefaultRateClassSlug: string | null;
  rules: readonly Rule[];
}): RateClassDecision | null {
  if (input.overrideRateClassSlug) {
    return { rateClassSlug: input.overrideRateClassSlug, decidedBy: 'OVERRIDE' };
  }
  const ordered = [...input.rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (evaluateCondition(rule.when, input.facts)) {
      return {
        rateClassSlug: rule.then.assignRateClass,
        decidedBy: 'RULE',
        ruleName: rule.name,
      };
    }
  }
  if (input.roleDefaultRateClassSlug) {
    return { rateClassSlug: input.roleDefaultRateClassSlug, decidedBy: 'ROLE_DEFAULT' };
  }
  return null;
}
