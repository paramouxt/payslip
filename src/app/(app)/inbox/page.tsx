import Link from 'next/link';
import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { ignoreEmailAction, markNotificationReadAction } from '@/app/actions/inbox';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { asString } from '@/lib/strings';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

function describeNotification(type: string, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'ROTA_INGESTED':
      return `Rota email processed: “${asString(p.subject)}” → ${asString(p.parseStatus)}`;
    case 'PAYSLIP_RECEIVED':
      return `Payslip received: “${asString(p.subject)}” — add it under Payslips to reconcile`;
    case 'SYSTEM_HEALTH':
      return `Health: mailbox forwarder “${asString(p.label)}” has been silent — check the Apps Script`;
    case 'DISCREPANCY_FOUND':
      return `Discrepancy found: ${asString(p.summary)}`;
    default:
      return type;
  }
}

export default async function InboxPage() {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const [notifications, quarantined, pending] = await Promise.all([
    repos.notifications.listUnread(),
    repos.emailMessages.listByStatus('QUARANTINED'),
    repos.emailMessages.listByStatus('PENDING'),
  ]);
  const queue = [...quarantined, ...pending];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Notifications and the email quarantine — every unparsed rota is resolved here, and every
          resolution makes the parser smarter.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notifications ({notifications.length} unread)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {notifications.length === 0 && (
            <p className="text-sm text-muted-foreground">All caught up.</p>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm">{describeNotification(n.type, n.payload)}</p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={n.createdAt.toISOString()}>
                    {n.createdAt.toLocaleString('en-GB')}
                  </time>
                </p>
              </div>
              <form action={markNotificationReadAction}>
                <input type="hidden" name="notificationId" value={n.id} />
                <Button variant="ghost" size="sm" type="submit">
                  Mark read
                </Button>
              </form>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email queue ({queue.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing waiting. Emails that can’t be parsed automatically appear here for manual
              resolution.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Received</TH>
                  <TH>From</TH>
                  <TH>Subject</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {queue.map((email) => (
                  <TR key={email.id}>
                    <TD className="whitespace-nowrap">
                      <time dateTime={email.receivedAt.toISOString()}>
                        {email.receivedAt.toLocaleDateString('en-GB')}
                      </time>
                    </TD>
                    <TD className="max-w-40 truncate">{email.fromAddress}</TD>
                    <TD className="max-w-64 truncate">{email.subject}</TD>
                    <TD>
                      <Badge variant={email.parseStatus === 'QUARANTINED' ? 'warning' : 'default'}>
                        {email.parseStatus}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/shifts/new?fromEmail=${email.id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          Resolve as shift
                        </Link>
                        <form action={ignoreEmailAction}>
                          <input type="hidden" name="emailId" value={email.id} />
                          <Button variant="ghost" size="sm" type="submit">
                            Ignore
                          </Button>
                        </form>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
