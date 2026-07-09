# Phase 1 — Requirements Analysis

**Status:** Complete — approved requirements feed Phases 4–12.
**Author’s note:** Facts marked **[EVIDENCE]** were confirmed from a real Tracsis
communication (18 Mar 2026, “Bicester Village Pay Frequency and Holiday Pay
Communications”). Facts marked **[STATED]** come from the product owner’s brief.
Facts marked **[OPEN]** are unresolved and listed in §9.

---

## 1. Product definition

A payroll intelligence platform for shift workers. It answers three questions
continuously and automatically:

1. **What am I working?** — shifts, ingested from rota emails, kept current as rotas
   change, with full change history.
2. **What should I be paid?** — expected gross/net per pay period, computed by a
   configurable per-employer rules engine plus per-jurisdiction statutory estimation.
3. **Was I paid correctly?** — actual payslips parsed and reconciled line-by-line
   against expectations, with discrepancies surfaced as first-class objects backed by
   evidence.

The wedge is #3. Plenty of apps show your rota. Almost nothing *proves your payslip
is wrong* with an evidence chain (this email, on this date, said this shift, at this
rate, under this rule). That is the feature worth building a company on.

## 2. Actors

| Actor | v1 | Later |
| --- | --- | --- |
| Shift worker (product owner) | ✅ sole user | primary persona |
| Additional shift workers | ❌ (schema-ready) | self-serve sign-up |
| Teams/agencies (managers viewing staff payroll health) | ❌ | organisation layer |
| Automated ingestion (mailbox forwarder) | ✅ machine actor | per-user |

v1 is single-user in operation but multi-tenant in schema: every domain row carries a
`userId`; nothing assumes “the” user. See Phase 2 §10 for why we stop there.

## 3. Confirmed domain facts — Tracsis Events

### 3.1 Pay period scheme **[EVIDENCE]**

- Payroll moved from weekly to **fortnightly** in April 2026.
- Workers are **paid every other Wednesday, for hours worked up to the previous
  Tuesday**.
- Worked example from the employer: hours worked 15–28 April 2026 → paid 6 May 2026.
- Therefore: pay periods are **14 days, Wednesday→Tuesday**, anchored at
  **2026-04-15**, and **payday = period end + 8 days** (the Wednesday after the
  Tuesday cut-off, plus one week).
- Transition edge (historical): hours to 5 Apr paid 10 Apr; 6–14 Apr paid 22 Apr.
  These two irregular periods must be representable, which is why period schemes
  support explicit overrides, not just a formula.

### 3.2 Holiday pay **[EVIDENCE — corrects the brief]**

From 1 April 2026, holiday entitlement is paid as **rolled-up holiday pay: an
additional 12.07% of the hourly rate for every hour worked**, instead of paid time
off. (12.07% = 5.6 weeks statutory leave ÷ 46.4 working weeks — the standard UK
formula for irregular-hours workers.)

The brief’s “Holiday Pay £1.68 / £1.82” figures are not independent rates — they are
**derived**: £13.88 × 12.07% = £1.6753 → £1.68; £15.06 × 12.07% = £1.8177 → £1.82.

**Design consequence:** the rules engine models holiday pay as a *percentage
component* of base, with an explicit per-component rounding policy — not as a second
hardcoded hourly rate. When the base rate changes, holiday pay follows automatically;
and if a payslip shows holiday pay that isn’t 12.07% of base hours, that is itself a
detectable discrepancy.

### 3.3 Rate classes and assignment rules **[STATED]**

| Rate class | Base | Rolled-up holiday (12.07%) | Effective total |
| --- | --- | --- | --- |
| Hands-Free | £13.88/h | £1.68/h | £15.56/h |
| Reserved Parking | £15.06/h | £1.82/h | £16.88/h |

Assignment rules (Tracsis-specific, expressed as data in the rules engine):

1. Default: shift role determines rate class (Hands-Free role → Hands-Free class).
2. **Sunday** Hands-Free shifts are paid at Reserved Parking rates.
3. **10-hour** Hands-Free shifts are paid at Reserved Parking rates.
4. Any shift may carry a **manual override** to a different rate class; overrides beat
   rules, rules beat defaults.

**[OPEN]** Whether “10-hour” means scheduled duration ≥ 10h, exactly 10h, or paid
hours after unpaid breaks — and whether breaks are unpaid at all (§9, Q3–Q4).

### 3.4 Ingestion sources **[STATED + observed]**

- Rota emails: new rotas, amendments, cancellations arrive by email.
- Payslips: format and delivery channel not yet confirmed (§9, Q1–Q2).
- **Observed:** the rota emails do *not* arrive in the mailbox connected during
  requirements gathering; they arrive in a second Gmail account. v1 must support
  designating which mailbox is the ingestion source, and the parser cannot be
  designed until sample emails are provided (a Phase 7 input, not a blocker before
  then).

