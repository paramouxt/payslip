import { fromUtcInstant } from '@/core/dates/iso-date';
import { ukTaxYearOf } from '@/core/statutory/uk/tax-year';
import { env } from '@/lib/env';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { createMailboxService } from '@/server/services/mailbox-service';
import { createMailboxConnectionAction, rotateMailboxKeyAction } from '@/app/actions/mailbox';
import { saveTaxProfileAction } from '@/app/actions/payslips';
import { PushSubscribe } from '@/features/push/push-subscribe';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const STUDENT_LOAN_PLANS = ['PLAN_1', 'PLAN_2', 'PLAN_4', 'PLAN_5', 'POSTGRAD'];

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const mailboxService = createMailboxService(repos);
  const { taxYear } = ukTaxYearOf(fromUtcInstant(new Date()));
  const [employers, connections, quarantined, taxProfile] = await Promise.all([
    repos.employers.list(),
    repos.mailboxConnections.list(),
    repos.emailMessages.countByStatus('QUARANTINED'),
    repos.taxProfiles.get('GB', taxYear),
  ]);
  const pension = taxProfile?.pension as { employeePercent?: number } | null | undefined;
  const appUrl = env.AUTH_URL ?? 'http://localhost:3000';

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Signed in as {tenant.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Employers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {employers.length === 0 && (
            <p className="text-sm text-muted-foreground">None yet — onboard from the Dashboard.</p>
          )}
          {employers.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{e.name}</p>
                <p className="text-xs text-muted-foreground">
                  {e.slug} · {e.currency} · {e.jurisdiction}
                </p>
              </div>
              <Badge variant="success">configured</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mailbox connections — zero-credential ingestion</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            ShiftSync never holds your Gmail credentials. A small Apps Script in <em>your</em>{' '}
            Google account pushes matching emails here, signed with a key that exists only in the
            script and in this page.
          </p>
          {connections.map((connection) => {
            const material = mailboxService.describeForOwner(connection, appUrl);
            return (
              <div key={connection.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{connection.label}</p>
                    <p className="text-xs text-muted-foreground">
                      key v{connection.activeKeyVersion} · last event:{' '}
                      {connection.lastEventAt
                        ? connection.lastEventAt.toLocaleString('en-GB')
                        : 'never'}
                    </p>
                  </div>
                  <form action={rotateMailboxKeyAction}>
                    <input type="hidden" name="connectionId" value={connection.id} />
                    <Button variant="outline" size="sm" type="submit">
                      Rotate key
                    </Button>
                  </form>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-primary">
                    Setup instructions & forwarder script
                  </summary>
                  <div className="mt-2 flex flex-col gap-2 text-xs">
                    <p>
                      1. Open <code>script.google.com</code> in the Google account that receives
                      your rotas → New project. 2. Paste the script below. 3. Run{' '}
                      <code>setup()</code> once and grant access. Done — it checks every minute.
                    </p>
                    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-4">
                      {material.script}
                    </pre>
                  </div>
                </details>
              </div>
            );
          })}
          <form action={createMailboxConnectionAction} className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" placeholder="Rota Gmail" required />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="emailAddress">Mailbox (optional)</Label>
              <Input
                id="emailAddress"
                name="emailAddress"
                type="email"
                placeholder="you@gmail.com"
              />
            </div>
            <Button type="submit">Connect mailbox</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax profile — {taxYear} (estimates, not tax advice)</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveTaxProfileAction} className="grid grid-cols-2 gap-3">
            <input type="hidden" name="taxYear" value={taxYear} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="taxCode">Tax code</Label>
              <Input
                id="taxCode"
                name="taxCode"
                placeholder="1257L"
                defaultValue={taxProfile?.taxCode ?? ''}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="taxBasis">Basis</Label>
              <Select
                id="taxBasis"
                name="taxBasis"
                defaultValue={taxProfile?.taxBasis ?? 'CUMULATIVE'}
              >
                <option value="CUMULATIVE">Cumulative (normal)</option>
                <option value="WEEK1MONTH1">Week 1 / Month 1</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="niCategory">NI category</Label>
              <Input
                id="niCategory"
                name="niCategory"
                placeholder="A"
                defaultValue={taxProfile?.niCategory ?? 'A'}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="studentLoan">Student loan</Label>
              <Select
                id="studentLoan"
                name="studentLoan"
                defaultValue={taxProfile?.studentLoan ?? ''}
              >
                <option value="">None</option>
                {STUDENT_LOAN_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                id="pensionEnrolled"
                name="pensionEnrolled"
                type="checkbox"
                defaultChecked={pension != null}
                className="size-4"
              />
              <Label htmlFor="pensionEnrolled">Pension enrolled</Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pensionPercent">Employee %</Label>
              <Input
                id="pensionPercent"
                name="pensionPercent"
                inputMode="decimal"
                defaultValue={pension?.employeePercent?.toString() ?? '5'}
              />
            </div>
            <div className="col-span-2">
              <Button type="submit">Save tax profile</Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Without a profile, deductions are estimated at £0 and the dashboard says so. Estimates
            are re-anchored to the YTD figures on every payslip you add.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Rota changes, payslips, and discrepancies arrive in-app; enable Web Push to get them on
            this device too — always with the payroll impact, not just the fact.
          </p>
          <PushSubscribe />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span>Quarantined emails</span>
            <Badge variant={quarantined > 0 ? 'warning' : 'success'}>{quarantined}</Badge>
          </div>
          <div className="flex justify-between">
            <span>Mailbox connections</span>
            <Badge variant={connections.length > 0 ? 'success' : 'default'}>
              {connections.length}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The daily cron keeps the database awake, sweeps for missed mail, and flags silent
            forwarders here and by notification.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
