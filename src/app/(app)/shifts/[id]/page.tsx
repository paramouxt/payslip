import { notFound } from 'next/navigation';
import { zonedTimeOf } from '@/core/dates/zoned';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import {
  cancelShiftAction,
  reinstateShiftAction,
  setShiftOverrideAction,
} from '@/app/actions/shifts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { formatHours } from '@/lib/utils';
import { displayValue } from '@/lib/strings';

export const metadata = { title: 'Shift' };
export const dynamic = 'force-dynamic';

export default async function ShiftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const loaded = await repos.shifts.getWithHistory(id);
  if (!loaded) notFound();
  const { shift, events } = loaded;
  const s = shift.snapshot;
  const config = await repos.employers.getConfig(shift.employerId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <time dateTime={s.date}>{s.date}</time> · {zonedTimeOf(s.startAt, s.timezone)}–
            {zonedTimeOf(s.endAt, s.timezone)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {s.venue ?? 'No venue'} · {formatHours(shift.scheduledHours)} ·{' '}
            <Badge
              variant={
                s.status === 'CANCELLED'
                  ? 'destructive'
                  : s.status === 'AMENDED'
                    ? 'warning'
                    : 'primary'
              }
            >
              {s.status}
            </Badge>
          </p>
        </div>
        <div className="flex gap-2">
          {s.status !== 'CANCELLED' ? (
            <form action={cancelShiftAction}>
              <input type="hidden" name="shiftId" value={shift.id} />
              <Button variant="destructive" type="submit">
                Cancel shift
              </Button>
            </form>
          ) : (
            <form action={reinstateShiftAction}>
              <input type="hidden" name="shiftId" value={shift.id} />
              <Button variant="outline" type="submit">
                Reinstate
              </Button>
            </form>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rate class override</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={setShiftOverrideAction} className="flex items-end gap-3">
              <input type="hidden" name="shiftId" value={shift.id} />
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="rateClassId">Pay this shift as</Label>
                <Select
                  id="rateClassId"
                  name="rateClassId"
                  defaultValue={s.rateClassOverrideId ?? ''}
                >
                  <option value="">Automatic (rules decide)</option>
                  {config?.config.rateClasses.map((rc) => (
                    <option key={rc.slug} value={config.rateClassIdsBySlug[rc.slug]}>
                      {rc.name} (override)
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="outline" type="submit">
                Apply
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Precedence: manual override → employer rules → role default. Overrides are recorded as
              audited events.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History — {events.length} events (append-only)</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {events.map((event) => (
                <li key={event.seq} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      #{event.seq} {event.kind}
                    </span>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={event.occurredAt.toISOString()}
                    >
                      {event.occurredAt.toLocaleString('en-GB')}
                    </time>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Evidence:{' '}
                    {event.sourceEmailId ? `email ${event.sourceEmailId}` : (event.actor ?? '—')}
                  </p>
                  {event.diff && (
                    <dl className="mt-2 grid gap-1 text-xs">
                      {Object.entries(event.diff).map(([field, change]) => (
                        <div key={field} className="flex gap-2">
                          <dt className="font-medium">{field}:</dt>
                          <dd className="text-muted-foreground">
                            {displayValue(change.from)} → {displayValue(change.to)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
