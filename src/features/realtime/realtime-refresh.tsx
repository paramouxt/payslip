'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { toast } from 'sonner';

/**
 * Liveness (§11): subscribes to the user's broadcast channel and revalidates
 * the current route when the pipeline announces changes. Degrades silently to
 * refresh-on-focus when Supabase isn't configured — correctness never depends
 * on the socket. Payloads carry ids/statuses only, never PII.
 */
export function RealtimeRefresh({ userId }: { userId: string }) {
  const router = useRouter();

  React.useEffect(() => {
    const onFocus = () => {
      router.refresh();
    };
    window.addEventListener('focus', onFocus);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    let channel: RealtimeChannel | null = null;
    if (url && anonKey) {
      const client = createClient(url, anonKey, { auth: { persistSession: false } });
      channel = client
        .channel(`user:${userId}`)
        .on('broadcast', { event: 'ingestion' }, ({ payload }) => {
          const status = (payload as { parseStatus?: string }).parseStatus ?? '';
          toast.info(
            status === 'QUARANTINED'
              ? 'New email needs review — see Inbox'
              : 'New rota email processed'
          );
          router.refresh();
        })
        .on('broadcast', { event: 'payroll' }, ({ payload }) => {
          const n = (payload as { discrepancies?: number }).discrepancies ?? 0;
          if (n > 0) toast.warning('Payslip reconciliation found differences');
          router.refresh();
        })
        .subscribe();
    }
    return () => {
      window.removeEventListener('focus', onFocus);
      if (channel) void channel.unsubscribe();
    };
  }, [router, userId]);

  return null;
}
