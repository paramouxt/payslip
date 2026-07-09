'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { NAV_ITEMS } from './sidebar';

/** cmd+k / ctrl+k navigation palette. Enhancement only — every destination is
 *  also reachable by plain links (accessibility rule §10). */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed left-1/2 top-28 z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-lg border bg-card shadow-lg"
    >
      <Command.Input
        placeholder="Go to…"
        className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-72 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          No results.
        </Command.Empty>
        {NAV_ITEMS.map(({ href, label }) => (
          <Command.Item
            key={href}
            value={label}
            onSelect={() => {
              setOpen(false);
              router.push(href);
            }}
            className="cursor-pointer rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
          >
            {label}
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
