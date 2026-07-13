import { DomainError } from '../errors';
import { compareIsoDates, dayOfWeek, type IsoDate } from '../dates/iso-date';
import { roundToInt, type RoundingMode } from '../money/money';
import { resolveRateClass, type RateClassDecision } from '../domain/rules/rule-engine';
import type { Rule, ShiftFacts } from '../domain/rules/rules';
import type {
  RateClassSpec,
  RateComponentSpec,
  RateVersionSpec,
  RoundingPolicy,
} from '../domain/employer/employer-config';
import type { ExplanationNode } from './explanation';

/**
 * The deterministic pay engine (constitution §2.1): pure functions over
 * versioned inputs. No clock, no I/O, no employer facts — mechanisms only.
 * Bump the version whenever computed output could change for identical
 * inputs; ExpectedPay rows record it for reproducibility.
 */
export const PAYROLL_ENGINE_VERSION = '1.0.0';

export interface EngineEmployerConfig {
  currency: string;
  rateClasses: RateClassSpec[];
  rules: Rule[];
  roundingPolicy: RoundingPolicy;
}

export interface ShiftPricingInput {
  shiftId: string;
  date: IsoDate;
  scheduledHours: number;
  roleSlug: string | null;
  roleDefaultRateClassSlug: string | null;
  overrideRateClassSlug: string | null;
  venue: string | null;
}

export interface PricedComponent {
  type: RateComponentSpec['type'];
  pence: number;
}

export interface ShiftPricing {
  shiftId: string;
  decision: RateClassDecision;
  rateVersionEffectiveFrom: IsoDate;
  components: PricedComponent[];
  grossPence: number;
  explanation: ExplanationNode;
}

function poundsOf(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function rateVersionFor(spec: RateClassSpec, date: IsoDate): RateVersionSpec | null {
  let candidate: RateVersionSpec | null = null;
  for (const version of spec.versions) {
    const started = compareIsoDates(version.effectiveFrom, date) <= 0;
    const notEnded =
      version.effectiveTo === null || compareIsoDates(date, version.effectiveTo) <= 0;
    if (started && notEnded) {
      if (!candidate || compareIsoDates(candidate.effectiveFrom, version.effectiveFrom) < 0) {
        candidate = version;
      }
    }
  }
  return candidate;
}

function priceComponent(
  component: RateComponentSpec,
  context: {
    hours: number;
    basePencePerHour: number | null;
    rounding: RoundingMode;
    holidayRounding: RoundingPolicy['holidayComputation'];
  }
): { pence: number; detail: string } {
  switch (component.type) {
    case 'BASE': {
      const pence = roundToInt(component.pencePerHour * context.hours, context.rounding);
      return {
        pence,
        detail: `${context.hours.toString()}h × ${poundsOf(component.pencePerHour)}/h = ${poundsOf(pence)}`,
      };
    }
    case 'HOLIDAY_ROLLED_UP': {
      if (context.basePencePerHour === null) {
        throw new DomainError('HOLIDAY_ROLLED_UP requires a BASE component', 'CONFIG_INVALID');
      }
      if (context.holidayRounding === 'PER_HOUR_RATE') {
        // Round the derived hourly holiday rate to a penny first — this is how
        // the evidenced employer *presents* it (£13.88 → £1.68/h). Verified
        // against a real payslip at onboarding (golden payslip check).
        const hourly = roundToInt(
          (context.basePencePerHour * component.percentOfBase) / 100,
          context.rounding
        );
        const pence = roundToInt(hourly * context.hours, context.rounding);
        return {
          pence,
          detail: `${component.percentOfBase.toString()}% of ${poundsOf(context.basePencePerHour)}/h = ${poundsOf(hourly)}/h × ${context.hours.toString()}h = ${poundsOf(pence)}`,
        };
      }
      const baseAmount = context.basePencePerHour * context.hours;
      const pence = roundToInt((baseAmount * component.percentOfBase) / 100, context.rounding);
      return {
        pence,
        detail: `${component.percentOfBase.toString()}% of ${poundsOf(roundToInt(baseAmount, context.rounding))} = ${poundsOf(pence)}`,
      };
    }
  }
}

/** Price one shift: rate-class decision → dated rate version → components. */
export function computeShiftPay(
  input: ShiftPricingInput,
  config: EngineEmployerConfig
): ShiftPricing {
  const facts: ShiftFacts = {
    roleSlug: input.roleSlug,
    dayOfWeek: dayOfWeek(input.date),
    scheduledHours: input.scheduledHours,
    venue: input.venue,
    date: input.date,
  };
  const decision = resolveRateClass({
    facts,
    overrideRateClassSlug: input.overrideRateClassSlug,
    roleDefaultRateClassSlug: input.roleDefaultRateClassSlug,
    rules: config.rules,
  });
  if (!decision) {
    throw new DomainError(
      `no rate class decidable for shift ${input.shiftId} (no override, matching rule, or role default)`,
      'CONFIG_INVALID'
    );
  }
  const spec = config.rateClasses.find((rc) => rc.slug === decision.rateClassSlug);
  if (!spec) {
    throw new DomainError(`unknown rate class "${decision.rateClassSlug}"`, 'CONFIG_INVALID');
  }
  const version = rateVersionFor(spec, input.date);
  if (!version) {
    throw new DomainError(
      `no rate version of "${spec.slug}" in force on ${input.date}`,
      'CONFIG_INVALID'
    );
  }

  const base = version.components.find((c) => c.type === 'BASE');
  const rounding = config.roundingPolicy.mode;
  const children: ExplanationNode[] = [];
  const components: PricedComponent[] = [];
  let gross = 0;
  for (const component of version.components) {
    const priced = priceComponent(component, {
      hours: input.scheduledHours,
      basePencePerHour: base?.type === 'BASE' ? base.pencePerHour : null,
      rounding,
      holidayRounding: config.roundingPolicy.holidayComputation,
    });
    components.push({ type: component.type, pence: priced.pence });
    gross += priced.pence;
    children.push({
      label: component.type === 'BASE' ? 'Base pay' : 'Rolled-up holiday pay',
      amountPence: priced.pence,
      detail: `${priced.detail} (rounded ${rounding}, per component)`,
    });
  }

  const decidedBy =
    decision.decidedBy === 'RULE'
      ? `rule “${decision.ruleName ?? ''}”`
      : decision.decidedBy === 'OVERRIDE'
        ? 'manual override'
        : 'role default';

  return {
    shiftId: input.shiftId,
    decision,
    rateVersionEffectiveFrom: version.effectiveFrom,
    components,
    grossPence: gross,
    explanation: {
      label: `Shift ${input.date} — ${spec.name}`,
      amountPence: gross,
      detail: `Rate class decided by ${decidedBy}; rates effective from ${version.effectiveFrom}`,
      children,
    },
  };
}

export interface PeriodGross {
  grossPence: number;
  shifts: ShiftPricing[];
  explanation: ExplanationNode;
}

/** Sum priced shifts into the period's gross with a full tree. */
export function computePeriodGross(
  shifts: ShiftPricingInput[],
  config: EngineEmployerConfig
): PeriodGross {
  const priced = shifts.map((s) => computeShiftPay(s, config));
  const grossPence = priced.reduce((acc, p) => acc + p.grossPence, 0);
  return {
    grossPence,
    shifts: priced,
    explanation: {
      label: 'Expected gross pay',
      amountPence: grossPence,
      detail: `${priced.length.toString()} shift(s)`,
      children: priced.map((p) => p.explanation),
    },
  };
}
