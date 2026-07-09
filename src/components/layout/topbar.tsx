import Link from 'next/link';
import { Bell } from 'lucide-react';
import { ThemeToggle } from './theme';
import { signOut } from '@/server/auth/config';
import { Button, buttonVariants } from '@/components/ui/button';

export function Topbar({ email, unreadCount }: { email: string; unreadCount: number }) {
  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b bg-card px-4">
      <div className="text-sm text-muted-foreground max-md:hidden">
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[11px]">⌘K</kbd> to navigate
      </div>
      <div className="flex items-center gap-1.5">
        <Link
          href="/inbox"
          aria-label={`Notifications (${String(unreadCount)} unread)`}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <span className="relative inline-flex">
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive"
              />
            )}
          </span>
        </Link>
        <ThemeToggle />
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/sign-in' });
          }}
        >
          <Button variant="outline" size="sm" type="submit" title={email}>
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
