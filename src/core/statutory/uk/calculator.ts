import { roundToInt } from '../../money/money';
import type { ExplanationNode } from '../../payroll/explanation';
import type { UkStatutoryConfig } from '../config';

/**
 * UK statutory ESTIMATES (constitution §2.12): PAYE income tax (cumulative or
 * W1/M1), employee Class 1 NI (per-period), auto-enrolment pension, student
 * loans. Pure functions over config data; every figure explains itself.
 * Estimates are re-anchored to payslip YTD figures so error cannot compound
 * (Phase 2 §3). This is reconciliation tooling, not tax advice.
 */
export const UK_STATUTORY_ENGINE_VERSION = '1.0.0';

export interface UkTaxProfile {
  taxCode: string; // e.g. 1257L, BR, 0T, D0, D1, K475
  taxBasis: 'CUMULATIVE' | 'WEEK1MONTH1';
  niCategory: string; // e.g. "A"
  pension: { kind: 'QUALIFYING_EARNINGS' | 'WHOLE_PAY'; employeePercent: number } | null;
  studentLoan: string | null; // key into config.studentLoans
}

export interface YtdAnchor {
  grossPence: number;
  taxPence: number;
  /** Where the anchor came from — cited in the explanation tree. */
  source: string;
}

export interface UkStatutoryInput {
  periodGrossPence: number;
  /** 1-based statutory period index within the tax year (by payment date). */
  periodIndex: number;
  periodsPerYear: 26 | 52 | 12;
  profile: UkTaxProfile | null;
  config: UkStatutoryConfig;
  /** YTD BEFORE this period. Null = no prior pay this year. */
  ytdAnchor: YtdAnchor | null;
}

export interface UkStatutoryResult {
  taxPence: number;
  niPence: number;
  pensionPence: number;
  studentLoanPence: number;
  netPence: number;
  explanation: ExplanationNode;
}

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

interface ParsedTaxCode {
  kind: 'ALLOWANCE' | 'K' | 'BR' | 'D0' | 'D1' | 'NT';
  annualAllowancePence: number; // negative for K codes
  flatBandName?: string;
  note?: string;
}

export function parseTaxCode(code: string): ParsedTaxCode {
  const upper = code.trim().toUpperCase();
  if (upper === 'BR') return { kind: 'BR', annualAllowancePence: 0, flatBandName: 'basic' };
  if (upper === 'D0') return { kind: 'D0', annualAllowancePence: 0, flatBandName: 'higher' };
  if (upper === 'D1') return { kind: 'D1', annualAllowancePence: 0, flatBandName: 'additional' };
  if (upper === 'NT') return { kind: 'NT', annualAllowancePence: 0 };
  if (upper === '0T') return { kind: 'ALLOWANCE', annualAllowancePence: 0 };
  const k = /^K(\d+)$/.exec(upper);
  if (k) return { kind: 'K', annualAllowancePence: -Number(k[1]) * 1000 };
  const std = /^(\d+)[LMN]$/.exec(upper);
  if (std) return { kind: 'ALLOWANCE', annualAllowancePence: Number(std[1]) * 1000 };
  // Unknown code: safest estimate is zero allowance, flagged loudly.
  return {
    kind: 'ALLOWANCE',
    annualAllowancePence: 0,
    note: `tax code “${code}” not recognised — estimated with no allowance (0T)`,
  };
}

/** Cumulative banded tax due on `taxablePence` with bands apportioned `fraction` of the year. */
function bandedTax(
  taxablePence: number,
  bands: UkStatutoryConfig['incomeTax']['bands'],
  fraction: number,
  nodes: ExplanationNode[]
): number {
  let remaining = taxablePence;
  let lowerBound = 0;
  let tax = 0;
  for (const band of bands) {
    if (remaining <= 0) break;
    const upper = band.upToPence === null ? Number.POSITIVE_INFINITY : band.upToPence * fraction;
    const width = upper - lowerBound;
    const slice = Math.min(remaining, width);
    if (slice > 0) {
      const due = roundToInt((slice * band.ratePercent) / 100, 'HALF_UP');
      tax += due;
      nodes.push({
        label: `${band.name} rate (${band.ratePercent.toString()}%)`,
        amountPence: due,
        detail: `${pounds(slice)} taxed at ${band.ratePercent.toString()}%`,
      });
      remaining -= slice;
    }
    lowerBound = upper;
  }
  return tax;
}

