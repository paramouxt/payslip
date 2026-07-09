'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  Inbox,
  LayoutDashboard,
  Receipt,
  Settings,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/shifts', label: 'Shifts', icon: CalendarDays },
  { href: '/payslips', label: 'Payslips', icon: Receipt },
  { href: '/discrepancies', label: 'Discrepancies', icon: AlertTriangle },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-56 shrink-0 flex-col gap-1 border-r bg-card p-3 max-md:hidden"
    >
      <div className="mb-4 flex items-center gap-2 px-2 pt-1">
        <Zap className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight">ShiftSync</span>
      </div>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto px-2.5 pb-1 text-[11px] leading-4 text-muted-foreground">
        Estimates, not tax advice.
        <br />
        Every number is explainable.
      </div>
    </nav>
  );
}
