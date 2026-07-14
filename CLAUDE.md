# CLAUDE.md — The ShiftSync Engineering Constitution

> **This is not documentation. This is law.**
> Every Claude session — and every human engineer — working in this repository
> is bound by this document. If a change would violate it, the change is wrong
> or the constitution must be amended _first_, explicitly, with the trade-off
> argued in writing. Silent violations are the one unforgivable engineering sin
> here, because this codebase will outlive any single session's context window.
>
> **Precedence of truth:** (1) this file, (2) the ADR tables in
> `docs/phase-4-architecture.md` §13/§14.5, (3) the phase documents in `docs/`,
> (4) code comments. On conflict, higher wins. When you change a decision,
> update every layer above the code.
>
> **Status markers used throughout:** `[BUILT]` exists and is tested in this
> repo today · `[SPECIFIED]` designed and binding, not yet implemented ·
> `[FUTURE]` directional, requires a fresh decision before building.

---

## 0. Orientation for a fresh session

The product is **ShiftSync** (repository name `payslip` — historical; the
product name won; do not rename the repo casually, it breaks remote tooling).

Read in this order before writing code:

1. This file, fully. It is long because it saves you from re-deriving months
   of decisions.
2. `docs/phase-1-requirements.md` — the requirements, including the **evidence
   footnotes**: real employer facts confirmed from a genuine Tracsis email
   (pay-period anchor, the 12.07% holiday derivation). Treat `[EVIDENCE]`
   facts as immovable; treat `[OPEN]` questions as genuinely open.
3. `docs/phase-2-assumptions-challenged.md` — why the "obvious" designs
   (Gmail-API OAuth pull, SSE on Vercel, CRUD shift rows) were rejected.
   Do not reintroduce them without new facts.
4. `docs/phase-4-architecture.md` — the system design and ADR log.

Practical bootstrap:

```bash
pnpm install
cp .env.example .env                # DATABASE_URL / DIRECT_URL
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test
# Integration tests need a Postgres and TEST_DATABASE_URL; CI provides one
# (see .github/workflows/ci.yml). Locally any disposable Postgres 16 works.
```

Development happens on feature branches; the remote-session convention is the
branch the session was assigned (currently
`claude/workforce-payroll-platform-c2x0f9`). CI must be green before a phase
is called done.

**Current position on the roadmap (see §17): Phases 1–10 built and tested.
Phase 7's Tracsis parser is v0 (quarantine-everything) pending sample emails;
Phase 11 has property tests but E2E+axe outstanding; Phase 12 has config +
runbook (`docs/deployment.md`) but Sentry wiring and the production deploy
itself outstanding. Statutory seeds verified against gov.uk 2026-07-13.**

---

## 1. Project Vision

### What ShiftSync is

ShiftSync is a workforce management and **payroll intelligence** platform for
shift workers. It watches the places where work is communicated — today,
rota emails arriving in a mailbox — and continuously answers three questions
without being asked:

1. **What am I working?** Shifts are extracted from rota emails, kept current
   as rotas are amended and cancelled, and preserved with a complete, versioned
   history of every change and the evidence for it.
2. **What should I be paid?** A configurable, deterministic rules engine
   computes expected pay per shift and per payroll period — including UK PAYE,
   National Insurance, and pension _estimates_ — from employer configuration,
   never from hardcoded logic.
3. **Was I paid correctly?** Real payslips are parsed and reconciled
   line-by-line against expectations. Differences become first-class
   `Discrepancy` objects backed by an evidence chain, exportable as an
   **Evidence Pack** — a case file a worker can attach to an email to payroll.

### Why it exists

Shift workers on irregular-hours contracts are the workers most likely to be
underpaid and the least equipped to prove it. Rotas change constantly and
verbally; payroll runs on cut-off rules nobody explains; holiday pay is a
percentage most workers have never heard of; and when a payslip is short £31,
the burden of proof lands on the person with the least data. Existing payroll
software serves the _employer_. ShiftSync is payroll software for the
_employee_ — the auditor in your pocket.

### What makes it different

- **It keeps the evidence.** Every raw email is archived immutably before any
  parsing. Every shift change is an append-only event linked to its source.
  Every computed number records the rule version, rate version, engine
  version, and statutory table that produced it. Nothing here is "trust us" —
  everything is "here's the email, here's the rule, here's the arithmetic."
- **It reconciles, not just displays.** Rota apps show your schedule. Money
  apps show your income. Nothing in the market _diffs your payslip against
  what your rota implied you'd earn_ and hands you the proof when they differ.
- **It is honest about estimation.** Tax figures are labelled estimates,
  re-anchored to the year-to-date figures on every real payslip so error
  cannot compound. ShiftSync is not a tax adviser and never pretends to be.
- **It runs on £0/month** for a single user, by architectural design rather
  than by subsidy (§16).

### Current goal vs long-term vision

**Now:** a production-quality single-user deployment serving the product
owner's real employment (Tracsis Events, UK), proving the full loop —
live email → shifts → expected pay → payslip reconciliation → discrepancy →
evidence pack — with commercial-grade engineering throughout.

**Long term:** a multi-tenant SaaS used by thousands of shift workers across
employers, countries, currencies, and tax systems; employer support added as
_configuration and plugins_ (§12), jurisdictions added as statutory modules
behind a stable interface (§5), teams and organisations layered on without
schema surgery (tenancy discipline is already in place), and an AI layer that
makes all of it conversational without ever touching the arithmetic (§6).
Every present-day decision is made so that this future is an _addition_, not
a rewrite.

---

## 2. Product Principles

These are ordered. When two conflict, the earlier one wins.

1. **Deterministic payroll.** Every monetary figure is produced by a pure
   function over versioned inputs. Same inputs, same output, forever. No
   randomness, no model inference, no clock reads inside calculation.
2. **AI never calculates payroll.** The AI bounded context consumes
   deterministic outputs and produces language, forecasts framed as
   projections, recommendations, and anomaly flags. It cannot write ledger
   state. (Full rules: §6.)
3. **Evidence driven.** Raw inputs are archived before interpretation.
   Derived data is always reconstructible. If a feature cannot cite its
   sources, it does not ship.
