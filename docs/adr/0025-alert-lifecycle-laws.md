# ADR-0025: Alert-lifecycle laws (G2)

Status: accepted (2026-09-12).

## Context

`g2-alert-lifecycle` (FR-ALERT-001…005, PRD §26.2/§26.3/§26.7/§26.8/§33.9, §67.4)
introduces per-class alert policies, the deterministic confirmed-opportunity gate
set, class-templated content, the prior-alert update/cancellation lifecycle, the
reassessment sweep, and per-class metrics. The milestone plan proposed three ADR
texts (ADR-G2ALERT-1/2/3); this ADR accepts them, corrects the plan-D1 wording
about transaction ownership, and records the laws discovered during
implementation and adversarial review.

## Decision

1. **`alert`-schema table home (accepts ADR-G2ALERT-1).** Alert policies, alert
   records, fingerprints, update notifications, and per-class metric observations
   live in a dedicated `alert` PostgreSQL schema, never `public`, mirroring the
   `wf` precedent (ADR-0024). The recovery probe that asserts the absence of
   unqualified alert tables keeps its meaning; future packages MUST NOT create
   unqualified alert tables in `public`. `alert.alert_policies` and
   `alert.alert_records` are additionally governed by storage-level immutability
   triggers: policy rows admit only a one-time `superseded_by` supersede pointer
   (`g2_alert_0001`), and record rows admit only the clock/event-driven
   `actionability_state` transition (`g2_alert_0003`). A changed classification is
   a new record, never an in-place rewrite.

2. **The engine owns the commit boundary; the alert package owns exactly one
   enclosing transaction (accepts ADR-G2ALERT-2, corrected).** Classification,
   content, TTL, policies, and per-class metrics are owned by
   `packages/alerts`; transactional commit, exactly-once delivery, retry, and
   dead letters remain owned by `packages/workflow-runtime`.
   `commitAlertUpdate` (the update path) opens **one** outer transaction that
   encloses the alert-owned `alert.alert_updates` row, the fingerprint/cooldown
   ledger advance, and the engine's `commitDecisionWithOutbox` call. The engine
   still owns commit/rollback and re-enters the enclosing transaction as a
   nested SAVEPOINT, so a failure inside the engine commit rolls the alert-owned
   writes back with it and a committed outbox row always carries its decision and
   alert records. The alert package never writes outbox rows directly and never
   reimplements delivery/retry/dead-letter logic. Atomicity of the enclosing unit
   is proven by an injected-failure test (`commitAlertUpdate` with an engine
   commit that refuses): both the `alert.alert_updates` row and the ledger
   advance are rolled back. The read/classify/commit adapter `commitAlert` still
   opens no transaction of its own.

3. **SOCIAL_UNAVAILABLE is unknown coverage, not negative evidence (accepts
   ADR-G2ALERT-3).** A missing or paid-unavailable social capability is rendered
   as explicit missing data (`social_capability:SOCIAL_UNAVAILABLE`) and can never
   reduce opportunity score, prove low organic demand, satisfy organic
   confirmation, or block a profile without an explicit approved fallback
   (§67.4). The classification's `socialUnknownCoverage` is authoritative: the
   renderer refuses a caller-supplied social state that contradicts it, and the
   commit boundary refuses a rendered payload that contradicts it or omits the
   explicit marker. Social-capability adapters and their rights/coverage
   governance remain owned by the `FR-SOC` packages.

4. **Gates are evaluated, never accepted as caller-asserted results.** The only
   authoritative §26.3 gate set is a fresh `evaluateConfirmedOpportunityGates`
   evaluation of `gateInputs`. A caller-supplied `gateResults` set is an
   untrusted cross-check: when `gateInputs` is present it must deep-equal the
   evaluation or the classification is refused with a typed
   `CONTRACT_INVARIANT_VIOLATED`, and when `gateInputs` is absent the observed set
   is never marked complete — unauthenticated results can never yield
   `CONFIRMED_OPPORTUNITY`. The exported evaluator schema-validates every provided
   field, so an unknown `riskState`, an empty fingerprint, or an extra key
   refuses its gate fail-closed rather than passing.

5. **The persisted policy registry governs the sweep.** `sweepAlertLifecycle`
   accepts or loads the active `alert.alert_policies` registry via
   `loadAlertPolicies`, so persisted per-class TTL, cooldown, and
   material-change thresholds govern the update path; the in-code
   `alertPolicyFor` registry is only the per-class fallback when no persisted row
   exists (plan D2). The update notification's `valid_until` is derived from the
   resolved class TTL, so `ttl_seconds` is operational rather than declarative.
   A sweep with no reassessment source refuses fail-closed instead of reporting
   every due prior `SKIPPED`.

6. **The high-conviction language law covers the whole delivered envelope.** The
   FR-ALERT-002 check runs over the canonical serialization of the rendered
   envelope plus the delivered headline, for every class whose policy forbids
   conviction language (always `EARLY_WATCH`), so conviction prose cannot hide in
   evidence, risk, missing-data, or disclaimer fields.

## Consequences

- Later G2 packages (admin control, recovery continuity) consume these laws
  instead of restating them; they operate on the qualified `alert` names.
- The `alert` schema and its triggers are additive migration families
  (`g2_alert_*`); an applied migration is never edited — new laws land as new
  ordered scripts (0003 onward).
- The plan-D1 phrase "MUST NOT open its own transaction" is corrected to the
  precise guarantee above: the engine owns the commit boundary, and the alert
  package's single enclosing transaction is an accepted, tested seam.
