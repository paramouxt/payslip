# Deployment Runbook — £0/month production

Target: Vercel (Hobby) + Supabase (Free) + the user's own Google Apps Script.
Every step below stays inside free tiers (constitution §16). Cold deploy from
this document should take under 30 minutes.

## 1. Supabase (database, storage, realtime)

1. Create a free project at supabase.com → note the **project URL**, the
   **service role key**, the **anon key**, and the Postgres connection strings.
2. Create a **private** storage bucket named `shiftsync-evidence`
   (Storage → New bucket → public OFF).
3. Connection strings: use the **pooled** (port 6543, `?pgbouncer=true`) URL as
   `DATABASE_URL` and the **direct** (5432) URL as `DIRECT_URL`.

## 2. Google OAuth (sign-in only — basic scopes)

1. console.cloud.google.com → new project → OAuth consent screen: External,
   app name ShiftSync, **scopes: only openid/email/profile** (never add Gmail
   scopes here — constitution §7).
2. Credentials → OAuth client ID → Web application → authorised redirect URI:
   `https://<your-app>.vercel.app/api/auth/callback/google`.
3. Note client id/secret. Basic scopes need no verification and tokens do not
   expire weekly.

## 3. VAPID keys (Web Push)

```bash
pnpm exec web-push generate-vapid-keys
```

## 4. Vercel

1. Import the GitHub repo (framework: Next.js). The daily cron in
   `vercel.json` is picked up automatically; setting `CRON_SECRET` makes
   Vercel send it as the Authorization bearer.
2. Environment variables:

| Variable                                                                  | Value                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL` / `DIRECT_URL`                                             | from Supabase (§1.3)                                                                         |
| `AUTH_SECRET`                                                             | `openssl rand -base64 32`                                                                    |
| `AUTH_URL`                                                                | `https://<your-app>.vercel.app`                                                              |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`                                   | from §2                                                                                      |
| `APP_ENCRYPTION_KEY`                                                      | `openssl rand -base64 32` — **back it up; rotating kills ingestion keys + encrypted fields** |
| `CRON_SECRET`                                                             | `openssl rand -hex 24`                                                                       |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`                              | from §1                                                                                      |
| `SUPABASE_STORAGE_BUCKET`                                                 | `shiftsync-evidence`                                                                         |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`              | from §1 (realtime client)                                                                    |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | from §3 (public key twice)                                                                   |

3. Migrations + seed (run locally against production, once per release with
   schema changes):

```bash
DATABASE_URL=<direct-url> DIRECT_URL=<direct-url> pnpm db:migrate && pnpm db:seed
```

Never `migrate dev` or `db push` against production (§16).

## 5. First-run in the app

1. Sign in with Google → Dashboard → **Add Tracsis Events** (template).
2. Settings → **Save tax profile** (tax code from a payslip; else estimates are £0 and say so).
3. Settings → **Connect mailbox** → follow the Apps Script instructions shown
   (paste into script.google.com in the account that receives rotas, run
   `setup()` once). Send yourself a test email matching the query.
4. Add your latest payslip (with YTD figures) to anchor the tax estimates.

## 6. Operations

- **Keep-alive**: the daily cron pings Postgres — Supabase free pauses after
  7 idle days; the cron makes that unreachable in normal operation.
- **Forwarder health**: connections silent >3 days raise a SYSTEM_HEALTH
  notification (+ push) and show on Settings → System health.
- **Key rotation**: Settings → Rotate key, then re-paste the regenerated
  script (old signatures die instantly).
- **Backups**: Supabase free has no PITR — `pg_dump` monthly or accept the
  risk; upgrade to Pro (£25/mo) when this stops being acceptable.
- **Error tracking (SPECIFIED, not yet wired)**: Sentry free tier with PII
  scrubbing per §7 — add `@sentry/nextjs`, DSN env var, and `beforeSend`
  stripping email bodies/amounts before going live to real users.

## 7. Going commercial (the recorded cost wall)

Vercel Hobby forbids commercial use → Pro ~$20/mo. Supabase Pro $25/mo removes
pausing and adds backups. Gmail-API pull ingestion for SaaS users requires
Google CASA verification. See constitution §16.
