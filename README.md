# Payslip — Workforce & Payroll Intelligence Platform

A production-quality workforce management and payroll intelligence platform for shift
workers. It ingests rota emails automatically, tracks every shift change with an audit
trail, computes expected pay through a configurable rules engine, estimates UK tax /
National Insurance / pension, reconciles expectations against real payslips, and
flags payroll mistakes — live, with £0/month running costs for a single user.

> **Status:** Phases 1–10 built and tested (100+ tests incl. Postgres
> integration and property tests). Live loop working end-to-end: signed email
> push → archive → classify → quarantine/parse → shifts → payroll engine →
> expected pay → payslip reconciliation → discrepancies → notifications.
> Outstanding: Tracsis parser v1 (needs sample emails), E2E/axe suite, Sentry,
> and the production deploy itself (`docs/deployment.md`). Statutory seeds
> verified against gov.uk (2026-07-13). Constitution: `CLAUDE.md`.

## Getting started

```bash
pnpm install
cp .env.example .env           # fill in DATABASE_URL / DIRECT_URL
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm test                      # set TEST_DATABASE_URL to include integration tests
```

## Why this exists

Shift workers on irregular-hours contracts are the group most likely to be underpaid
and least equipped to prove it. Rotas arrive by email, change constantly, and payroll
runs on cut-off rules nobody explains. This platform keeps the evidence: every rota
email is archived immutably, every shift change is versioned, and every expected-pay
figure is reproducible down to the rule version and the email that justified it.
When a payslip is wrong, the app doesn't just say so — it can show the proof.

## Documentation map

| Document                                                                         | Phase | Contents                                                                    |
| -------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| [docs/phase-1-requirements.md](docs/phase-1-requirements.md)                     | 1     | Requirements analysis, confirmed domain facts, open questions               |
| [docs/phase-2-assumptions-challenged.md](docs/phase-2-assumptions-challenged.md) | 2     | Where the original brief is wrong or risky, and what we do instead          |
| [docs/phase-3-improvements.md](docs/phase-3-improvements.md)                     | 3     | Improvements beyond the brief                                               |
| [docs/phase-4-architecture.md](docs/phase-4-architecture.md)                     | 4     | System architecture, data model, API surface, security, testing, cost model |

## Principles (non-negotiable)

- **£0/month for a single user.** Every service choice documents its free-tier limits
  and the first event that would cost money.
- **Evidence over vibes.** Raw emails are archived immutably; calculations are
  reproducible; every number can be explained.
- **Pure domain core.** Payroll, statutory, and parsing logic are framework-free
  TypeScript — testable without a database, a browser, or the network.
- **Configuration over code.** Employer pay rules, statutory thresholds, and pay-period
  schemes are data, never hardcoded.
- **Estimates, not advice.** Tax figures are estimates for reconciliation and
  forecasting; the app is not a tax adviser.

## Stack

Next.js (App Router) · TypeScript (strict) · TailwindCSS · shadcn/ui · PostgreSQL
(Supabase) · Prisma · Auth.js (Google) · Supabase Storage & Realtime · Vercel ·
GitHub Actions · Vitest · Playwright · pnpm

## Licence

MIT
