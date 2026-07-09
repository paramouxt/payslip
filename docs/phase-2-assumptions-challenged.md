# Phase 2 — Assumptions Challenged

The brief is strong, but several assumptions would sink either “free forever”,
“live”, or long-term maintainability if taken literally. Each section states the
assumption, why it fails, and the resolution carried into the architecture.

---

## 1. “Gmail API + OAuth” is the wrong ingestion mechanism for the personal phase

**Assumption:** Use the Gmail API with Google OAuth to read rota emails.

**Challenge:** `gmail.readonly` is a **restricted** Google OAuth scope. The rules,
verified July 2026:

- An external OAuth app in **Testing** status issues refresh tokens that **expire
  every 7 days**. Your “live” system would silently die weekly until you re-consent.
- Escaping Testing means publishing to Production, and restricted scopes in
  production require **Google’s verification process including a CASA security
  assessment** — an annual, potentially paid, compliance process. That violates
  “free forever” and is absurd overhead for reading your own mailbox.
- Workspace “Internal” apps are exempt, but you’re on a consumer account.

**Resolution — invert the direction of data flow.** Don’t pull from Gmail; have the
mailbox **push to us**:

- A small **Google Apps Script** installed in the user’s own Google account runs on a
  1-minute time trigger, finds new matching emails (state tracked with a Gmail label,
  so the script itself is stateless and crash-safe), and POSTs the raw message +
  attachments to our HMAC-authenticated ingestion endpoint.
- Apps Script running against its owner’s own account requires **no OAuth app, no
  verification, no stored credentials**, and consumer accounts get ~90 min/day of
  trigger runtime — hundreds of times more than needed.
- Security posture _improves_: the platform never holds Gmail credentials at all. A
  full database breach yields zero mailbox access. Least privilege in the strongest
  sense — we have no privilege.

The ingestion port is an interface (`MailboxProvider`), so the SaaS phase can add a
verified Gmail-API + Pub/Sub adapter (that’s the point at which CASA verification is
a justified business cost) without touching the pipeline. Trade-off accepted:
per-user setup of the script is manual (~5 minutes, one-time) — fine for v1, a known
onboarding cost later.

## 2. “No manual anything” is an illusion — design for graceful human-in-the-loop

**Assumption:** “No manual refresh. No imports. No spreadsheets.” Fully automatic.

**Challenge:** Email parsing of employer-generated formats has a 100% probability of
eventually failing: templates change, a coordinator sends a one-off “can you cover
Saturday?” email, a rota arrives as a screenshot. A system _pretending_ to be fully
automatic fails silently — which, in a payroll product, means quietly wrong money.
That is the single worst failure mode available to us.

**Resolution:** Automation with a visible safety net. Every email is archived
immutably _before_ parsing; anything unparseable lands in a **quarantine queue** in
the UI with the original rendered alongside a manual-entry form; every manual
resolution is captured as a candidate parser fixture, so the parser learns (in the
engineering sense) from every failure. The manual paths (add/edit shift) are
first-class, audited features, not shameful escape hatches — your own rules already
include “manually overridden to Reserved Parking”, which proves the need.

## 3. Tax estimation without payslip anchoring will drift — and must be labelled

**Assumption:** The app can “calculate” tax from shifts alone.

**Challenge:** UK PAYE is **cumulative**: this fortnight’s tax depends on year-to-date
pay and tax across _all_ payrolls under that employment, the tax code basis, and
rounding done by the employer’s payroll software. Computing from our shift data alone
diverges as soon as reality deviates (an adjustment, a bonus, a mid-year code
change). Also: presenting figures as authoritative tax calculations is a regulatory
and trust problem.

**Resolution:** Two-source model. Estimates are computed from statutory config data
(per tax year) but **re-anchored to the YTD figures on every parsed payslip** — so
error cannot accumulate beyond one period. All outputs carry “estimate” framing.
Payslip YTD becomes ground truth; the delta between our expectation and the payslip
is precisely the discrepancy-detection feature, not an embarrassment.

## 4. SSE/WebSockets on Vercel is the wrong realtime tool here

**Assumption:** “Server-Sent Events or WebSockets” for the live dashboard.

**Challenge:** Vercel functions are serverless with bounded execution time; holding
open per-client connections is fighting the platform (and on Hobby, function duration
limits make it worse). Self-hosting a socket server violates £0/month.

**Resolution:** **Supabase Realtime** (included in the free tier we already use for
Postgres + Storage): the server broadcasts on a per-user channel after ingestion
writes; the dashboard subscribes over Supabase’s managed WebSocket. Fallback is SWR
revalidation-on-focus + gentle polling. We keep the brief’s _outcome_ (live feel) and
drop its _mechanism_ (owning connections on a serverless host).

## 5. Vercel cron cannot be the scheduler backbone — and doesn’t need to be

**Assumption (implied):** Vercel Cron covers scheduled work.

**Challenge:** Vercel **Hobby cron runs at most once per day**, with up to an hour of
timing jitter. Anything needing minutes-level cadence can’t live there. GitHub
Actions scheduled workflows are best-effort (delays up to tens of minutes; disabled
after 60 days of repo inactivity on free).

