# Phase 3 — Improvements Beyond the Brief

Additions that materially raise product value or engineering quality, in priority
order. Each is scoped into the phase plan (none delays Phases 5–6).

---

## 1. The Evidence Pack — make “prove it” the product

The brief says “highlight payroll mistakes”. The improvement: every discrepancy can
be **exported as an evidence pack** — a single document containing the pay period,
each disputed line, the expected calculation with the exact rule and rate version
applied, the shift history behind it, and the source emails (subject, date,
relevant excerpt) that establish it. This is what you attach when you email
`peopleteam@`. It converts the app from “dashboard that disagrees with my payslip”
into “case file that wins the dispute”. Architecturally it is nearly free — it is a
rendering of the audit trail we already keep (Phase 2 §8–9) — but it is the single
most differentiating feature for the SaaS story.

## 2. “Explain this number” everywhere

Every monetary figure in the UI is clickable and expands into its derivation:
`38.5h × £13.88 (Hands-Free base, rates v3) + 38.5h × £1.68 (rolled-up holiday
12.07%, rounded half-up per hour-line) …` down to statutory lines (`PAYE: code
1257L cumulative, period 7 of 26…`). Forced by design: the payroll and statutory
engines return **explanation trees**, not bare numbers, and the UI renders them.
This doubles as the debugging tool for the engine itself and as the future
foundation for the natural-language layer (“why is this £12 less?” is answered by
walking the same tree).

## 3. YTD anchoring & self-correcting forecasts

(From Phase 2 §3, promoted to a feature.) Parsed payslips re-anchor cumulative
tax/NI/pension state each period, so annual forecasts are `actuals + scheduled +
projection` rather than compounding estimates. The dashboard shows forecast
_confidence_ honestly: which part of the year is payslip-backed, which is
scheduled, which is projected assumption.

## 4. Quarantine-to-fixture flywheel

(From Phase 2 §2, operationalised.) The quarantine UI’s “resolve manually” flow ends
with one question: “Save this as a parser test case?” Accepted cases are anonymised
into the fixture corpus. Parser quality becomes a ratchet — every failure makes the
suite stronger, and no format regression can recur silently. This is the cheapest
high-leverage QA investment in the whole system.

## 5. Payslip-grade rounding discipline

Payroll disputes live and die on pennies. Money is integer pence end-to-end;
every rounding step (per component? per shift? per period? half-up or banker’s?)
is explicit employer configuration, validated against real payslips during
onboarding of an employer. The reconciliation engine distinguishes “rounding-model
mismatch” (tune config) from “hours/rate mismatch” (raise discrepancy) — without
this, discrepancy detection drowns in penny noise and gets ignored.

## 6. Deterministic engine, property-tested

The payroll core is a pure function: `(shifts, employer config, statutory config,
tax profile, anchors) → period result`. No clock reads, no DB, no I/O inside.
Consequences: golden-fixture tests against real payslips, property-based tests
(e.g. splitting a shift at any point never changes total pay; totals are invariant
under shift reordering), and trivially reproducible historical recomputation.
DST correctness is included here: shifts store instants + timezone, durations are
instant arithmetic (a shift across the October clock change is 10 worked hours even
when the wall clock disagrees), pay-period boundaries are computed in the
employer’s timezone.

## 7. Rota-change notifications with semantic diffs

Not “you received an email” but “**Sat 14 Jun, Bicester Village: 08:00–18:00 →
CANCELLED** (rota email of 12 Jun)” with expected-pay impact (“this period −£155.60”).
The event-sourced shift stream makes the diff available; the improvement is
insisting notifications carry the _payroll consequence_, which is what a shift
worker actually cares about.

## 8. Mailbox setup as a first-class onboarding flow

Because ingestion uses the Apps Script push model (Phase 2 §1), setup is a manual
step — so treat it as product, not documentation: a settings page that generates
the per-user script (endpoint URL + HMAC secret pre-filled), step-by-step
instructions, a “send test email” verifier, and a health indicator (last push
seen, label backlog). A second signal — the daily reconciliation sweep — alerts if
the forwarder goes quiet while mail is arriving. Observed during requirements: the
rota mailbox is a _different_ Google account than the one first connected —
the flow must make “which account did you install this in?” explicit.

## 9. Simulation / what-if as an engine capability (pre-AI)

The future AI questions (“what if I accept every shift?”, “what if I drop
Saturday?”) are, mechanically, _engine runs over hypothetical shift sets_. Design
the engine API to accept arbitrary shift collections (real or hypothetical) from
day one, and ship a simple non-AI what-if UI (toggle shifts on/off, see period/net
impact) in the dashboard phase. The later AI layer becomes a language interface
over an existing, tested capability instead of new machinery.

## 10. Operational self-observation

Free-tier systems fail quietly (Phase 2 §6). The app watches itself: ingestion
heartbeats, quarantine depth, keep-alive execution, forwarder silence detection —
surfaced on a small “system health” card in settings, with Web Push on failures.
Sentry (free tier) for exceptions with PII scrubbed. The £0 constraint makes this
_more_ necessary than in a paid stack, not less.

## Deliberately rejected

- **LLM-based email parsing (v1):** deterministic parsers + fixtures first; an LLM
  fallback for quarantined emails is a fine later addition, but a paid/opaque
  dependency in the core loop violates cost and auditability today. The quarantine
  seam (Phase 2 §2) is exactly where it would plug in.
- **Full event sourcing / CQRS:** projection + append-only event log (Phase 2 §9)
  captures the value; replay-only state is complexity without a customer.
- **tRPC / GraphQL:** Next.js server components + server actions + a handful of
  route handlers cover a single-app product with far less machinery.
- **Kafka-style queues:** the mailbox _is_ the durable queue (Phase 1 NFR-7);
  Postgres rows model pipeline state fine at this scale.
