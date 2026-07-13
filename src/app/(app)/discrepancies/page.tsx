import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { setDiscrepancyStatusAction } from '@/app/actions/payslips';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';

export const metadata = { title: 'Discrepancies' };
export const dynamic = 'force-dynamic';

const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPECTED_WRONG'] as const;

export default async function DiscrepanciesPage() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const discrepancies = await repos.discrepancies.list();
  const open = discrepancies.filter((d) => d.status === 'OPEN');
  const closed = discrepancies.filter((d) => d.status !== 'OPEN');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Discrepancies</h1>
        <p className="text-sm text-muted-foreground">
          Where your payslips differ from what your rota implied. “Expectation wrong” exists because
          sometimes we are the ones who are wrong — honesty is the product.
        </p>
      </div>

      {[
        ['Open', open],
        ['Reviewed', closed],
      ].map(([title, list]) => (
        <Card key={title as string}>
          <CardHeader>
            <CardTitle>
              {title as string} ({(list as typeof discrepancies).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(list as typeof discrepancies).length === 0 && (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
            {(list as typeof discrepancies).map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm">{d.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.kind} ·{' '}
                    <time dateTime={d.createdAt.toISOString()}>
                      {d.createdAt.toLocaleDateString('en-GB')}
                    </time>
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                  <form action={setDiscrepancyStatusAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="discrepancyId" value={d.id} />
                    <Select name="status" defaultValue={d.status} className="h-8 w-44 text-xs">
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace('_', ' ').toLowerCase()}
                        </option>
                      ))}
                    </Select>
                    <Button variant="ghost" size="sm" type="submit">
                      Set
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
