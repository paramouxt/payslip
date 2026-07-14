import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { createEmployerFromTracsisTemplate } from '@/app/actions/onboarding';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { DashboardContent } from '@/features/dashboard/dashboard-content';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const employers = await repos.employers.list();

  if (employers.length === 0) {
    return (
      <div className="mx-auto max-w-lg pt-10">
        <Card>
          <CardHeader>
            <CardTitle>Welcome to ShiftSync</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Start by adding your employer. The Tracsis Events template ships with the evidenced
              pay rules: fortnightly Wednesday→Tuesday periods, 12.07% rolled-up holiday pay, and
              the Sunday / 10-hour Reserved Parking uplifts.
            </p>
            {/* Server action wiring is intentional: no client JS needed to onboard. */}
            <form action={createEmployerFromTracsisTemplate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="startDate">Contract start date</Label>
                <Input id="startDate" name="startDate" type="date" defaultValue="2026-04-06" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rosterNames">Roster names (optional)</Label>
                <Input
                  id="rosterNames"
                  name="rosterNames"
                  placeholder="e.g. Divya, D. Patel"
                />
              </div>
              <Button type="submit">Add Tracsis Events</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <DashboardContent />;
}
