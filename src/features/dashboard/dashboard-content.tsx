import Link from 'next/link';
import { addDays, fromUtcInstant, isoDate } from '@/core/dates/iso-date';
import { resolvePeriodFor, type PeriodSpan } from '@/core/domain/payroll-period/scheme';
import { zonedTimeOf } from '@/core/dates/zoned';
import { requireTenant } from '@/server/auth/session';
import { getPayrollService } from '@/server/container';
import { prisma } from '@/server/db';
import { createForecastService } from '@/server/services/forecast-service';
import { createTenantRepositories } from '@/server/repositories';
import { EarningsChart, type PeriodEarnings } from './earnings-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatHours, formatPence } from '@/lib/utils';

function shortSpan(span: PeriodSpan): string {
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return `${fmt(span.startDate)}–${fmt(span.endDate)}`;
}

export async function DashboardContent() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const employers = await repos.employers.list();
  const employer = employers[0];
  if (!employer) return null;
  const loaded = await repos.employers.getConfig(employer.id);
  if (!loaded) return null;

  const today = fromUtcInstant(new Date());
  let span: PeriodSpan | null = null;
  try {
    span = resolvePeriodFor(loaded.config.payPeriodScheme, today);
  } catch {
    span = null;
  }

  // Current period: self-healing — compute the projection if it's missing.
  let expected = null;
  let periodShiftsHours = 0;
  if (span) {
    const period = await repos.payrollPeriods.ensure(employer.id, span);
    expected = await repos.expectedPay.currentForPeriod(period.id);
    const periodShifts = (
      await repos.shifts.listBetween(span.startDate, span.endDate, { employerId: employer.id })
    ).filter((s) => s.status !== 'CANCELLED');
    periodShiftsHours = periodShifts.reduce((a, s) => a + s.scheduledHours, 0);
    if (!expected && periodShifts.length > 0) {
      await getPayrollService().recomputePeriod(tenant, employer.id, period);
      expected = await repos.expectedPay.currentForPeriod(period.id);
    }
  }

  const monthStart = isoDate(`${today.slice(0, 7)}-01`);
  const monthShifts = (
    await repos.shifts.listBetween(monthStart, addDays(monthStart, 31), {
      employerId: employer.id,
    })
  ).filter((s) => s.status !== 'CANCELLED' && s.snapshot.date.slice(0, 7) === today.slice(0, 7));
  const monthHours = monthShifts.reduce((a, s) => a + s.scheduledHours, 0);

  const upcoming = (await repos.shifts.listBetween(today, addDays(today, 14))).filter(
    (s) => s.status !== 'CANCELLED'
  );
  const recentEvents = await repos.shifts.listRecentEvents(5);
  const openDiscrepancies = await repos.discrepancies.list({ status: 'OPEN' });
  const forecast = await createForecastService(prisma).taxYearForecast(tenant, employer.id, today);

  // Chart: the last up-to-6 periods with an expectation or payslip.
  const chartData: PeriodEarnings[] = [];
  if (span) {
    let cursor = span;
    const spans: PeriodSpan[] = [cursor];
    for (let i = 0; i < 5; i++) {
      try {
        cursor = resolvePeriodFor(loaded.config.payPeriodScheme, addDays(cursor.startDate, -1));
        spans.unshift(cursor);
      } catch {
        break;
      }
    }
    for (const s of spans) {
      const period = await repos.payrollPeriods.ensure(employer.id, s);
      const exp = await repos.expectedPay.currentForPeriod(period.id);
      const slip = await repos.payslips.forPeriod(period.id);
      if (exp || slip) {
        chartData.push({
          label: shortSpan(s),
          expectedPence: exp?.grossPence ?? null,
          actualPence: slip?.grossPence ?? null,
        });
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>This fortnight {span ? `· ${shortSpan(span)}` : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tnum text-2xl font-semibold">
              {expected ? formatPence(expected.grossPence) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatHours(periodShiftsHours)} scheduled
              {span && ` · payday ${span.payDate}`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Estimated net (this period)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tnum text-2xl font-semibold">
              {expected ? formatPence(expected.netPence) : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {expected
                ? `PAYE ${formatPence(expected.taxPence)} · NI ${formatPence(expected.niPence)} · pension/loan ${formatPence(expected.pensionPence)}`
                : 'No shifts computed yet'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>This month</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tnum text-2xl font-semibold">{formatHours(monthHours)}</p>
            <p className="text-xs text-muted-foreground">
              {monthShifts.length.toString()} shift(s)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Verification</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tnum text-2xl font-semibold">{openDiscrepancies.length}</p>
            <p className="text-xs text-muted-foreground">
              open discrepancies ·{' '}
              <Link href="/discrepancies" className="text-primary hover:underline">
                review
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Earnings by pay period</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No computed periods yet — add shifts (or connect your mailbox) and this fills in.
              </p>
            ) : (
              <EarningsChart data={chartData} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tax year forecast {forecast ? `· ${forecast.taxYear}` : ''}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            {!forecast ? (
              <p className="text-muted-foreground">Unavailable.</p>
            ) : (
              <>
                <p className="tnum text-2xl font-semibold">
                  {formatPence(forecast.totalGrossPence)}
                </p>
                <p className="text-xs text-muted-foreground">
                  est. tax & NI {formatPence(forecast.estimatedTaxPence)} → net{' '}
                  {formatPence(forecast.estimatedNetPence)}
                </p>
                <dl className="mt-2 grid gap-1 text-xs">
                  <div className="flex justify-between">
                    <dt>Payslip-backed</dt>
                    <dd className="tnum">{formatPence(forecast.actualPence)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Scheduled (engine)</dt>
                    <dd className="tnum">{formatPence(forecast.scheduledPence)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Projected (assumption)</dt>
                    <dd className="tnum">{formatPence(forecast.projectedPence)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  {forecast.assumptions.join(' ')}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming shifts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing scheduled in the next 14 days.
              </p>
            )}
            {upcoming.slice(0, 5).map((shift) => {
              const s = shift.snapshot;
              return (
                <Link
                  key={shift.id}
                  href={`/shifts/${shift.id}`}
                  className="flex items-center justify-between rounded-md border p-2.5 text-sm hover:bg-muted/50"
                >
                  <span>
                    <time dateTime={s.date}>{s.date}</time> · {zonedTimeOf(s.startAt, s.timezone)}–
                    {zonedTimeOf(s.endAt, s.timezone)}
                  </span>
                  <span className="text-muted-foreground">{s.venue ?? ''}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent changes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentEvents.length === 0 && (
              <p className="text-sm text-muted-foreground">No shift history yet.</p>
            )}
            {recentEvents.map((event) => (
              <Link
                key={`${event.shiftId}-${event.seq.toString()}`}
                href={`/shifts/${event.shiftId}`}
                className="flex items-center justify-between rounded-md border p-2.5 text-sm hover:bg-muted/50"
              >
                <span>
                  <Badge
                    variant={
                      event.kind === 'CANCELLED'
                        ? 'destructive'
                        : event.kind === 'CREATED'
                          ? 'primary'
                          : 'warning'
                    }
                  >
                    {event.kind}
                  </Badge>{' '}
                  <time dateTime={event.shiftDate} className="ml-1">
                    {event.shiftDate}
                  </time>
                </span>
                <span className="text-xs text-muted-foreground">
                  {event.sourceEmailId ? 'from email' : (event.actor ?? '')}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
