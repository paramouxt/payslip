# Release Log

Milestone-by-milestone record of what shipped, per the delivery process
agreed 2026-07-14. Newest first. Each entry states what changed, how it was
verified, and anything a deployer must do.

---

## Unreleased (branch `claude/workforce-payroll-platform-c2x0f9`)

### 2026-07-14 — Milestone 2: payslip ingestion and release hardening

**What changed**

- `tracsis-payslip` parser v1.0.0, derived from three supplied payslips.
  The real PDFs remain outside Git; anonymised text fixtures preserve the
  document structure and printed arithmetic.
- Pure parsing maps TIERBV2H/TIERBV4H wages and holiday pay to configured role
  slugs, stores integer-pence line evidence, and refuses unknown codes,
  missing totals, gross mismatches, deduction/net mismatches, and impossible
  YTD totals.
- Ingestion now archives the PDF first, extracts text through a server-only
  `unpdf` adapter, links the private storage key to the payslip, resolves the
  payroll period, triggers reconciliation, quarantines conflicts, and treats
  identical re-forwards as idempotent.
- Sentry Next.js instrumentation is wired for browser, server, edge, request
  errors, global React errors, releases, and optional source-map upload.
  Monitoring is off without a DSN. A tested `beforeSend` boundary strips
  identity/request data, secrets, email-like strings, payroll values, and
  unsafe exception messages while retaining type and stack location.
- Playwright + axe smoke coverage now checks unauthenticated redirect, dev
  authentication, and the main app routes; CI runs the production build and
  browser check against its disposable Postgres service.
- Constitution v1.1 adopts owner-approved risk-based validation and greater
  agent autonomy, with explicit pauses for real evidence, credentials,
  destructive actions, and irreversible choices.
- Removed the hard-coded personal email from the dev ingestion helper.

**Verification**

- All three supplied PDFs decode and parse successfully without emitting
  identifying content.
- Local: lint, typecheck, production build, and 112 non-database tests green.
  The 21 Postgres tests are skipped locally because this host has no Postgres
  or Docker; CI runs all 133 tests plus the authenticated Playwright/axe smoke.

**Deployer action**

- The remaining live deployment needs the Vercel, Supabase, Google OAuth,
  VAPID, and optional Sentry values listed in `docs/deployment.md`.

### 2026-07-14 — Milestone 1: Tracsis rota parser v1 (Phase 7 complete)

**What changed**

- `tracsis-rota` parser v1.0.0, built from a real anonymised corpus
  (`tests/fixtures/tracsis/`) covering both formats the employer sends:
  - **Confirmation of Work** (`eventjobs@`): per-event shift lines
    `DD/MM/YYYY HH:MM - HH:MM HH:MMhrs`; role from the event title; internal
    cross-checks (per-shift stated duration and stated total vs the parsed
    shifts) must hold or the email is refused as self-contradictory.
  - **HFS weekly grid** (site manager): whole-team HTML table; the parser
    selects the tenant's row via configured `rosterNames` (refuses when zero
    or multiple rows match), reads seven (start,end) day pairs, and treats
    `RP`/marker cells as non-HFS days. Plaintext is lossy for this table —
    HTML is parsed.
- Pipeline upgrades the corpus made necessary:
  - Restated confirmations (each email repeats the full shift set) are
    **idempotent**: unchanged shifts produce no events; changed times become
    evidence-carrying `AMENDED` events; matching key is externalRef → (date,
    role) → start instant; cancelled-shift restatements quarantine for human
    decision.
  - Parser role slugs now resolve to role ids so Reserved Parking vs
    Hands-Free shifts price at their correct rates.
  - Classifier mechanisms learned two generic keywords: "confirmation of
    work" (rota) and "revised" (rota change).
  - `Employer.rosterNames` column (+ migration) — onboarding seeds it with
    the signed-in name.
- Parser v0 stays registered-runnable for archive re-parse comparisons.

**Verification**: 124 tests green (19 new: 13 parser-unit incl. refusal
paths, 3 classifier, 5 Postgres integration incl. restatement idempotency,
amendment evidence, cross-source grid/confirmation agreement, and roster-name
quarantine); lint, typecheck, production build clean.

### 2026-07-13 — Statutory seeds verified against gov.uk (Milestone 3 groundwork)

**What changed**

- Every GB statutory figure for 2025-26 and 2026-27 verified against gov.uk;
  per-row `source` provenance now records the URLs and check date.
- **Corrections to 2026-27** (previously assumed frozen from 2025-26):
  - NI weekly Lower Earnings Limit: £125 → **£129**
  - Student loan Plan 1 threshold: £26,065 → **£26,900**
  - Student loan Plan 2 threshold: £28,470 → **£29,385**
  - Student loan Plan 4 threshold: £32,745 → **£33,795**
  - (Plan 5 £25,000, Postgraduate £21,000, all rates, NI PT £242/UEL £967,
    income tax PA £12,570/basic limit £37,700, pension band £6,240–£50,270
    confirmed unchanged.)
- Constitution §0/§5 and README updated: seeds are no longer marked
  "VERIFY against gov.uk"; new seed rows must carry verified, dated
  provenance before an engine consumes them.

**Deployer action**: run `pnpm db:seed` (idempotent upsert) on any existing
database to pick up the corrected 2026-27 row.

**Verification**: lint, typecheck, full test suite (unit + Postgres
integration + property), production build — all green.

---

## History (phases 1–12, pre-release-log)

| Commit    | Scope                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| `4cac0ec` | Phases 10–12: Web Push notifications, fast-check property tests, deployment config + runbook |
| `0701493` | Phases 8+9: payroll/statutory/reconciliation engines, live dashboard                         |
| `6ac631d` | Phase 7: provider-agnostic email ingestion pipeline (parser v0 quarantines)                  |
| `1e2a9ba` | Phase 6: Auth.js Google sign-in, app shell, protected routes, PWA scaffold                   |
| `8766b2f` | CLAUDE.md — the engineering constitution                                                     |
| `5efe6f6` | Phase 5: schema, domain core, tenant-scoped repositories                                     |
| `dd64fba` | Phases 1–4: requirements, challenged assumptions, improvements, architecture                 |
