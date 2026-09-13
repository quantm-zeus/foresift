# g2-admin-control — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G2` (ACTIVE)
- Objective: Deliver the admin control plane over the proven workflow and alert state: an overview
  showing system mode, global kill-switch state, provider incidents, quota forecasts, schedule
  drift, workflow/run/dead-letter counts, candidate lifecycle/risk counts, alert precision/recall
  with sample size, missed gems, cost and storage/backup status without triggering provider calls, a
  schedule/configuration control plane with immutable-version lifecycle, resolved-config preview and
  validate/forecast/dry-run/enable/pause/resume/run-now/disable actions, and prominent global kill
  switches including full-automation, model-call, provider-call, notification, MCP-client and
  emergency-read-only controls. Strictly read-only: no trading, custody, wallet-signing,
  private-key, or transaction-submission capability.
- Risk: HIGH · writeScopes: `apps/api/src/routes/admin/**`, `apps/dashboard/**`,
  `migrations/g2_adm_*.sql`, `packages/shared-schemas/**`, `telemetry/adm.*`, `tests/acceptance/**`,
  `tests/fixtures/adm/**`, `tests/negative/**`
- Dependencies: `g2-alert-lifecycle` PROVEN, `g2-durable-workflow` PROVEN, `g2-production-readiness`
  PROVEN
- Bound inputs at seed time: main `e5fcc06101e8`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-ADM-001 — 38. Functional requirements catalogue (PRD line 6049)

> Overview and incidents.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/adm.ts`
- Fixture refs: `tests/fixtures/adm/`
- Telemetry refs: `telemetry/adm.*`

### FR-ADM-003 — 38. Functional requirements catalogue (PRD line 6051)

> Schedule/configuration control plane.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/adm.ts`
- Fixture refs: `tests/fixtures/adm/`
- Telemetry refs: `telemetry/adm.*`

### FR-ADM-007 — 38. Functional requirements catalogue (PRD line 6055)

> Kill switches.

Normative level: MUST. Acceptance criteria: all 14 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/adm.ts`
- Fixture refs: `tests/fixtures/adm/`
- Telemetry refs: `telemetry/adm.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-010** · positive: `tests/acceptance/AC-010.spec.ts` · negative/failure:
  `tests/negative/AC-010.negative.spec.ts` — attached to 3 requirements
- **AC-011** · positive: `tests/acceptance/AC-011.spec.ts` · negative/failure:
  `tests/negative/AC-011.negative.spec.ts` — attached to 3 requirements
- **AC-012** · positive: `tests/acceptance/AC-012.spec.ts` · negative/failure:
  `tests/negative/AC-012.negative.spec.ts` — attached to 3 requirements
- **AC-013** · positive: `tests/acceptance/AC-013.spec.ts` · negative/failure:
  `tests/negative/AC-013.negative.spec.ts` — attached to 3 requirements
- **AC-014** · positive: `tests/acceptance/AC-014.spec.ts` · negative/failure:
  `tests/negative/AC-014.negative.spec.ts` — attached to 3 requirements
- **AC-060** · positive: `tests/acceptance/AC-060.spec.ts` · negative/failure:
  `tests/negative/AC-060.negative.spec.ts` — attached to 3 requirements
- **AC-061** · positive: `tests/acceptance/AC-061.spec.ts` · negative/failure:
  `tests/negative/AC-061.negative.spec.ts` — attached to 3 requirements
- **AC-062** · positive: `tests/acceptance/AC-062.spec.ts` · negative/failure:
  `tests/negative/AC-062.negative.spec.ts` — attached to 3 requirements
- **AC-063** · positive: `tests/acceptance/AC-063.spec.ts` · negative/failure:
  `tests/negative/AC-063.negative.spec.ts` — attached to 3 requirements
- **AC-260** · positive: `tests/acceptance/AC-260.spec.ts` · negative/failure:
  `tests/negative/AC-260.negative.spec.ts` — attached to 3 requirements
- **AC-261** · positive: `tests/acceptance/AC-261.spec.ts` · negative/failure:
  `tests/negative/AC-261.negative.spec.ts` — attached to 3 requirements
- **AC-262** · positive: `tests/acceptance/AC-262.spec.ts` · negative/failure:
  `tests/negative/AC-262.negative.spec.ts` — attached to 3 requirements
- **AC-263** · positive: `tests/acceptance/AC-263.spec.ts` · negative/failure:
  `tests/negative/AC-263.negative.spec.ts` — attached to 3 requirements
- **AC-264** · positive: `tests/acceptance/AC-264.spec.ts` · negative/failure:
  `tests/negative/AC-264.negative.spec.ts` — attached to 3 requirements

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
- `g2-alert-lifecycle`: Deliver the alert lifecycle on top of the durable substrate: notifications
  distinguish EARLY_WATCH, CONFIRMED_OPPORTUNITY, thesis strengthening/weakening, expiry and risk
  with separate policies, content, TTL and per-class metrics/denominators, EARLY_WATCH carries short
  TTL with explicit missing data and no high-conviction language, CONFIRMED_OPPORTUNITY requires the
  full deterministic gate set including tradability, security, cost, freshness and expiry, material
  deterioration/cancellation/expiry of actionable prior alerts produces idempotent update
  notifications under fingerprint/cooldown rules, and every opportunity notification embeds
  validity, actionability, execution assumptions and evidence links. Strictly read-only: no trading,
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
