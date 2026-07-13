import { describe, expect, it } from 'vitest';
import { reconcileTotals, type PayTotals } from './reconcile';

const expected: PayTotals = {
  grossPence: 124_480,
  taxPence: 10_000,
  niPence: 5_000,
  pensionPence: 0,
  netPence: 109_480,
};

describe('reconcileTotals', () => {
  it('reports nothing when the payslip matches to the penny', () => {
    expect(reconcileTotals(expected, { ...expected })).toEqual([]);
  });

  it('classifies penny noise as ROUNDING/INFO, real gaps by size', () => {
    const drafts = reconcileTotals(expected, {
      ...expected,
      grossPence: expected.grossPence - 1, // 1p — rounding
      taxPence: expected.taxPence + 300, // £3 — minor
      netPence: expected.netPence - 15_560, // £155.60 — major (a missing shift)
    });
    const byKind = Object.fromEntries(drafts.map((d) => [d.kind, d]));
    expect(byKind.ROUNDING).toMatchObject({ severity: 'INFO', deltaPence: -1 });
    expect(byKind.DEDUCTION_MISMATCH).toMatchObject({ severity: 'MINOR', deltaPence: 300 });
    expect(byKind.NET_MISMATCH).toMatchObject({ severity: 'MAJOR', deltaPence: -15_560 });
    expect(byKind.NET_MISMATCH!.summary).toContain('£155.60');
  });

  it('deltas are signed: underpayment negative, overpayment positive', () => {
    const under = reconcileTotals(expected, { ...expected, netPence: expected.netPence - 500 });
    expect(under[0]!.deltaPence).toBe(-500);
    const over = reconcileTotals(expected, { ...expected, netPence: expected.netPence + 500 });
    expect(over[0]!.deltaPence).toBe(500);
  });
});