## 4. Functional requirements

Grouped by capability. “Must” = v1; “Should” = v1 if cheap, else v1.x; “Later” =
post-SaaS-decision.

### FR-1 Email ingestion
- **Must** ingest new emails from the designated Gmail mailbox with ≤ ~1 minute
  latency, without manual action.
- **Must** archive the complete raw email (RFC 822/MIME, attachments included)
  immutably before any parsing occurs.
- **Must** be idempotent: the same email delivered twice produces no duplicate data.
- **Must** classify each email: `ROTA`, `ROTA_CHANGE`, `CANCELLATION`, `PAYSLIP`,
  `PAY_COMMS`, `OTHER` (classification may be combined with parsing).
- **Must** quarantine anything it cannot confidently parse, and surface the quarantine
  in the UI for human resolution. Manual resolutions are captured as parser fixtures.
- **Must** support a bounded historical backfill (initial import of past rota/payslip
  emails) to seed history.

### FR-2 Shift management
- **Must** materialise parsed rotas into shifts: date, start/end, venue, role,
  employer, status (`SCHEDULED`, `AMENDED`, `CANCELLED`, `COMPLETED`).
- **Must** detect changes: a re-issued rota updates matching shifts and records a
  versioned diff (what changed, when, according to which email).
- **Must** detect cancellations and new shifts within amended rotas.
- **Must** allow manual shift entry/edit/cancel (rotas are sometimes communicated
  verbally or via app — the email is not the only truth), with manual entries
  flagged as such in the audit trail.
- **Must** support per-shift manual rate-class override (Tracsis rule 4).

### FR-3 Payroll computation (rules engine)
- **Must** compute expected pay per shift and per pay period from **declarative,
  per-employer configuration**: rate classes, pay components (base, rolled-up holiday
  %, future: multipliers/allowances), assignment rules (ordered condition→effect),
  pay-period scheme, rounding policy.
- **Must not** hardcode any employer rule in engine code.
- **Must** version rules and rates with effective dates; recomputing a historical
  period uses the rules that were in force then.
- **Must** record, for every computed figure, the rule-set version and engine version
  that produced it (reproducibility).
- **Must** handle money as integer minor units (pence); rounding policy is explicit
  employer config.

### FR-4 Statutory estimation (UK first)
- **Must** estimate PAYE income tax, employee National Insurance, and pension
  contributions per pay period, given a user tax profile (tax code, NI category,
  pension scheme, student loan plan).
- **Must** implement UK PAYE on a cumulative basis (and week-1/month-1 when the tax
  code says so) and NI per-pay-period, with all thresholds/rates loaded from
  per-tax-year configuration data — never constants in code.
- **Must** anchor year-to-date figures from parsed payslips when available, so
  estimates don’t drift from HMRC’s cumulative reality.
- **Must** label all outputs as estimates; this is not tax advice.
- **Later:** other jurisdictions behind the same `StatutoryCalculator` interface.

### FR-5 Payslip reconciliation
- **Must** parse payslips (format TBC — §9 Q1) into structured line items: hours ×
  rate per component, gross, PAYE, NI, pension, net, YTD figures.
- **Must** match each payslip to its pay period and reconcile line-by-line against
  the expected calculation.
