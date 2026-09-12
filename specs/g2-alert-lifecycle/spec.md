# g2-alert-lifecycle — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G2` (ACTIVE)
- Objective: Deliver the alert lifecycle on top of the durable substrate: notifications distinguish
  EARLY_WATCH, CONFIRMED_OPPORTUNITY, thesis strengthening/weakening, expiry and risk with separate
  policies, content, TTL and per-class metrics/denominators, EARLY_WATCH carries short TTL with
  explicit missing data and no high-conviction language, CONFIRMED_OPPORTUNITY requires the full
  deterministic gate set including tradability, security, cost, freshness and expiry, material
  deterioration/cancellation/expiry of actionable prior alerts produces idempotent update
  notifications under fingerprint/cooldown rules, and every opportunity notification embeds
  validity, actionability, execution assumptions and evidence links. Strictly read-only: no trading,
  custody, wallet-signing, private-key, or transaction-submission capability.
- Risk: HIGH · writeScopes: `migrations/g2_alert_*.sql`, `packages/alerts/**`, `packages/domain/**`,
  `packages/shared-schemas/**`, `telemetry/alert.*`, `tests/acceptance/**`,
  `tests/fixtures/alerts/**`, `tests/negative/**`
- Dependencies: `g2-durable-workflow` RUNNING
- Bound inputs at seed time: main `5146b2f0dcc1`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-ALERT-001 — 38. Functional requirements catalogue (PRD line 6196)

> Alerts distinguish `EARLY_WATCH`, `CONFIRMED_OPPORTUNITY`, thesis strengthening/weakening, expiry,
> and risk.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/alert.ts`
- Fixture refs: `tests/fixtures/alert/`
- Telemetry refs: `telemetry/alert.*`

### FR-ALERT-002 — 38. Functional requirements catalogue (PRD line 6197)

> `EARLY_WATCH` has short TTL, explicit missing data, and no high-conviction language.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/alert.ts`
- Fixture refs: `tests/fixtures/alert/`
- Telemetry refs: `telemetry/alert.*`

### FR-ALERT-003 — 38. Functional requirements catalogue (PRD line 6198)

> Confirmed alerts require current tradability, security, cost, freshness, and expiry checks.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/alert.ts`
- Fixture refs: `tests/fixtures/alert/`
- Telemetry refs: `telemetry/alert.*`

### FR-ALERT-004 — 38. Functional requirements catalogue (PRD line 6199)

> Prior actionable alerts receive material deterioration, cancellation, or expiry updates.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/alert.ts`
- Fixture refs: `tests/fixtures/alert/`
- Telemetry refs: `telemetry/alert.*`

### FR-ALERT-005 — 38. Functional requirements catalogue (PRD line 6200)

> Alert metrics and denominators are separated by alert class.

Normative level: MUST. Acceptance criteria: all 9 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/alert.ts`
- Fixture refs: `tests/fixtures/alert/`
- Telemetry refs: `telemetry/alert.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-140** · positive: `tests/acceptance/AC-140.spec.ts` · negative/failure:
  `tests/negative/AC-140.negative.spec.ts` — attached to 5 requirements
- **AC-141** · positive: `tests/acceptance/AC-141.spec.ts` · negative/failure:
  `tests/negative/AC-141.negative.spec.ts` — attached to 5 requirements
- **AC-142** · positive: `tests/acceptance/AC-142.spec.ts` · negative/failure:
  `tests/negative/AC-142.negative.spec.ts` — attached to 5 requirements
- **AC-143** · positive: `tests/acceptance/AC-143.spec.ts` · negative/failure:
  `tests/negative/AC-143.negative.spec.ts` — attached to 5 requirements
- **AC-245** · positive: `tests/acceptance/AC-245.spec.ts` · negative/failure:
  `tests/negative/AC-245.negative.spec.ts` — attached to 5 requirements
- **AC-246** · positive: `tests/acceptance/AC-246.spec.ts` · negative/failure:
  `tests/negative/AC-246.negative.spec.ts` — attached to 5 requirements
- **AC-247** · positive: `tests/acceptance/AC-247.spec.ts` · negative/failure:
  `tests/negative/AC-247.negative.spec.ts` — attached to 5 requirements
- **AC-248** · positive: `tests/acceptance/AC-248.spec.ts` · negative/failure:
  `tests/negative/AC-248.negative.spec.ts` — attached to 5 requirements
- **AC-249** · positive: `tests/acceptance/AC-249.spec.ts` · negative/failure:
  `tests/negative/AC-249.negative.spec.ts` — attached to 5 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g2-durable-workflow`: Deliver the durable automation substrate: external triggers enter through
  an idempotent trigger inbox resolving to an immutable schedule/version and starting exactly one
  logical run, every step checkpoints with idempotency keys, monotonically fenced leases and a
  bounded retry taxonomy, schedules are versioned CRUD with validation, pause/resume, dry-run and
  run-now semantics plus a reconciliation job that diffs database schedules against the external
  scheduler and raises incidents on drift, decision/alert/outbox entries commit atomically with
  crash-safe exactly-once delivery workers, exhausted steps land in manageable dead-letters with
  safe retry from the last valid checkpoint, and new versions can run in shadow mode without
  opportunity influence. Strictly read-only: no trading, custody, wallet-signing, private-key, or
  transaction-submission capability.
- `g2-admin-control`: Deliver the admin control plane over the proven workflow and alert state: an
  overview showing system mode, global kill-switch state, provider incidents, quota forecasts,
  schedule drift, workflow/run/dead-letter counts, candidate lifecycle/risk counts, alert
  precision/recall with sample size, missed gems, cost and storage/backup status without triggering
  provider calls, a schedule/configuration control plane with immutable-version lifecycle,
  resolved-config preview and validate/forecast/dry-run/enable/pause/resume/run-now/disable actions,
  and prominent global kill switches including full-automation, model-call, provider-call,
  notification, MCP-client and emergency-read-only controls. Strictly read-only: no trading,
  custody, wallet-signing, private-key, or transaction-submission capability.
- `g2-production-readiness`: Deliver production-readiness governance: IMPLEMENTED, AVAILABLE,
  SHADOW, PROVEN, ACTIVE, DEGRADED, PAUSED, RETIRED and DISABLED as independent governed module
  states with an explicit activation gate so the full codebase can deploy while insufficient modules
  stay disabled, partial or shadow-only, dependency groups as build/test ordering without throwaway
  MVP architecture, declared best-effort free-tier operation unless every critical external
  dependency carries an applicable SLA, an MCP protocol-revision/target-client compatibility matrix
  with conformance tests, and bounded precomputed alpha matching on live paths with heavy Alpha Lab
  jobs and artifact imports confined to the isolated export/import trust boundary. Strictly
  read-only: no trading, custody, wallet-signing, private-key, or transaction-submission capability.
- `g2-recovery-continuity`: Deliver recovery and continuity proof against the G0-PROVEN tiered RPO
  targets and point-in-time-recovery mechanisms: destructive restore drills that rebuild a clean
  environment verifying hashes, chains, migrations, cross-store references, collector checkpoints
  without hidden gaps and measured RPO/RTO, post-recovery reconciliation of provider calls, quota
  reservations, workflows, inbox/outbox, alerts, collector gaps, artifacts and audit checkpoints
  before automation resumes, automatic capability degradation with confirmed-opportunity alerts
  disabled when a tier misses its declared objective while safe deterministic risk monitoring
  continues, and versioned audited governance of backup retention, deletion, legal hold, geography,
  encryption, rights constraints and restore access. Strictly read-only: no trading, custody,
  wallet-signing, private-key, or transaction-submission capability.

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->
