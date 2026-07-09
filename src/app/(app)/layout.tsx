import { requireTenant } from '@/server/auth/session';
import { prisma } from '@/server/db';
import { createTenantRepositories } from '@/server/repositories';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { CommandPalette } from '@/components/layout/command-palette';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireTenant();
  const repos = createTenantRepositories(prisma, tenant);
  const unread = await repos.notifications.listUnread();

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={tenant.email} unreadCount={unread.length} />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
