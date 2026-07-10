import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { createShiftAction } from '@/app/actions/shifts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';

export const metadata = { title: 'Add shift' };
export const dynamic = 'force-dynamic';

export default async function NewShiftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const employers = await repos.employers.list();
  const config = employers[0] ? await repos.employers.getConfig(employers[0].id) : null;
  const fromEmail = typeof params.fromEmail === 'string' ? params.fromEmail : null;
  const sourceEmail = fromEmail ? await repos.emailMessages.getById(fromEmail) : null;
  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Add shift</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sourceEmail && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              Resolving quarantined email: <strong>{sourceEmail.subject}</strong> — this shift will
              carry the email as its evidence.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              {error}
            </p>
          )}
          {!config ? (
            <p className="text-sm text-muted-foreground">Add an employer first (Dashboard).</p>
          ) : (
            <form action={createShiftAction} className="flex flex-col gap-4">
              <input type="hidden" name="employerId" value={config.employerId} />
              {fromEmail && <input type="hidden" name="sourceEmailId" value={fromEmail} />}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="startTime">Start</Label>
                  <Input id="startTime" name="startTime" type="time" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="endTime">End</Label>
                  <Input id="endTime" name="endTime" type="time" required />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="roleId">Role</Label>
                <Select id="roleId" name="roleId" defaultValue="">
                  <option value="">— none —</option>
                  {config.config.roles.map((role) => (
                    <option key={role.slug} value={config.roleIdsBySlug[role.slug]}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="venue">Venue</Label>
                <Input id="venue" name="venue" placeholder="Bicester Village" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" />
              </div>
              <Button type="submit">Create shift</Button>
              <p className="text-xs text-muted-foreground">
                End before start = overnight shift ending the next day. Times are wall-clock in{' '}
                {config.config.timezone}.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