4. **Explainability first.** Engines return explanation trees, not bare
   numbers. Every figure in the UI can expand into its derivation, down to
   the rule name, rate version, rounding step, and source email. "Explain
   this number" is a load-bearing feature, not a tooltip.
5. **Everything traceable.** Calculations record engine version + rule-set
   version + statutory-config identity + YTD anchor. Superseded calculations
   are kept, not overwritten — what we believed, and when, is itself evidence.
6. **Configuration over hardcoding.** Employer rules, rates, pay-period
   schemes, rounding policy, statutory thresholds: all data, all versioned,
   all validated at the boundary. Engine code contains _mechanisms_, never
   employer or tax-year _facts_.
7. **Employer agnostic / provider agnostic.** No employer's name appears in
   engine logic (Tracsis exists only as a config template + parser plugin).
   No mail provider's SDK appears outside its adapter.
8. **Security by default.** Least privilege taken to its logical end: the
   flagship example is holding _zero_ mailbox credentials (§7). Sensitive
   fields are encrypted at rest; PII never reaches logs or the UI beyond
   need-to-know.
9. **Offline first (reads).** The PWA serves cached read models with honest
   staleness indicators when connectivity drops; writes are online-only in
   v1 by explicit decision (ADR 14).
10. **Accessibility first.** WCAG 2.2 AA is a requirement, not a polish task
    (§10).
11. **Free forever for one user.** £0/month is an architectural constraint
    with a maintained cost audit (§16). A change that introduces mandatory
    spend for a single-user deployment is rejected.
12. **Estimates, not advice.** Statutory outputs are estimates for
    reconciliation and forecasting, always labelled as such.

---

## 3. Engineering Philosophy

The standard is: **code you would proudly walk a Stripe or Anthropic
interviewer through, written at the speed of someone who intends to maintain
it for five years.**

- **Clean Architecture, pragmatically.** Layers are folders with
  lint-enforced dependency direction (§4), not ceremony. We do not create an
  interface per class; we create an interface per _boundary that will
  genuinely have a second implementation or needs test substitution_
  (repositories, mail providers, statutory calculators, AI ports).
- **Domain-Driven Design.** The domain layer (`src/core`) is organised around
  entities and value objects _with behaviour_ — `Shift.amend()` enforces its
  own invariants; `Money` refuses to mix currencies; `PayPeriodScheme` owns
  all period math. Services orchestrate; they do not contain business rules.
  Persistence models (Prisma) are **not** the domain model; repositories map
  between the two, in both directions, validating with zod on the way in.
- **CQRS-lite, and no further.** Shifts are an append-only event stream plus
  a current-state projection; expected pay is a recomputable projection with
  superseded history. That is the whole of our CQRS: no command buses, no
  event brokers, no replay-only state. Escalating to full CQRS/ES requires a
  constitution amendment with a named customer problem.
- **SOLID, weighted.** Single responsibility and dependency inversion do the
  real work here. Liskov and interface segregation follow naturally from the
  ports. Open/closed shows up concretely: extending the rule DSL or adding a
  mail provider must not modify existing engine code.
- **Composition over inheritance.** There are no class hierarchies in this
  codebase and there should be almost none, ever. Behaviour is composed from
  functions and small objects. `extends` is reserved for `Error`.
- **Dependency injection, hand-rolled.** Constructors/factories take their
  dependencies (`createTenantRepositories(db, tenant)`); the composition root
  wires them (`src/server/container.ts` when it lands in Phase 6+). No DI
  framework — the project is not big enough to pay that tax, and probably
  never will be.
- **No magic values.** Numbers and strings with meaning live in named
  configuration (statutory tables, employer config, env schema) or named
  constants adjacent to their use. A reviewer must never ask "why 12.07?" —
  the answer must be in the name, the type, or a provenance comment.
- **Self-documenting code, comments for constraints.** Names carry intent.
  Comments exist to state what code cannot: invariants, provenance
  ("evidence: employer communication 18 Mar 2026"), and the _why_ of
  non-obvious decisions. Never narrate the next line. Never leave
  change-log-style comments — git is the change log.
- **No speculative abstraction, no deferred mess.** YAGNI cuts both ways:
  we do not build organisation RBAC for a single user, and we also do not
  take shortcuts (floats for money, `any`, skipped validation) that a future
  phase must undo. Technical debt is only ever taken _knowingly_, recorded as
  a `TODO(#issue)` with a ticket, and never in the domain layer.
- **Strong typing is non-negotiable.** `strict` TypeScript with
  `noUncheckedIndexedAccess`. Branded types guard domain primitives
  (`IsoDate`). `any` is forbidden; `unknown` + zod parsing is the pattern at
  every boundary (HTTP, DB JSON columns, email content, env vars).

---

## 4. Architecture

### 4.1 The layer map (dependency direction is law)

```
src/core        PURE DOMAIN  [BUILT]
                Entities, value objects, domain services, ports.
                Imports: itself + zod only. No Prisma, no Next, no React,
                no vendor SDKs, no I/O, no process.env, no Date.now()
                inside calculations (time is always a parameter).

src/server      APPLICATION LAYER  [BUILT: repositories; SPECIFIED: services]
                Use-case services, repository implementations (Prisma),
                integration adapters (mailbox, storage, realtime, LLM),
                auth config, composition root.
                Imports: core, prisma, vendor SDKs. NEVER imports UI.

src/app         DELIVERY (Next.js App Router)  [SPECIFIED — Phase 6]
                RSC pages, server actions, route handlers. Thin: parse
                input (zod), resolve tenant, call a service, shape output.
                Business logic here is a constitution violation.

src/features    Client components + hooks per feature  [SPECIFIED — Phase 6+]
src/components  Cross-feature design system (shadcn/ui)  [SPECIFIED]
src/lib         Env validation, generic utilities  [SPECIFIED]
```

ESLint enforces the arrows (`eslint.config.mjs`): core importing server/UI, or
server importing UI, fails the build. Do not weaken those rules; extend them
when new directories appear.

### 4.2 Bounded contexts

