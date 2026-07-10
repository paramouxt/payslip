import Link from 'next/link';
import { addDays, fromUtcInstant } from '@/core/dates/iso-date';
import { zonedTimeOf } from '@/core/dates/zoned';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatHours } from '@/lib/utils';

export const metadata = { title: 'Shifts' };
export const dynamic = 'force-dynamic';

const STATUS_VARIANT = {
  SCHEDULED: 'primary',
  AMENDED: 'warning',
  CANCELLED: 'destructive',
  COMPLETED: 'success',
} as const;

export default async function ShiftsPage() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const today = fromUtcInstant(new Date());
  const from = addDays(today, -60);
  const to = addDays(today, 90);
  const shifts = await repos.shifts.listBetween(from, to);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Shifts</h1>
          <p className="text-sm text-muted-foreground">
            {from} → {to} · {shifts.length} shifts · every change is versioned with its evidence
          </p>
        </div>
        <Link href="/shifts/new" className={buttonVariants({})}>
          Add shift
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Time</TH>
                <TH>Hours</TH>
                <TH>Venue</TH>
                <TH>Status</TH>
                <TH>v</TH>
              </TR>
            </THead>
            <TBody>
              {shifts.length === 0 && (
                <TR>
                  <TD colSpan={6} className="py-8 text-center text-muted-foreground">
                    No shifts in this window yet — add one manually or connect your mailbox in
                    Settings.
                  </TD>
                </TR>
              )}
              {shifts.map((shift) => {
                const s = shift.snapshot;
                return (
                  <TR key={shift.id}>
                    <TD className="whitespace-nowrap">
                      <Link href={`/shifts/${shift.id}`} className="font-medium hover:underline">
                        <time dateTime={s.date}>{s.date}</time>
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap tnum">
                      {zonedTimeOf(s.startAt, s.timezone)}–{zonedTimeOf(s.endAt, s.timezone)}
                    </TD>
                    <TD className="tnum">{formatHours(shift.scheduledHours)}</TD>
                    <TD className="max-w-48 truncate">{s.venue ?? '—'}</TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                    </TD>
                    <TD className="tnum text-muted-foreground">{shift.version}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
