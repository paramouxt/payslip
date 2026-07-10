import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Realtime publisher port (ADR 3): server broadcasts on a per-user channel
 * after pipeline writes; the dashboard subscribes and revalidates. Degrades
 * to a no-op when Supabase is not configured — liveness is an enhancement,
 * correctness never depends on it.
 */
export interface RealtimePublisher {
  broadcast(userId: string, event: string, payload: Record<string, unknown>): Promise<void>;
}

export function createSupabaseRealtimePublisher(
  url: string,
  serviceRoleKey: string
): RealtimePublisher {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async broadcast(userId, event, payload) {
      const channel = client.channel(`user:${userId}`);
      await channel.send({ type: 'broadcast', event, payload });
      await client.removeChannel(channel);
    },
  };
}

export const noopRealtimePublisher: RealtimePublisher = {
  broadcast: () => Promise.resolve(),
};

export function createRealtimePublisherFromEnv(): RealtimePublisher {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseRealtimePublisher(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return noopRealtimePublisher;
}