| Context                       | Home                                                                                                  | Status                                       | Responsibility                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Roster**                    | `core/domain/shift`, `core/domain/payroll-period`                                                     | `[BUILT]`                                    | Shifts as event-sourced aggregates; pay-period schemes and period math                                                      |
| **Payroll**                   | `core/domain/rules`, `core/money`, (Phase 8: `core/payroll`, `core/statutory`, `core/reconciliation`) | rules+money `[BUILT]`, engines `[SPECIFIED]` | Rate-class resolution, pay computation, statutory estimation, payslip reconciliation, discrepancies                         |
| **Email Ingestion**           | `core/ingestion` (port `[BUILT]`), `server/integrations/mailbox`, `core/parsing` (Phase 7)            | port `[BUILT]`, pipeline `[SPECIFIED]`       | Receive → archive raw → classify → parse → diff → apply events; quarantine for anything unparseable                         |
| **Employer Config / Plugins** | `core/domain/employer` `[BUILT]`, `server/templates` `[BUILT]`                                        | `[BUILT]`, parser plugins `[SPECIFIED]`      | Everything an employer defines (§12)                                                                                        |
| **Authentication & Tenancy**  | `server/auth` (Phase 6), `server/tenant.ts` `[BUILT]`                                                 | tenancy `[BUILT]`, auth `[SPECIFIED]`        | Google sign-in (basic scopes only), sessions, TenantContext construction                                                    |
| **AI**                        | `core/ai` (ports `[BUILT]`), `server/ai`                                                              | `[SPECIFIED — post Phase 9]`                 | Narration, forecasting, recommendations, NL queries — under §6 law                                                          |
| **Notifications**             | schema `[BUILT]`, delivery (Phase 10)                                                                 | `[SPECIFIED]`                                | In-app + Web Push with semantic, money-impact-carrying content                                                              |
| **Evidence Packs**            | schema `[BUILT]`, generation (Phase 8/9)                                                              | `[SPECIFIED]`                                | Case-file export of a disputed period                                                                                       |
| **Reporting/Analytics**       | Phase 9 dashboard; PostHog opt-in                                                                     | `[SPECIFIED]`                                | Aggregations over projections; product analytics is optional and PII-free                                                   |
| **Observability**             | §9                                                                                                    | `[SPECIFIED]`                                | Logs/metrics/health within free tiers                                                                                       |
| **Feature Flags**             | —                                                                                                     | `[FUTURE]`                                   | Not built. Until a real need appears, "flags" are env-var config in `src/lib/env`. Do not add a flag service speculatively. |

### 4.3 Interaction rules

- Contexts talk through **domain types and ports**, never through each
  other's persistence models or vendor SDKs.
- The ingestion pipeline is the only writer of shift events from email; the
  UI writes through server actions calling the same domain methods. Both
  paths produce identical, evidence-carrying `ShiftEvent`s.
- Payroll consumes Roster + Employer Config + Statutory Config and produces
  projections (`ExpectedPay`, `Discrepancy`). It never mutates roster state.
- AI consumes projections and explanation trees read-only (§6).
- Everything user-facing is tenant-scoped by construction: repositories are
  created _with_ a `TenantContext`; there is no API to query without one
  (global reference data — statutory tables — is the sole, explicit
  exception).

### 4.4 Forbidden

- Business logic in UI components or route handlers.
- Prisma types escaping `src/server`.
- Employer names/rules/rates in engine code (§12).
- Floating-point money anywhere (§8).
- `UPDATE`ing or `DELETE`ing shift events, email archive rows, or superseded
  calculations. Append-only means append-only.
- Direct table access that bypasses a repository (except migrations/seeds).
- New runtime dependencies without a stated reason in the PR/commit body —
  every dependency is an attack surface and a maintenance liability.
- Cross-tenant queries, however convenient, outside global reference data.
- `eval`, dynamic code execution of config, or widening the rule DSL to a
  general expression language (ADR 6).

---

## 5. Domain Model

The canonical shapes live in `src/core/domain/**` and `prisma/schema.prisma`.
This section states _responsibilities and invariants_ — the things a future
session must not break.

- **User** — identity + tenant root. Every domain row carries `userId`.
- **Tenant** — not a table; a _discipline_. `TenantContext { userId }` is the
  only key to data access. Future organisations become a second dimension
  _on top of_ this, never a replacement.
- **Employer** — a company the user works for. Owns configuration: timezone,
  currency, jurisdiction, pay-period scheme, rounding policy, sender
  patterns, roles, rate classes, rule sets. An employer is _data_; see §12.
- **Contract** — the employment relationship between a user and an employer
  (start/end, encrypted employee reference, optional scheme override).
  Shifts and payslips reference a contract. Two spells at the same employer
  are two contracts. Invariant: a contract's shifts/payslips share its
  user and employer.
- **Role** — employer-scoped job type ("Hands-Free"). Carries a default rate
  class. Rules reference role slugs. Never a free-text string on a shift.
- **Shift** `[BUILT]` — aggregate root over an append-only event stream.
  Invariants enforced in the class, not in callers: end after start; ≤ 24h;
  valid calendar date; cancelled shifts must be reinstated before amendment;
  every mutation demands **evidence** (source email id, or a human/system
  actor) and yields exactly one `ShiftEvent`; version = number of events.
  Mutations are immutable — they return the next `Shift` plus the event to
  persist. `fromEvents` replay must equal the stored projection (tested).
- **ShiftEvent** `[BUILT]` — the truth. seq is contiguous from 1; kind ∈
  CREATED/AMENDED/CANCELLED/REINSTATED/MANUAL_EDIT/OVERRIDE_SET/
  OVERRIDE_CLEARED; carries full post-state snapshot + human-renderable diff.
  Never updated, never deleted.
- **PayrollPeriod** `[BUILT: scheme math + persistence]` — materialised span
  (sequence, start, end, expected payday) resolved from the employer's
  `PayPeriodScheme`. Scheme invariants: overrides beat formula; a
  formula-computed span that would overlap an override **throws** rather than
  silently colliding (the April-2026 transition taught us this).
- **RateClass / RateVersion** — what a class of work pays, as dated versions.
  Historical recomputation uses the version in force on the shift date.
  Components today: `BASE` pence/hour, `HOLIDAY_ROLLED_UP` percent-of-base.
  New component types extend the zod schema + engine with tests.
