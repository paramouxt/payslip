import { describe, expect, it } from 'vitest';
import { isoDate } from '../../dates/iso-date';
import { resolveRateClass } from './rule-engine';
import {
  conditionSchema,
  evaluateCondition,
  parseRuleSetDocument,
  ruleSchema,
  type Rule,
  type ShiftFacts,
} from './rules';

// The Tracsis rules, expressed in the DSL (mirrors the employer template).
const tracsisRules: Rule[] = [
  {
    priority: 10,
    name: 'Sunday Hands-Free shifts paid at Reserved Parking rate',
    when: {
      all: [
        { fact: 'roleSlug', op: 'eq', value: 'hands-free' },
        { fact: 'dayOfWeek', op: 'eq', value: 'SUN' },
      ],
    },
    then: { assignRateClass: 'reserved-parking' },
  },
  {
    priority: 20,
    name: '10-hour Hands-Free shifts paid at Reserved Parking rate',
    when: {
      all: [
        { fact: 'roleSlug', op: 'eq', value: 'hands-free' },
        { fact: 'scheduledHours', op: 'gte', value: 10 },
      ],
    },
    then: { assignRateClass: 'reserved-parking' },
  },
];

function facts(overrides: Partial<ShiftFacts>): ShiftFacts {
  return {
    roleSlug: 'hands-free',
    dayOfWeek: 'MON',
    scheduledHours: 8,
    venue: 'Bicester Village',
    date: isoDate('2026-06-15'),
    ...overrides,
  };
}

describe('resolveRateClass — Tracsis rules', () => {
  it('Sunday Hands-Free is uplifted by rule', () => {
    const decision = resolveRateClass({
      facts: facts({ dayOfWeek: 'SUN' }),
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'hands-free',
      rules: tracsisRules,
    });
    expect(decision).toEqual({
      rateClassSlug: 'reserved-parking',
      decidedBy: 'RULE',
      ruleName: 'Sunday Hands-Free shifts paid at Reserved Parking rate',
    });
  });

  it('10-hour weekday Hands-Free is uplifted by the duration rule', () => {
    const decision = resolveRateClass({
      facts: facts({ scheduledHours: 10 }),
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'hands-free',
      rules: tracsisRules,
    });
    expect(decision?.decidedBy).toBe('RULE');
    expect(decision?.ruleName).toMatch(/10-hour/);
  });

  it('ordinary weekday Hands-Free falls through to the role default', () => {
    const decision = resolveRateClass({
      facts: facts({}),
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'hands-free',
      rules: tracsisRules,
    });
    expect(decision).toEqual({ rateClassSlug: 'hands-free', decidedBy: 'ROLE_DEFAULT' });
  });

  it('Reserved Parking roles are untouched by Hands-Free rules', () => {
    const decision = resolveRateClass({
      facts: facts({ roleSlug: 'reserved-parking', dayOfWeek: 'SUN' }),
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'reserved-parking',
      rules: tracsisRules,
    });
    expect(decision?.decidedBy).toBe('ROLE_DEFAULT');
  });

  it('manual override beats every rule', () => {
    const decision = resolveRateClass({
      facts: facts({ dayOfWeek: 'SUN' }),
      overrideRateClassSlug: 'hands-free',
      roleDefaultRateClassSlug: 'hands-free',
      rules: tracsisRules,
    });
    expect(decision).toEqual({ rateClassSlug: 'hands-free', decidedBy: 'OVERRIDE' });
  });

  it('lower priority number wins when several rules match', () => {
    const decision = resolveRateClass({
      facts: facts({ dayOfWeek: 'SUN', scheduledHours: 12 }),
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: 'hands-free',
      rules: tracsisRules,
    });
    expect(decision?.ruleName).toMatch(/Sunday/);
  });

  it('returns null when nothing decides', () => {
    const decision = resolveRateClass({
      facts: facts({ roleSlug: null }),
      overrideRateClassSlug: null,
      roleDefaultRateClassSlug: null,
      rules: tracsisRules,
    });
    expect(decision).toBeNull();
  });
});

describe('condition DSL', () => {
  it('supports any / not / in combinators', () => {
    const weekend = {
      any: [
        { fact: 'dayOfWeek', op: 'eq', value: 'SAT' },
        { fact: 'dayOfWeek', op: 'eq', value: 'SUN' },
      ],
    } as const;
    expect(evaluateCondition(conditionSchema.parse(weekend), facts({ dayOfWeek: 'SAT' }))).toBe(
      true
    );
    expect(
      evaluateCondition(conditionSchema.parse({ not: weekend }), facts({ dayOfWeek: 'TUE' }))
    ).toBe(true);
    expect(
      evaluateCondition(
        conditionSchema.parse({ fact: 'venue', op: 'in', value: ['Oxford', 'Bicester Village'] }),
        facts({})
      )
    ).toBe(true);
  });

  it('numeric comparison against a non-numeric fact is a non-match, not a crash', () => {
    expect(
      evaluateCondition(
        conditionSchema.parse({ fact: 'dayOfWeek', op: 'gte', value: 5 }),
        facts({})
      )
    ).toBe(false);
  });

  it('the grammar is closed: unknown facts and ops are rejected at parse time', () => {
    expect(() => conditionSchema.parse({ fact: 'shoeSize', op: 'eq', value: 9 })).toThrow();
    expect(() => conditionSchema.parse({ fact: 'venue', op: 'regex', value: '.*' })).toThrow();
    expect(() =>
      ruleSchema.parse({
        priority: 1,
        name: 'x',
        when: { all: [] },
        then: { assignRateClass: 'y' },
      })
    ).toThrow(); // empty combinator
  });

  it('parses a whole rule-set document', () => {
    const doc = parseRuleSetDocument({ version: 1, rules: tracsisRules });
    expect(doc.rules).toHaveLength(2);
  });
});
