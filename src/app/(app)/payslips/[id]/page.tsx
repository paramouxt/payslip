import { notFound } from 'next/navigation';
import { z } from 'zod';
import { explanationNodeSchema } from '@/core/payroll/explanation';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { ExplanationTree } from '@/components/payroll/explanation-tree';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatPence } from '@/lib/utils';

export const metadata = { title: 'Payslip reconciliation' };
export const dynamic = 'force-dynamic';

const linesSchema = z.object({
  gross: explanationNodeSchema,
  statutory: explanationNodeSchema,
});

export default async function PayslipDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const payslip = await repos.payslips.getById(id);
  if (!payslip) notFound();

  const expected = payslip.payrollPeriodId
    ? await repos.expectedPay.currentForPeriod(payslip.payrollPeriodId)
    : null;
  const discrepancies = payslip.payrollPeriodId
    ? (await repos.discrepancies.list()).filter(
        (d) => d.payrollPeriodId === payslip.payrollPeriodId
      )
    : [];
  const lines = expected ? linesSchema.safeParse(expected.lines) : null;

  const rows = [
    ['Gross pay', expected?.grossPence, payslip.grossPence],
    ['Income tax', expected?.taxPence, payslip.taxPence],
    ['National Insurance', expected?.niPence, payslip.niPence],
    ['Pension & loans', expected?.pensionPence, payslip.pensionPence],
    ['Net pay', expected?.netPence, payslip.netPence],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Payslip · <time dateTime={payslip.payDate}>{payslip.payDate}</time>
        </h1>
        <p className="text-sm text-muted-foreground">
          {payslip.payrollPeriodId
            ? 'Matched to its payroll period and reconciled against expectation.'
            : 'Not matched to a payroll period — the pay date does not line up with the employer’s scheme.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expected vs actual</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Line</TH>
                  <TH className="text-right">Expected</TH>
                  <TH className="text-right">Payslip</TH>
                  <TH className="text-right">Δ</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(([label, exp, act]) => {
                  const delta = exp !== undefined ? act - exp : null;
                  return (
                    <TR key={label}>
                      <TD>{label}</TD>
                      <TD className="tnum text-right">
                        {exp !== undefined ? formatPence(exp) : '—'}
                      </TD>
                      <TD className="tnum text-right">{formatPence(act)}</TD>
                      <TD
                        className={`tnum text-right ${
                          delta === null || delta === 0
                            ? 'text-muted-foreground'
                            : delta < 0
                              ? 'text-destructive'
                              : 'text-success'
                        }`}
                      >
                        {delta === null
                          ? '—'
                          : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatPence(Math.abs(delta))}`}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discrepancies ({discrepancies.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {discrepancies.length === 0 ? (
              <p className="text-sm text-success">
                {expected
                  ? 'No discrepancies — payslip matches expectation. ✓'
                  : 'No expectation computed yet.'}
              </p>
            ) : (
              discrepancies.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <p className="text-sm">{d.summary}</p>
                  <Badge
                    variant={
                      d.severity === 'MAJOR'
                        ? 'destructive'
                        : d.severity === 'MINOR'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {d.severity}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {lines?.success && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Explain the expected gross</CardTitle>
            </CardHeader>
            <CardContent>
              <ExplanationTree node={lines.data.gross} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Explain the deductions</CardTitle>
            </CardHeader>
            <CardContent>
              <ExplanationTree node={lines.data.statutory} />
              {expected && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Computed by engine {expected.engineVersion}
                  {expected.ruleSetVersion !== null &&
                    `, rule set v${expected.ruleSetVersion.toString()}`}{' '}
                  at {expected.computedAt.toLocaleString('en-GB')}. Estimates, not tax advice.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
