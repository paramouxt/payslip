import { z } from 'zod';

/**
 * Environment contract, validated once at first import. Server-only — never
 * import from client components. Everything optional in dev degrades to a
 * documented fallback; production build fails loudly on missing required
 * config (checked in the auth/config and integration adapters that need it).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url().optional(),
  DIRECT_URL: z.string().url().optional(),

  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_URL: z.string().url().optional(),

  /** Dev-only session bootstrap (see server/auth/dev-login). NEVER set in production. */
  DEV_AUTH_EMAIL: z.string().email().optional(),

  /** 32-byte base64 key for field-level AES-256-GCM. */
  APP_ENCRYPTION_KEY: z.string().optional(),

  CRON_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().url().optional(),
  SENTRY_RELEASE: z.string().optional(),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** Private bucket for raw email + payslip documents. */
  SUPABASE_STORAGE_BUCKET: z.string().default('shiftsync-evidence'),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@shiftsync.local'),

  /** Local object-storage root used when Supabase is not configured (dev). */
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === 'production';

/** Dev login is only ever considered outside production builds. */
export const devAuthEnabled = !isProduction && Boolean(env.DEV_AUTH_EMAIL);
