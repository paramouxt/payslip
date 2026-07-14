# Release Log

Milestone-by-milestone record of what shipped, per the delivery process
agreed 2026-07-14. Newest first. Each entry states what changed, how it was
verified, and anything a deployer must do.

---

## Unreleased (branch `claude/workforce-payroll-platform-c2x0f9`)

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
