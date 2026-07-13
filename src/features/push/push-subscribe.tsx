'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { savePushSubscriptionAction } from '@/app/actions/push';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Web Push opt-in. Requires the service worker (production build) + VAPID. */
export function PushSubscribe() {
  const [state, setState] = React.useState<'idle' | 'busy' | 'on' | 'unsupported'>('idle');
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  React.useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !publicKey) {
      setState('unsupported');
      return;
    }
    void navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      if (existing) setState('on');
    });
  }, [publicKey]);

  async function subscribe() {
    if (!publicKey) return;
    setState('busy');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const formData = new FormData();
      formData.set('subscription', JSON.stringify(subscription.toJSON()));
      await savePushSubscriptionAction(formData);
      setState('on');
      toast.success('Push notifications enabled on this device');
    } catch {
      setState('idle');
      toast.error('Could not enable push — check notification permissions');
    }
  }

  if (state === 'unsupported') {
    return (
      <p className="text-xs text-muted-foreground">
        Web Push needs the installed app (production build) and VAPID keys configured.
      </p>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={state !== 'idle'}
      onClick={() => {
        void subscribe();
      }}
    >
      {state === 'on' ? 'Push enabled on this device ✓' : 'Enable push notifications'}
    </Button>
  );
}