**Resolution:** The 1-minute cadence lives in **Apps Script** (the ingestion push —
§1), which is reliable and free. Scheduled server work is reduced to low-frequency
housekeeping that daily granularity satisfies: Supabase keep-alive (§6), a daily
reconciliation sweep (re-request anything Apps Script failed to deliver), and
forecast refresh. Vercel Cron (daily) + a GitHub Actions daily backstop both fit
free tiers comfortably. Design rule: **nothing depends on precise scheduling.**

## 6. Free tiers have sharp edges that must be designed around, not discovered

**Assumption:** “Free forever” is a deployment choice.

**Challenge:** It’s an architectural constraint with specific failure modes:

- **Supabase free pauses projects after 7 days of database inactivity** (90-day
  restore window). A quiet week = dead app.
- Vercel Hobby is **non-commercial**; the moment this becomes a paid SaaS, Pro
  (~$20/mo) is required. Fine — that’s a funded-phase cost, but say it now.
- Supabase free: ~500 MB Postgres, 1 GB storage. Raw email archiving eats storage.

**Resolution:** Daily keep-alive query (cron from §5) makes pausing impossible under
normal operation. Storage math: rota emails are tens of KB, payslips ~100 KB —
years of headroom for one user; attachment bodies live in Storage, not Postgres.
The cost model in Phase 4 §11 tracks every limit and its first breach trigger.

## 7. A rules engine can be too powerful — constrain the DSL

**Assumption:** “Support unlimited payroll rules.”

**Challenge:** “Unlimited” read literally means an expression language →
interpreter → eventually `eval`-adjacent complexity, injection surface, and rules
nobody can debug. The actual known requirements are condition→effect mappings over
shift facts (day-of-week, duration, role, venue, flags).

**Resolution:** A **closed, declarative, JSON-schema-validated condition DSL**
(`all`/`any`/`not` over typed fact comparisons) with effects limited to a vocabulary
we control (assign rate class; later: add component, apply multiplier). Rules are
data, ordered, versioned, and testable in the UI against sample shifts. When a rule
genuinely can’t be expressed, we extend the vocabulary **in code, with tests** —
extending the engine is an engineering event, not a config hack. This is the Stripe
approach: powerful primitives, closed grammar.

## 8. Gmail is the transport, not the source of truth

**Assumption (implied):** “The rota is in Gmail.”

**Challenge:** Gmail is someone else’s mutable mailbox: mail gets deleted, accounts
get migrated, and parsing improves over time — you will want to **re-parse old
emails with new parsers**. If parse-time interpretation is all you kept, you can’t.

**Resolution:** Ingestion permanently archives the **raw MIME message** (and
attachments) in our own storage before any interpretation. Parsed data is always a
_derived projection_ that can be rebuilt (`reprocess(emailId)`); parser version is
recorded on every parse. This one decision is what makes the audit trail, fixture
capture (§2), and future parser migrations possible.

## 9. Shifts need event-sourced history, not row updates

**Assumption (implied):** A shifts table that gets updated when rotas change.

**Challenge:** “Detect rota changes” and “highlight payroll mistakes” are both
_history_ features. If an amendment `UPDATE`s a row, the evidence that Saturday
moved from 8h to 10h — exactly what you need when disputing pay — is destroyed.

**Resolution:** Event-sourcing _lite_: an append-only `ShiftEvent` stream (created /
amended / cancelled / manually-edited, each linked to its source email or user
action) with the `Shift` row as the current-state projection, plus stored diffs.
Full event-sourcing with replay-only state would be over-engineering; projection +
immutable log gives the product value at a fraction of the complexity.

## 10. Multi-tenant discipline now; multi-tenant _features_ later

**Assumption:** “Support multiple users… eventually teams”, alongside a v1 for one
person.

**Challenge:** Building auth flows for team roles, orgs, and billing now is waste
(YAGNI); but retrofitting tenancy onto a single-user schema later is a rewrite.
These fail in opposite directions.

**Resolution:** Tenancy as _schema discipline_, not features: every domain row has
`userId`; every repository method is tenant-scoped by construction (it is not
possible to call one without a user context); tests assert cross-tenant isolation.
Zero UI for it. Organisations, roles, and billing arrive as additive layers when
there’s a second user worth having. Same posture for countries (§FR-4: interface
now, UK implementation only) and currencies (per-employer currency code now, FX
never until needed).

## 11. Fortnightly NI is not “two weeks of tax” — statutory config must be first-class

**Assumption (implied):** Tax/NI/pension are formulas to implement.

**Challenge:** They are **tables that change every tax year** plus calculation
_methods_ that differ by pay frequency (NI uses per-period thresholds — a fortnightly
payroll uses 2× weekly thresholds; PAYE uses cumulative allowance apportionment) and
by employer payroll software rounding conventions. Hardcoding any of it means an
April maintenance emergency every year.

**Resolution:** `StatutoryConfig` is versioned **data** keyed by (jurisdiction, tax
year): thresholds, bands, rates, rounding conventions. Calculators are pure functions
over that data. New tax year = new config row (seedable, reviewable), not a release.
This is also exactly the seam future countries slot into.