- **Must** raise discrepancies with severity (e.g. rounding-level vs missing-shift
  level), status (`OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `EXPECTED_WRONG`), and linked
  evidence (shifts, emails, rule versions).
- **Should** export an “evidence pack” for a disputed period (see Phase 3 §1).

### FR-6 Forecasting & reporting
- **Must** forecast earnings for current/future periods from scheduled shifts.
- **Must** forecast tax-year totals (gross, tax, NI, net) combining actuals (payslips)
  + expected (scheduled shifts) + projection (user-tunable assumption based on
  historical average hours).
- **Must** report: hours and earnings by fortnight/month/tax-year, employer
  comparison, premium-rate shift analysis.

### FR-7 Dashboard & UX
- **Must:** upcoming shifts, calendar and timeline views, hours this fortnight/month,
  gross/net/holiday/PAYE/NI/pension for current period, income & tax forecast, recent
  ingestion activity, recent rota changes, payslip verification status, notifications,
  charts, employer comparison.
- **Must:** live updates without manual refresh; dark + light mode; responsive
  mobile-first; keyboard shortcuts; instant search/filter. Linear/Stripe-dashboard
  aesthetic: minimal, fast, subtle motion.
- **Must:** accessibility — semantic HTML, keyboard navigable, WCAG AA contrast.

### FR-8 Notifications
- **Must** notify on: new rota ingested, shift changed/cancelled, payslip received,
  discrepancy found. Channels v1: in-app + Web Push. **Should:** email digest.

### FR-9 Multi-employer & extensibility
- **Must** support multiple employers per user, each with independent rules, periods,
  currency (display-level; no FX in v1), and parsers.
- **Must** keep jurisdiction, currency, and locale per employer/user so future
  countries don’t require schema surgery.

### FR-10 Administration
- **Must** provide settings UIs: employer & rules configuration (with rule testing
  against sample shifts), tax profile, mailbox connection status, notification prefs.

## 5. Non-functional requirements

| # | Requirement | Target |
| --- | --- | --- |
| NFR-1 | Running cost, single user | **£0/month**, documented per service (Phase 4 §11) |
| NFR-2 | Ingestion latency (email received → dashboard updated) | ≤ 90 s typical |
| NFR-3 | Dashboard interaction | < 200 ms perceived; initial load < 2.5 s on 4G |
| NFR-4 | Payroll correctness | Expected-vs-payslip agreement to the penny when inputs are correct; every mismatch explainable |
| NFR-5 | Auditability | Every derived figure traceable to raw evidence + rule/engine versions |
| NFR-6 | Security | OWASP Top 10; no PII in logs; sensitive data encrypted at rest; least-privilege mailbox access (Phase 4 §9) |
| NFR-7 | Availability | Best-effort on free tiers; ingestion must tolerate downtime via replay (no data loss if the app is down — mail stays queued at source) |
| NFR-8 | Portability | No service used in a way that prevents migration (plain Postgres, standard S3-style storage, standard OAuth) |
| NFR-9 | Testability | Domain core 100% framework-free; parser + payroll golden-fixture suites |

NFR-7 is the quiet star: because Gmail retains the mail and ingestion is
replay-based and idempotent, the system can be down for a day and lose nothing.
Durability lives at the source, not in our uptime.

## 6. Explicitly out of scope (v1)

- Organisations/teams, roles & permissions beyond a single user’s data.
- Billing, subscription management.
- FX conversion between currencies (multi-currency is display/config only).
- Non-UK statutory calculations (interface exists; only UK implemented).
- Automated actions on the mailbox (we only read/receive; never move/delete mail).
- Native mobile apps (responsive web + push covers v1).
- The AI/natural-language layer (schema and audit trail are designed so it can be
  added later without rework — it reads the same evidence ledger).

## 7. Key risks (requirements-level)

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Rota email format unknown/changes without notice | Parser breaks silently | Immutable raw archive + quarantine + fixtures; parsing failures are loud, data is never lost (Phase 2 §2) |
| Google OAuth restricted-scope verification wall | Breaks “live + free” if we use Gmail API naively | Push-based ingestion from the user’s own account; no restricted scopes in v1 (Phase 2 §1) |
| Cumulative PAYE needs YTD state | Tax estimates drift | Anchor YTD from each parsed payslip (Phase 3 §3) |
| Free-tier behaviours (DB pausing, cron limits) | Silent outages | Keep-alive + reconciliation jobs; documented in cost model (Phase 4 §11) |
| Payslip channel/format unknown | Reconciliation blocked | §9 Q1; reconciliation ships behind ingestion once samples exist |

## 8. Success criteria for v1

1. A rota email arriving in Gmail appears as shifts on the dashboard within ~1 minute,
   with zero manual steps.
2. A re-issued rota produces visible, correct diffs (changed/cancelled/new shifts).
3. Expected pay for a completed Tracsis period matches the real payslip to the penny,
   or every deviation is flagged with a reason.
4. Tax-year forecast within ~2% of eventual actuals given accurate inputs.
5. Monthly infrastructure invoice: £0.00.

## 9. Open questions (inputs needed from the product owner)

These gate **Phase 7 (Gmail integration/parsing)** and parts of Phase 8 — not
Phases 4–6.

1. **Payslip delivery & format** — emailed PDF? portal download? Provide one real
   payslip (it will be stored privately, never committed; fixtures are anonymised).
2. **Sample rota emails** — forward 3–5 real examples to the connected mailbox,
   ideally including at least one amendment and one cancellation.
3. **“10-hour shift” definition** — scheduled ≥ 10h, or exactly 10h? Before or after
   breaks?
4. **Breaks** — are breaks unpaid, and are they stated on the rota?
5. **Tax profile** — tax code (e.g. 1257L), sole employment?, NI category (A?),
   pension enrolled? (zero-hours event staff often aren’t), student loan plan?
6. **Which mailbox is the ingestion source** — the rota emails appear to arrive in a
   different account than the one connected here.
7. **Rate history** — did rates differ before April 2026? (Needed only if we backfill
   pre-April history.)
