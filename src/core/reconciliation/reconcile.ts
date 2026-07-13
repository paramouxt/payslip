import type { ExplanationNode } from '../payroll/explanation';

/**
 * Expected-vs-actual reconciliation (the product's wedge). v1 compares the
 * five headline totals; line-level comparison arrives with the payslip
 * parser. The tolerance model keeps penny noise from drowning real signal
 * (Phase 3 §5): |Δ| ≤ roundingTolerance ⇒ INFO/ROUNDING.
 */
export interface PayTotals {
  grossPence: number;
  taxPence: number;
  niPence: number;
  pensionPence: number;
  netPence: number;
}

export interface DiscrepancyDraft {
  kind:
    | 'HOURS_MISMATCH'
    | 'RATE_MISMATCH'
    | 'DEDUCTION_MISMATCH'
    | 'NET_MISMATCH'
    | 'ROUNDING'
    | 'OTHER';
  severity: 'INFO' | 'MINOR' | 'MAJOR';
  expectedPence: number;
  actualPence: number;
  deltaPence: number;
  summary: string;
}

export interface ToleranceConfig {
  roundingTolerancePence: number; // ≤ this ⇒ ROUNDING/INFO
  minorThresholdPence: number; // ≤ this ⇒ MINOR, above ⇒ MAJOR
}

export const DEFAULT_TOLERANCE: ToleranceConfig = {
  roundingTolerancePence: 2,
  minorThresholdPence: 500,
};

function pounds(pence: number): string {
  return `£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function compareLine(
  label: string,
  kind: DiscrepancyDraft['kind'],
  expected: number,
  actual: number,
  tolerance: ToleranceConfig
): DiscrepancyDraft | null {
  const delta = actual - expected;
  if (delta === 0) return null;
  const abs = Math.abs(delta);
  const severity: DiscrepancyDraft['severity'] =
    abs <= tolerance.roundingTolerancePence
      ? 'INFO'
      : abs <= tolerance.minorThresholdPence
        ? 'MINOR'
        : 'MAJOR';
  return {
    kind: abs <= tolerance.roundingTolerancePence ? 'ROUNDING' : kind,
    severity,
    expectedPence: expected,
    actualPence: actual,
    deltaPence: delta,
    summary: `${label}: expected ${pounds(expected)}, payslip shows ${pounds(actual)} (${delta > 0 ? '+' : '−'}${pounds(delta)})`,
  };
}

export function reconcileTotals(
  expected: PayTotals,
  actual: PayTotals,
  tolerance: ToleranceConfig = DEFAULT_TOLERANCE
): DiscrepancyDraft[] {
  const drafts = [
    compareLine('Gross pay', 'HOURS_MISMATCH', expected.grossPence, actual.grossPence, tolerance),
    compareLine('Income tax', 'DEDUCTION_MISMATCH', expected.taxPence, actual.taxPence, tolerance),
    compareLine(
      'National Insurance',
      'DEDUCTION_MISMATCH',
      expected.niPence,
      actual.niPence,
      tolerance
    ),
    compareLine(
      'Pension',
      'DEDUCTION_MISMATCH',
      expected.pensionPence,
      actual.pensionPence,
      tolerance
    ),
    compareLine('Net pay', 'NET_MISMATCH', expected.netPence, actual.netPence, tolerance),
  ];
  return drafts.filter((d): d is DiscrepancyDraft => d !== null);
}

export function reconciliationExplanation(drafts: DiscrepancyDraft[]): ExplanationNode {
  return {
    label:
      drafts.length === 0 ? 'Payslip matches expectation ✓' : 'Payslip differs from expectation',
    children: drafts.map((d) => ({
      label: d.summary,
      amountPence: d.deltaPence,
    })),
  };
}