- **Rule / RuleSet / RuleEngine** `[BUILT]` — ordered condition→effect data
  in a closed DSL (`all/any/not` over typed fact comparisons; effects from a
  fixed vocabulary). Precedence, which is product law from the real employer:
  **manual override → first matching rule by ascending priority → role
  default.** Decisions self-describe (`decidedBy`, `ruleName`). Rule sets are
  versioned with effective dates; editing rules creates a new version.
- **Money** `[BUILT]` — value object: integer minor units + ISO 4217 code.
  See §8.
- **TaxProfile** — per user/jurisdiction/tax-year statutory inputs (tax code,
  basis, NI category, pension, student loan). Without one, statutory output
  is zero-deductions with an explanation node saying why — never a guess.
- **StatutoryConfig** — global reference data per (jurisdiction, taxYear):
  bands, thresholds, NI category tables, loan plans, with a provenance
  `source` field the engine surfaces. GB 2025-26 and 2026-27 verified against
  gov.uk 2026-07-13 (URLs recorded per row; the check corrected the 2026-27
  NI LEL and student-loan thresholds). New seed rows must carry verified,
  dated provenance before any engine consumes them.
- **Holiday policy** — deliberately _not_ a separate entity today: rolled-up
  holiday is a rate component (`HOLIDAY_ROLLED_UP`), because that is how the
  evidenced employer pays it. Accrued-leave models `[FUTURE]` will justify a
  real HolidayPolicy entity; do not build it before an employer needs it.
- **MailboxConnection / IngestionSecret** — a connected mailbox, keyed by
  provider kind; secrets hashed, rotatable, revocable. The platform holds no
  mailbox credentials for the v1 push provider — that asymmetry is a feature.
- **EmailMessage** — envelope + immutable raw archive pointer + parse status
  (PENDING/PARSED/QUARANTINED/IGNORED) + parser identity/version. Idempotent
  by `dedupeKey` (hash includes tenant). Quarantine is a first-class state
  with a human resolution path that yields parser fixtures.
- **Payslip** — parsed actual pay: totals, line items, YTD anchors (the
  cumulative ground truth for tax), encrypted reference, link to source email
  and document. Matched to a PayrollPeriod.
- **ExpectedPay** — recomputable projection per period: totals + full
  explanation tree + complete provenance (engine/ruleset/statutory/anchor
  versions). Superseded rows kept with `current=false`.