function computePaye(
  input: UkStatutoryInput,
  profile: UkTaxProfile
): { taxPence: number; node: ExplanationNode } {
  const { config, periodIndex, periodsPerYear, periodGrossPence } = input;
  const code = parseTaxCode(profile.taxCode);
  const children: ExplanationNode[] = [];
  if (code.note) children.push({ label: '⚠ ' + code.note });

  if (code.kind === 'NT') {
    return {
      taxPence: 0,
      node: { label: 'PAYE income tax (code NT — no tax)', amountPence: 0, children },
    };
  }

  if (code.flatBandName) {
    const band = config.incomeTax.bands.find((b) => b.name === code.flatBandName);
    const rate = band?.ratePercent ?? 20;
    const tax = roundToInt((periodGrossPence * rate) / 100, 'HALF_UP');
    return {
      taxPence: tax,
      node: {
        label: `PAYE income tax (code ${profile.taxCode} — flat ${rate.toString()}%)`,
        amountPence: tax,
        detail: `${pounds(periodGrossPence)} × ${rate.toString()}%`,
        children,
      },
    };
  }

  const anchor = input.ytdAnchor ?? {
    grossPence: 0,
    taxPence: 0,
    source: 'no prior pay this tax year',
  };

  if (profile.taxBasis === 'WEEK1MONTH1') {
    const periodAllowance = roundToInt(code.annualAllowancePence / periodsPerYear, 'FLOOR');
    const taxable = Math.max(0, periodGrossPence - periodAllowance);
    const tax = bandedTax(taxable, config.incomeTax.bands, 1 / periodsPerYear, children);
    return {
      taxPence: tax,
      node: {
        label: `PAYE income tax (code ${profile.taxCode}, week1/month1)`,
        amountPence: tax,
        detail: `taxable this period: ${pounds(periodGrossPence)} − allowance ${pounds(periodAllowance)} = ${pounds(taxable)}`,
        children,
      },
    };
  }

  // Cumulative basis: tax due to date minus tax already paid (per the anchor).
  const fraction = periodIndex / periodsPerYear;
  const grossYtd = anchor.grossPence + periodGrossPence;
  const allowanceToDate = roundToInt(code.annualAllowancePence * fraction, 'FLOOR');
  const taxableYtd = Math.max(0, grossYtd - allowanceToDate);
  const bandNodes: ExplanationNode[] = [];
  const taxYtdDue = bandedTax(taxableYtd, config.incomeTax.bands, fraction, bandNodes);
  const tax = taxYtdDue - anchor.taxPence;
  children.push(
    {
      label: 'Year-to-date position',
      detail: `gross to date ${pounds(grossYtd)} − allowance to date ${pounds(allowanceToDate)} (period ${periodIndex.toString()}/${periodsPerYear.toString()}) = taxable ${pounds(taxableYtd)}; anchor: ${anchor.source}`,
    },
    ...bandNodes,
    {
      label: 'Less tax already paid this year',
      amountPence: -anchor.taxPence,
      detail: anchor.source,
    }
  );
  return {
    taxPence: tax,
    node: {
      label: `PAYE income tax (code ${profile.taxCode}, cumulative)`,
      amountPence: tax,
      children,
    },
  };
}

function computeNi(
  input: UkStatutoryInput,
  profile: UkTaxProfile
): { niPence: number; node: ExplanationNode } {
  const ni = input.config.nationalInsurance.employee;
  const category = ni.categories[profile.niCategory] ?? {
    mainRatePercent: ni.mainRatePercent,
    upperRatePercent: ni.upperRatePercent,
  };
  const weeks = 52 / input.periodsPerYear;
  const pt = ni.weeklyPrimaryThresholdPence * weeks;
  const uel = ni.weeklyUpperEarningsLimitPence * weeks;
  const gross = input.periodGrossPence;
  const mainSlice = Math.max(0, Math.min(gross, uel) - pt);
  const upperSlice = Math.max(0, gross - uel);
  const main = roundToInt((mainSlice * category.mainRatePercent) / 100, 'HALF_UP');
  const upper = roundToInt((upperSlice * category.upperRatePercent) / 100, 'HALF_UP');
  return {
    niPence: main + upper,
    node: {
      label: `National Insurance (category ${profile.niCategory}, per-period)`,
      amountPence: main + upper,
      children: [
        {
          label: `Main rate ${category.mainRatePercent.toString()}%`,
          amountPence: main,
          detail: `${pounds(mainSlice)} between PT ${pounds(pt)} and UEL ${pounds(uel)}`,
        },
        ...(upperSlice > 0
          ? [
              {
                label: `Upper rate ${category.upperRatePercent.toString()}%`,
                amountPence: upper,
                detail: `${pounds(upperSlice)} above UEL`,
              },
            ]
          : []),
      ],
    },
  };
}

