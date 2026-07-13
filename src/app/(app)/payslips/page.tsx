import Link from 'next/link';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatPence } from '@/lib/utils';

export const metadata = { title: 'Payslips' };
export const dynamic = 'force-dynamic';

export default async function PayslipsPage() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const payslips = await repos.payslips.list();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Payslips</h1>
          <p className="text-sm text-muted-foreground">
            Each payslip is reconciled line-by-line against what your rota implied you'd earn.
          </p>
        </div>
        <Link href="/payslips/new" className={buttonVariants({})}>
          Add payslip
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Pay date</TH>
                <TH>Gross</TH>
                <TH>Net</TH>
                <TH>Period</TH>
                <TH className="text-right">Verification</TH>
              </TR>
            </THead>
            <TBody>
              {payslips.length === 0 && (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-muted-foreground">
                    No payslips yet. Add one manually — the payslip parser arrives once a real
                    sample exists.
                  </TD>
                </TR>
              )}
              {payslips.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/payslips/${p.id}`} className="font-medium hover:underline">
                      <time dateTime={p.payDate}>{p.payDate}</time>
                    </Link>
                  </TD>
                  <TD className="tnum">{formatPence(p.grossPence)}</TD>
                  <TD className="tnum">{formatPence(p.netPence)}</TD>
                  <TD>
                    {p.payrollPeriodId ? (
                      <Badge variant="success">matched</Badge>
                    ) : (
                      <Badge variant="warning">unmatched</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    <Link
                      href={`/payslips/${p.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      View reconciliation →
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