- **Discrepancy** — expected-vs-actual difference with kind, severity
  (INFO/MINOR/MAJOR), status (OPEN/ACKNOWLEDGED/RESOLVED/**EXPECTED_WRONG** —
  we must be able to admit our expectation was the wrong side), delta in
  pence, and evidence references.
- **EvidencePack** — persisted case file for a period: structured evidence
  graph + optionally rendered document. Nearly free to generate because the
  ledger already exists; that is the point of the ledger.
- **Notification** — typed, payload-carrying, must state the _payroll
  consequence_ ("Sat 14 Jun cancelled — this period −£155.60"), not just the
  fact. Read/pushed timestamps tracked.
- **Organisation / Team** `[FUTURE]` — an additive layer above users. The
  schema discipline (userId everywhere) exists precisely so this is not a
  rewrite. Do not build early.

---

## 6. AI Principles

This section is deliberately absolutist, because it is the most tempting one
to erode.

**The AI does not calculate payroll. Ever.** Not "helps calculate", not
"sanity-checks the calculation by redoing it", not "fills in a missing rate
it's pretty confident about". A model-produced number is never a payroll
number.

The AI bounded context (`src/core/ai/ports.ts` `[BUILT: ports only]`) may:

- **Explain** — turn engine explanation trees into prose (`ExplanationNarrator`).
- **Forecast** — frame projections built on deterministic what-if engine runs
  and statistical baselines (`ForecastModel`); output carries composition
  honesty (what's payslip-backed vs scheduled vs projected).
- **Recommend** — suggest actions (`RecommendationEngine`); a recommendation
  is a link to a human-executed action, never an auto-applied change.
- **Answer questions** — natural-language queries (`PayrollQueryAgent`) that
  compile to engine runs and projection reads; every number cited must carry
  a citation to the engine run or stored projection it came from.
- **Summarise** and **detect anomalies** — pattern-flagging over projections;
  an anomaly flag opens a review, it does not alter data.

Hard rules:

1. AI consumes **read models only** (explanation trees, event history,
   projections) — the same data a human sees.
2. AI **never writes** ledger, roster, configuration, or calculation state.
   Anything it wants changed flows through the same validated server actions
   a human uses, as a _proposal_.
3. The platform must remain **fully functional with the AI layer absent** —
   both because free tier (§16) and because trust must not depend on a model.
4. LLM access goes through `LanguageModelPort`; no vendor SDK outside its
   adapter. Prompts sent to external models must not contain PII from §7's
   never-expose list.
5. Model outputs shown to users are labelled as AI-generated where the
   distinction matters (recommendations, narratives).

Deterministic-vs-AI is also a _testing_ boundary: engine tests assert
penny-exact equality; AI tests assert structure, citations, and boundary
compliance, never numeric truth.

---

## 7. Security

Threat framing: this system stores a person's work history, earnings, and
payslips — data that enables identity theft and employer retaliation. Treat
every store and every log line accordingly. OWASP Top 10 is the floor.

### Identity & access

- Sign-in: Auth.js with Google, **basic scopes only** (openid/email/profile).
  Never add sensitive/restricted Google scopes to the sign-in client — that
  is the wall (7-day token expiry unverified; CASA audit verified) we
  architected around; see phase-2 §1 before touching anything OAuth.
- Sessions: database-backed, revocable. No long-lived JWTs.
- Tenancy: every repository call is tenant-scoped by construction and
  covered by integration tests that _assert_ cross-tenant invisibility.
  New repositories must ship with those tests.

### The zero-credential mailbox posture

The v1 ingestion provider (user's own Apps Script pushing to us) means
ShiftSync stores **no Gmail credentials at all**. A full database breach
yields zero mailbox access. Preserve this: pull providers (Gmail API, IMAP,
Graph) `[FUTURE]` must keep credentials inside their adapter, encrypted, and
must be a deliberate, documented trade-off.

### Ingestion endpoint

HMAC-SHA256 over `timestamp.body` with **HKDF-derived per-connection keys**
(ADR 15): keys are derived from `APP_ENCRYPTION_KEY` + connection id + key
version and are never stored — the database holds only the active key version
and a verification hash, so a database breach alone yields nothing. Rotation
= bump the version (old signatures die instantly); revocation = revoke the
secret row. Plus: timestamp window against replay, body size caps, zod-parsed
payloads. Emails are **hostile input**: archive before parsing, and let
parsers fail into quarantine — never into partial writes.
_Amended 2026-07-09 (Phase 7): the original "secrets hashed at rest" wording
was unimplementable — HMAC verification requires the key. Derivation is
strictly stronger than storing encrypted secrets._

### Data protection

- Encrypted at rest (application-level AES-256-GCM, key `APP_ENCRYPTION_KEY`
  in env, versioned for rotation): employee references, payslip references,
  and any field on the never-expose list that we must store.
- **Never expose — not in UI (beyond explicit user need, last-4 style), not
  in logs, not in Sentry, not in AI prompts, not in analytics, not in test
  fixtures:** National Insurance numbers, bank details, addresses, employee
  numbers, payslip references, passwords, API keys, tokens, OAuth secrets.
- Documents (payslip PDFs, raw MIME) live in a **private** Supabase Storage
  bucket; access via server-generated short-lived signed URLs only.
- Fixtures derived from real emails are anonymised before entering the repo.
  A real payslip never gets committed.

### Secrets

Environment variables only, validated by zod at boot (`src/lib/env`),
documented in `.env.example` with placeholders. No secret has ever been
committed to this repo; keep it that way — if one leaks, rotate it, don't
just delete the line.

### Auditability & logging

The event ledger _is_ the domain audit log. Operational logs are structured,
PII-scrubbed (Sentry `beforeSend`), and never contain email bodies or money
amounts tied to identity. Admin-ish actions (secret rotation, mailbox
connect/disconnect) are recorded.

### Platform hygiene

CSP, HSTS, frame-deny, referrer-policy headers; Prisma parameterised queries
only; pnpm lockfile + Dependabot + CI audit; rate limiting on the ingestion
endpoint (HMAC already gates it; add IP-level throttling when public);
Supabase RLS as defence-in-depth for any future direct-from-client access —
Realtime channel authorisation uses it from day one.

---

## 8. Money Rules

- **Integer minor units, always.** `Money` = integer pence + ISO 4217 code
  (`src/core/money/money.ts`). `Money.of` rejects non-integers; construction
  is the validation point.
- **Why no floats:** binary floating point cannot represent most decimal
  fractions; error compounds across thousands of line items; and payroll
  disputes are won and lost on pennies — an app whose own arithmetic drifts
  by a penny has no standing to dispute anyone's payslip. `1388 * 0.1207 =
167.53159999999998` in IEEE 754; that is the bug class we've made
  unrepresentable.
- **Explicit rounding, every time.** Any operation that can produce a
  fraction (multiply by hours, percentages) requires a `RoundingMode`
  (HALF_UP, HALF_EVEN, FLOOR, CEIL, TRUNCATE — HALF_UP means half away from
  zero, the payroll convention). There is no default. The chosen mode and
  the _level_ at which rounding is applied (currently per shift-component)
  is **employer configuration** (`roundingPolicy`), because matching the
  employer's payroll software is what makes reconciliation penny-exact.
- **Rounding appears in explanation trees.** A rounding step is a
  calculation step; it must be visible when a user expands a number.
- **No currency mixing.** Cross-currency arithmetic throws. FX conversion
  does not exist in this codebase `[FUTURE — needs rate source + dating
decisions; do not improvise]`.
- Fractions mid-computation are permitted only transiently inside a single
  engine step, resolved to integer pence at the policy's rounding level
  before the value is stored, summed across components, or displayed.

---

## 9. Observability

Constraint: free tiers, serverless. We optimise for _diagnosability of
payroll disputes_ first, dashboards second.

- **Every payroll calculation is traceable** `[BUILT into the data model]`:
  `ExpectedPay` rows carry engine version, rule-set version, statutory config
  id, YTD anchor id, computed-at, and the full explanation tree. Tracing a
  number does not require logs — it requires reading the row. This is the
  project's tracing system of record.
- **Structured logging** `[SPECIFIED]`: JSON logs from server code; every
  ingestion pipeline run carries a **correlation id** (the `IngestionRun`
  id) stamped on every log line and stored on affected rows' provenance.
  No PII (§7). `console.log` is lint-banned outside tests/seeds.
- **Errors**: Sentry free tier `[SPECIFIED — Phase 12]` with PII scrubbing
  and release tagging (git SHA).
- **Health checks** `[SPECIFIED — Phase 7/10]`: the daily cron doubles as
  the heartbeat — DB keep-alive (Supabase free pauses after 7 idle days),
  forwarder-silence detection (mail expected but none pushed), quarantine
  depth, watch/secret expiry. Results land on a "system health" card in
  settings and push a notification on failure. A free-tier system fails
  quietly; we watch ourselves.
- **Metrics** `[FUTURE]`: no metrics infrastructure until there's a second
  user; the health card + Sentry + Vercel's built-ins cover v1. Do not add
  Prometheus/OTel stacks to a Hobby deployment.
- **Performance**: budgets in §10/§16 (interaction <200ms perceived, initial
  load <2.5s on 4G); verify with Lighthouse in CI when the UI exists
  `[SPECIFIED — Phase 9]`.

---

## 10. Accessibility

Target: **WCAG 2.2 AA**, verified, not asserted.

- Semantic HTML first: real `<button>`, `<nav>`, `<table>`, `<time>`;
  ARIA only where semantics genuinely fall short, and correct when used.
- Full keyboard navigation: every interactive element reachable and operable;
  visible focus rings (2.2's focus-appearance rules); a command palette
  (`cmd+k`) is an enhancement, never the only path.
- Screen readers: labelled controls, `aria-live` for realtime updates
  (a rota change appearing on the dashboard must be announced), table
  semantics for reconciliation views.
- **Reduced motion**: respect `prefers-reduced-motion` — animations are
  subtle by principle and removable by preference.
- Contrast: AA minimums in both themes; money deltas never encoded by colour
  alone (icon + sign + text).
- Dark and light mode both first-class (`prefers-color-scheme` + toggle).
- Touch targets ≥ 44px on mobile; the audience checks rotas on phones.
- Testing: axe checks inside Playwright E2E `[SPECIFIED — Phase 11]` plus a
  manual keyboard-only pass per major screen before a phase closes.

---

## 11. Real-Time Behaviour

The product must feel _live_ without owning connections on a serverless host
(ADR 3). The pipeline, end to end:

```
Rota email arrives in the user's Gmail
  ↓  ≤ ~1 min (Apps Script time trigger, label-based state, retries on non-2xx)
POST /api/ingest/email        — HMAC + timestamp verified, size-capped
  ↓
Validation & dedupe           — zod parse; dedupeKey idempotency (same email
  ↓                             twice = one ingestion, tested)
Immutable raw archive         — Storage write BEFORE any interpretation;
  ↓                             from here nothing can be lost
Classification                — ROTA / ROTA_CHANGE / CANCELLATION / PAYSLIP /
  ↓                             PAY_COMMS / OTHER (per-employer sender patterns)
Parser (versioned, per plugin)— failure ⇒ QUARANTINE + UI resolution
  ↓                             (every resolution becomes a fixture)
Shift matching & diffing      — externalRef → natural key → fuzzy window;
  ↓                             ambiguity ⇒ quarantine, never guess
Domain events                 — Shift.create/amend/cancel with email evidence
  ↓
Rule engine + payroll         — recompute ExpectedPay for affected periods
  ↓                             (supersede, keep history); reconcile if a
  ↓                             payslip exists ⇒ Discrepancies
Realtime update               — broadcast on the user's Supabase Realtime
  ↓                             channel; dashboard revalidates instantly
Notification                  — in-app + Web Push, stating payroll impact
```

Engineering properties that must survive refactors:

- **Idempotent at every stage**; the pipeline checkpoints to Postgres so a
  serverless timeout resumes cleanly.
- **Durability lives at the source**: Gmail retains mail; a daily
  reconciliation sweep re-requests anything missed. ShiftSync being down
  loses nothing.
- **Nothing depends on precise scheduling** (Vercel Hobby cron = daily with
  jitter; Apps Script owns the minutes-level cadence).
- Offline clients (§2.9) catch up via revalidation-on-focus + Realtime;
  cache is a projection of server truth; server always wins.

---

## 12. Plugin System — employers as configuration

**The engine knows mechanisms; employers are data.** Tracsis is the first
_plugin_, not a special case — `buildTracsisEmployerTemplate()` is pure
config, and the only Tracsis-specific code that will ever exist is its
parser module in the parser registry.

Every employer plugin defines:

| Element                            | Form                                                         | Status                  |
| ---------------------------------- | ------------------------------------------------------------ | ----------------------- |
| Roles                              | data (`RoleSpec[]`)                                          | `[BUILT]`               |
| Rate classes & dated rate versions | data                                                         | `[BUILT]`               |
| Assignment rules                   | closed DSL documents, versioned                              | `[BUILT]`               |
| Pay-period scheme (+ overrides)    | data                                                         | `[BUILT]`               |
| Rounding policy                    | data                                                         | `[BUILT]`               |
| Email sender patterns              | data                                                         | `[BUILT]`               |
| Rota email parser                  | versioned code module in the parser registry, fixture-tested | `[SPECIFIED — Phase 7]` |
| Payslip parser                     | same pattern                                                 | `[SPECIFIED — Phase 8]` |
| Validation & onboarding template   | config + golden payslip check (rounding calibration)         | `[SPECIFIED]`           |

Rules for parser plugins (Phase 7 implementer, read twice):

- A parser is a **pure function**: raw MIME/document → candidate structured
  output + confidence. No I/O, no DB. Registry keys it by employer + version.
- Parsers are the one place per-employer _code_ is allowed, because email
  formats are code-shaped. They still never touch pay logic — they emit
  shifts/payslip lines; the engine prices them.
- Every parser ships with a fixture corpus (anonymised real emails); every
  quarantine resolution grows the corpus; old parser versions stay runnable
  so archived email can be re-parsed and compared.
- When the DSL or component vocabulary can't express a new employer's rule,
  extend the **vocabulary** (schema + engine + tests) — never bolt employer
  conditionals into engine code, never widen the DSL to arbitrary expressions.

The SaaS endgame: onboarding an employer = filling in this table, mostly
through UI, with a parser contributed per email format. That is the moat.

---

## 13. API Standards

Current surface `[BUILT/SPECIFIED]`: internal — server actions for browser
mutations, plus machine endpoints (`/api/ingest/email`, `/api/cron/daily`,
auth routes). Public API is `[FUTURE]`.

- **Validation:** every input zod-parsed at the boundary — server actions,
  route handlers, webhooks. Parse, don't validate-and-cast; the parsed type
  flows inward.
- **AuthN:** browser = session; ingestion = HMAC + timestamp; cron =
  `CRON_SECRET` header. Every route handler states its auth mode at the top.
- **Idempotency:** ingestion is idempotent by dedupeKey `[BUILT]`; any future
  mutating public endpoint takes an `Idempotency-Key` header. Retries must
  always be safe — serverless platforms retry.
- **Error handling:** never leak internals. Structured error body
  `{ error: { code, message } }` with stable machine-readable codes; domain
  errors (`DomainError.code`) map to 4xx, `ConcurrencyError` to 409,
  infrastructure to opaque 500s (details go to Sentry, not the client).
  Server actions return typed result objects, not thrown strings.
- **Response shape:** JSON, camelCase, money as `{ pence, currency }`
  (never floats — §8), dates as ISO 8601 strings (calendar dates as
  `YYYY-MM-DD`, instants with `Z`).
- **Rate limiting:** ingestion is HMAC-gated; add per-IP throttling before
  any unauthenticated surface exists. Public API `[FUTURE]` requires it from
  day one.
- **Versioning:** internal APIs are unversioned (single deploy unit).
  Public API `[FUTURE]` will be URL-versioned (`/api/v1/...`), additive
  changes only within a version, documented deprecation windows. Do not
  design v1 of a public API casually — it's a decades-long contract.

---

## 14. Coding Standards

- **Structure:** the layer map in §4.1. Feature folders inside `features/`;
  domain concepts inside `core/domain/<concept>/`. Tests live beside the code
  they test (`*.test.ts`); cross-layer tests in `tests/`.
- **Naming:** files kebab-case; types/classes PascalCase; functions/variables
  camelCase; constants UPPER_SNAKE only for genuine constants; database
  columns camelCase (Prisma default). Names say _what role a thing plays_,
  not its type (`ruleSetDocumentSchema`, not `schema2`).
- **Imports:** `@/*` alias for cross-directory imports; relative within a
  module; `import type` for types (verbatimModuleSyntax enforces).
  Layer-boundary rules are lint law (§4.1).
- **Comments:** constraints, invariants, provenance, and non-obvious whys.
  Doc-comments on every exported domain type/function. No narration, no
  commented-out code, no changelog comments.
- **Lint/format:** ESLint (typescript-eslint strictTypeChecked +
  stylisticTypeChecked) and Prettier are CI gates. Zero warnings policy —
  a warning is either fixed or the rule is consciously configured.
- **Commits:** imperative subject with conventional prefix
  (`feat:`/`fix:`/`docs:`/`refactor:`/`test:`/`chore:`); body explains _why_
  and records trade-offs. A commit compiles, lints, and passes tests on its
  own.
- **Branching:** feature branches; remote sessions use their designated
  branch. Never push to a different branch than assigned. Never rewrite
  pushed history on shared branches.
- **PRs:** description = what + why + trade-offs + testing evidence. Reviewer
  (human or future session) must be able to verify claims from the PR alone.
- **Definition of done** for any change: lint ✓ typecheck ✓ tests (incl. new
  ones proving the change) ✓ docs/constitution updated if a decision changed
  ✓ no unexplained dependency or schema drift.

---

## 15. Testing Strategy

The pyramid is deliberately bottom-heavy because the product's value is in
pure engines, which are cheap to test exhaustively.

- **Unit (core)** `[BUILT — 100+ tests]`: money rounding law, calendar
  math (incl. DST and leap years), pay-period schemes (incl. the April-2026
  transition and the override-collision guard), Shift aggregate invariants
  and replay, rule DSL closure and engine precedence. Every new domain
  behaviour lands with unit tests in the same commit.
- **Golden fixtures** `[SPECIFIED — Phases 7–8]`: real (anonymised) rota
  emails and payslips as regression corpora. The quarantine→fixture flywheel
  (phase-3 §4) is the QA engine: every parse failure becomes a permanent
  test. Payroll engine outputs are asserted **to the penny** against real
  payslips.
- **Property tests** `[SPECIFIED — Phase 8, fast-check]`: engine invariants —
  splitting a shift at any instant never changes total pay; totals invariant
  under shift reordering; rounding never drifts more than the per-step bound.
- **Integration** `[BUILT — real Postgres]`: repository mapping, tenant
  isolation (asserted for every repository — a repo without an isolation
  test is unreviewable), optimistic concurrency, idempotent ingestion,
  replay-equals-projection. CI runs these against a service container.
- **E2E (Playwright)** `[SPECIFIED — Phase 11, smoke earlier]`: auth,
  simulated-push ingestion → dashboard, quarantine resolution, rule editing
  with the rule tester, evidence pack export. Axe accessibility checks ride
  along (§10).
- **Regression:** any bug that reaches `main` gets a failing test before the
  fix. No exceptions — this is how the corpus of trust grows.
- **Performance** `[SPECIFIED — Phase 9+]`: Lighthouse budget checks;
  engine benchmarks only if a real slowness appears (don't benchmark
  speculatively).
- What we do **not** do: mock-heavy tests that restate the implementation;
  snapshot tests of UI markup as a substitute for assertions; tests that
  depend on wall-clock time (time is always a parameter).

CI (`.github/workflows/ci.yml` `[BUILT]`): install → generate → migrate →
seed → lint → typecheck → tests, on every push and PR. Keep it under ten
minutes; parallelise before weakening it.

---

## 16. Deployment & the Free-Forever Constraint

### Environments

- **Local:** any Postgres 16 (`initdb` or Docker), `.env` from
  `.env.example`, `pnpm db:migrate && pnpm db:seed`. No cloud dependencies
  required to develop core/server code.
- **CI:** GitHub Actions with a Postgres service container `[BUILT]`.
- **Preview** `[SPECIFIED — Phase 12]`: Vercel preview deployments per
  branch, pointing at a disposable Supabase branch/database — never at
  production data.
- **Production** `[SPECIFIED — Phase 12]`: Vercel (Hobby) + Supabase Free
  (Postgres + Storage + Realtime) + user-side Apps Script + GitHub Actions.
  Migrations run via `prisma migrate deploy` (`DIRECT_URL`), never
  `migrate dev`, never `db push`, against production.

### The £0 audit (maintain this table when anything changes)

| Service                     | Free limit (checked Jul 2026)                       | Failure mode                      | Mitigation `[SPECIFIED]`                                                             |
| --------------------------- | --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| Vercel Hobby                | non-commercial; crons max 1×/day with jitter        | can't schedule minutes-level work | minutes-level cadence lives in Apps Script; server crons are daily housekeeping only |
| Supabase Free               | 500MB DB, 1GB storage; **pauses after 7 idle days** | silent total outage               | daily keep-alive query in the cron; storage (not Postgres) holds blobs               |
| Apps Script                 | ~90 min/day triggers                                | forwarder silently broken         | forwarder-silence detection in daily sweep + health card                             |
| Google OAuth (basic scopes) | free, no verification                               | —                                 | never add restricted scopes to sign-in (§7)                                          |
| GitHub Actions              | 2000 min/mo private                                 | CI starvation                     | keep CI <10 min; public repo removes the cap                                         |
| Sentry / PostHog            | 5k errors / 1M events                               | data loss, not outage             | fine at this scale; PostHog optional                                                 |

**Future scaling path (record of what going commercial costs):** Vercel Pro
(~$20/mo, required the moment this is commercial — Hobby forbids it);
Supabase Pro ($25/mo — removes pausing, adds backups/PITR); Google CASA
verification for restricted Gmail scopes **only if** the Gmail-API pull
provider ships for SaaS users; everything else scales linearly and late.
Portability is preserved deliberately: plain Postgres, S3-style storage,
standard OAuth — any tier turning hostile is a migration, not a hostage
situation.

---

## 17. Roadmap

The 12-phase plan (phase-4 §12) with live status:

| Phase | Scope                                                                                                                           | Status                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1–3   | Requirements, challenged assumptions, improvements                                                                              | ✅ `docs/phase-1..3`                                                       |
| 4     | Architecture (+v1.1 refinements: provider-agnostic ingestion, rich domain, AI context, PWA)                                     | ✅ `docs/phase-4`                                                          |
| 5     | Schema + migration, statutory seeds, domain core, tenant-scoped repositories, CI                                                | ✅ `5efe6f6`                                                               |
| 6     | Auth.js Google sign-in, app shell, protected routes, PWA scaffold, composition root                                             | ✅ `1e2a9ba`                                                               |
| 7     | Ingestion pipeline: HMAC endpoint (HKDF keys, ADR 15), Apps Script generator, archive/classify, quarantine UI, daily cron       | ✅ `6ac631d` — Tracsis parser v0 awaits sample emails                      |
| 8     | Payroll engine, statutory UK, ExpectedPay projections, reconciliation, discrepancies                                            | ✅ `86dd5b0` — evidence-pack EXPORT still to build; verify seeds vs gov.uk |
| 9     | Dashboard: stat cards, explanation trees UI, earnings chart, forecast, Realtime refresh                                         | ✅ `86dd5b0` — what-if panel + offline read cache outstanding              |
| 10    | Notifications: in-app + Web Push with payroll-impact content, system health card                                                | ✅ this commit                                                             |
| 11    | Test hardening: property tests ✅; E2E + axe, coverage targets                                                                  | partial — E2E/axe outstanding                                              |
| 12    | Production deployment: vercel.json cron, runbook (`docs/deployment.md`) ✅; Sentry wiring, live deploy, cost-audit verification | partial                                                                    |

Beyond the phases (each `[FUTURE]`, each requiring its own analysis before
code):

- **AI layer** — implement the §6 ports (narration → NL queries → recommendations),
  Anthropic adapter first, optional and degradable.
- **Multi-user SaaS** — self-serve onboarding, billing (accepting the
  Vercel Pro cost), employer plugin marketplace, moderated template sharing.
- **Teams/organisations** — org layer over tenancy, roles/permissions,
  manager views (aggregate payroll health), invitations.
- **Mobile apps** — the PWA is the mobile strategy until push/offline limits
  genuinely bite; native wrappers (Capacitor) before full native.
- **More jurisdictions** — statutory modules behind `StatutoryCalculator`
  (Scotland's bands come first and are nearly free; then IE/AU/…).
- **Public API** — §13 versioning rules; OAuth for third parties; likely the
  point where organisations and rate limiting get real.
- **Enterprise** — SSO/SCIM, audit exports, data residency. Distant; do not
  let it distort the schema today.

---

## 18. Rules for Future Claude Sessions

You are a senior engineer and co-founder on this project, not a code
generator. Behave accordingly.

1. **Read before writing.** This file, then the phase docs relevant to your
   task. If your plan contradicts an ADR, stop and resolve the contradiction
   explicitly — amend or comply, never ignore.
2. **Never violate the architecture.** Dependency directions (§4.1),
   forbidden list (§4.4), and bounded-context rules are not suggestions.
   The lint rules are a floor, not the full law.
3. **Never bypass the domain layer.** No business logic in UI or route
   handlers; no raw Prisma in services where a repository exists; no shift
   mutation that doesn't go through the aggregate and produce an
   evidence-carrying event.
4. **AI never calculates payroll** (§6). If a task seems to require it, the
   task is mis-specified — push back.
5. **Never hardcode employer logic** (§12). The moment you type `tracsis`
   inside `src/core` outside a test fixture or template, you've gone wrong.
6. **Never introduce knowing debt silently.** If you must cut a corner,
   record it (`TODO(#issue)` + commit body + user informed). Debt in the
   domain layer is refused outright.
7. **Money rules are absolute** (§8). Integer pence, explicit rounding,
   no floats, no currency mixing.
8. **Tests are part of the change, not a follow-up.** New behaviour ships
   with tests; bugs ship with regression tests first; repositories ship with
   tenant-isolation tests. Report test results honestly — a failing test is
   reported as failing, with output.
9. **Think, then code; explain trade-offs.** For any non-trivial decision,
   state the alternatives and why you chose — in the PR/commit body or the
   docs. "It works" is not a rationale.
10. **Challenge poor decisions — including the user's.** The product owner
    has explicitly mandated this. If a request breaks free-forever,
    determinism, security posture, or maintainability, say so, propose the
    better path, and only proceed on informed confirmation.
11. **Favour long-term maintainability over demonstration speed.** Nothing
    here is a demo. Prefer boring, verified, evidenced engineering.
12. **Keep the constitution alive.** When you take a decision of ADR weight,
    add it to the ADR table and, if it changes law, amend this file in the
    same commit. When you complete a phase, update §17 and the README status.
    An out-of-date constitution is how architectural consistency dies —
    leaving it stale is itself a violation.
13. **Respect the phased process.** The product owner approves phase
    transitions. Deliver a phase completely (tests green, docs updated),
    report honestly, and stop for approval rather than sprawling forward.
14. **Verify, don't assume.** Free-tier limits, statutory figures, external
    API behaviours — check them when they're load-bearing, and record
    provenance (URL + date) when you do. This project's seeds and cost
    tables carry "verified on" notes for a reason.

---

_Constitution v1.0 — established 2026-07-09, at the close of Phase 5.
Amend deliberately; never drift._
