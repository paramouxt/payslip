import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { createPayslipAction } from '@/app/actions/payslips';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

export const metadata = { title: 'Add payslip' };
export const dynamic = 'force-dynamic';

const MONEY_FIELDS = [
  ['gross', 'Gross pay', true],
  ['tax', 'Income tax (PAYE)', false],
  ['ni', 'National Insurance', false],
  ['pension', 'Pension', false],
  ['net', 'Net pay', true],
] as const;

export default async function NewPayslipPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const employers = await repos.employers.list();
  const employer = employers[0] ?? null;
  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Add payslip</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              {error}
            </p>
          )}
          {!employer ? (
            <p className="text-sm text-muted-foreground">Add an employer first (Dashboard).</p>
          ) : (
            <form action={createPayslipAction} className="flex flex-col gap-4">
              <input type="hidden" name="employerId" value={employer.id} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payDate">Pay date (as printed)</Label>
                <Input id="payDate" name="payDate" type="date" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {MONEY_FIELDS.map(([name, label, required]) => (
                  <div key={name} className="flex flex-col gap-1.5">
                    <Label htmlFor={name}>{label}</Label>
                    <Input
                      id={name}
                      name={name}
                      inputMode="decimal"
                      placeholder="0.00"
                      required={required}
                    />
                  </div>
                ))}
              </div>
              <fieldset className="flex flex-col gap-3 rounded-md border p-3">
                <legend className="px-1 text-xs text-muted-foreground">
                  Year-to-date figures (from the payslip — anchors the tax estimates)
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ytdGross">YTD gross</Label>
                    <Input id="ytdGross" name="ytdGross" inputMode="decimal" placeholder="0.00" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ytdTax">YTD tax</Label>
                    <Input id="ytdTax" name="ytdTax" inputMode="decimal" placeholder="0.00" />
                  </div>
                </div>
              </fieldset>
              <Button type="submit">Save & reconcile</Button>
              <p className="text-xs text-muted-foreground">
                Amounts in pounds, e.g. 622.40. The payslip is matched to its payroll period by pay
                date and reconciled immediately.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