function computePension(
  input: UkStatutoryInput,
  profile: UkTaxProfile
): { pensionPence: number; node: ExplanationNode } {
  if (!profile.pension) {
    return {
      pensionPence: 0,
      node: { label: 'Pension — not enrolled', amountPence: 0 },
    };
  }
  const cfg = input.config.pensionAutoEnrolment;
  const gross = input.periodGrossPence;
  let base = gross;
  let detail = `whole pay ${pounds(gross)}`;
  if (profile.pension.kind === 'QUALIFYING_EARNINGS') {
    const lower = cfg.qualifyingLowerAnnualPence / input.periodsPerYear;
    const upper = cfg.qualifyingUpperAnnualPence / input.periodsPerYear;
    base = Math.max(0, Math.min(gross, upper) - lower);
    detail = `qualifying earnings between ${pounds(roundToInt(lower, 'HALF_UP'))} and ${pounds(roundToInt(upper, 'HALF_UP'))}: ${pounds(roundToInt(base, 'HALF_UP'))}`;
  }
  const pence = roundToInt((base * profile.pension.employeePercent) / 100, 'HALF_UP');
  return {
    pensionPence: pence,
    node: {
      label: `Pension (${profile.pension.employeePercent.toString()}% employee)`,
      amountPence: pence,
      detail,
    },
  };
}

function computeStudentLoan(
  input: UkStatutoryInput,
  profile: UkTaxProfile
): { studentLoanPence: number; node: ExplanationNode } {
  if (!profile.studentLoan) {
    return { studentLoanPence: 0, node: { label: 'Student loan — none', amountPence: 0 } };
  }
  const plan = input.config.studentLoans[profile.studentLoan];
  if (!plan) {
    return {
      studentLoanPence: 0,
      node: { label: `⚠ Student loan plan “${profile.studentLoan}” unknown — estimated £0` },
    };
  }
  const threshold = plan.annualThresholdPence / input.periodsPerYear;
  const excess = Math.max(0, input.periodGrossPence - threshold);
  // HMRC computes student loans in whole pounds, dropping pence.
  const pence = Math.floor((excess * plan.ratePercent) / 100 / 100) * 100;
  return {
    studentLoanPence: pence,
    node: {
      label: `Student loan (${profile.studentLoan}, ${plan.ratePercent.toString()}%)`,
      amountPence: pence,
      detail: `${pounds(excess)} above the ${pounds(roundToInt(threshold, 'HALF_UP'))} period threshold, floored to whole pounds`,
    },
  };
}

export function calculateUkStatutory(input: UkStatutoryInput): UkStatutoryResult {
  if (!input.profile) {
    return {
      taxPence: 0,
      niPence: 0,
      pensionPence: 0,
      studentLoanPence: 0,
      netPence: input.periodGrossPence,
      explanation: {
        label: 'Statutory deductions — estimated £0',
        amountPence: 0,
        detail:
          'No tax profile configured: deductions cannot be estimated, so net = gross. Add your tax code in Settings for PAYE/NI/pension estimates.',
      },
    };
  }
  const paye = computePaye(input, input.profile);
  const ni = computeNi(input, input.profile);
  const pension = computePension(input, input.profile);
  const loan = computeStudentLoan(input, input.profile);
  const total = paye.taxPence + ni.niPence + pension.pensionPence + loan.studentLoanPence;
  return {
    taxPence: paye.taxPence,
    niPence: ni.niPence,
    pensionPence: pension.pensionPence,
    studentLoanPence: loan.studentLoanPence,
    netPence: input.periodGrossPence - total,
    explanation: {
      label: 'Statutory deductions (estimates — not tax advice)',
      amountPence: total,
      children: [paye.node, ni.node, pension.node, loan.node],
    },
  };
}
