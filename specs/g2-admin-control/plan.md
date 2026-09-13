# Implementation Plan: g2-admin-control

**Package**: `g2-admin-control` | **Date**: 2026-09-13 | **Spec**: `specs/g2-admin-control/spec.md` (scoped derivative of PRD §28 in full, §24/§27/§32/§69, §33.6, §9.5, §35.1/§35.2, §29.2 admin endpoint group, and manifest FR-ADM-001/003/007 with all 14 shared ACs)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the admin control plane as ONE new read-model/control module inside the
existing `@foresift/api` app (`apps/api/src/routes/admin/**`) plus ONE new
minimal read-only dashboard app (`apps/dashboard`), consuming — never
reimplementing — the already-PROVEN owners:

1. **Provider-call-free overview (FR-ADM-001, §28.2, §33.6).** One deterministic
   read model assembles system mode, global kill-switch state, provider
   incidents, quota-exhaustion forecast, active schedules and schedule drift,
   workflow/run/waiting/dead-letter counts, candidate lifecycle/risk counts,
   alert precision/recall with sample size and confidence interval, missed gems
   and funnel failures, model/provider cost, storage growth, and latest backup
   status. Every section names its owning package and freshness; the assembly
   path holds an injected provider port that MUST NOT be called, and each
   snapshot is persisted with `provider_calls_triggered = 0` so the property is
   auditable rather than a convention (§28.2: "Dashboard refresh MUST NOT
   trigger external provider calls").
2. **Schedule/configuration control plane (FR-ADM-003, §28.3–§28.5, §25.11).**
   The immutable-version lifecycle `DRAFT → VALIDATED → APPROVED → ACTIVE →
DEPRECATED → ROLLED_BACK` with edits always creating a new version, the
   resolved-configuration preview and precedence chain
   (`system defaults < workflow version < agent profile version < schedule
version overrides < explicit run-now overrides`), and the admin actions
   validate, cost-forecast, dry-run, enable, pause, resume, run-now, disable,
   duplicate, edit-draft, and delete. Every action is delegated to the
   `@foresift/workflow-runtime` §25.11 surface (`applyScheduleControl`,
   `resolveScheduleConfig`, `validateSchedule`, `enableSchedule`,
   `pauseSchedule`, `resumeSchedule`, `runScheduleNow`, `dryRunSchedule`,
   `disableSchedule`, `duplicateSchedule`, `deleteSchedule`) and the G1
   capacity/cost forecast (`@foresift/capacity-planner`,
   `@foresift/quota-forecast`) — the admin plane resolves, previews, displays,
   and audits; it never re-derives validation, forecast, cron, or lifecycle
   logic.
3. **Global kill switches (FR-ADM-007, §28.13, §35.1).** The six prominent
   controls `DISABLE_ALL_AUTOMATION`, `DISABLE_ALL_MODEL_CALLS`,
   `DISABLE_ALL_PROVIDER_CALLS`, `DISABLE_NOTIFICATIONS`,
   `REVOKE_ALL_MCP_CLIENTS`, `EMERGENCY_READ_ONLY_MODE` are append-only,
   scope-exact, fail-closed, audited, and require fresh phishing-resistant
   step-up. A switch is fail-closed: a missing, unreadable, expired, or
   unknown state resolves to the closed state, and every admin-initiated
   downstream call passes `assertCallAllowed` before it is built.
   `EMERGENCY_READ_ONLY_MODE` refuses every write/automation path while
   preserving read-only intelligence.
4. **Thin, read-only dashboard (FR-ADM-001/003/007, §28.1).** `apps/dashboard`
   is created as a dependency-light, framework-free TypeScript app that renders
   the API read models and the control/kill-switch panels as pure view models
   and HTML strings. It embeds no domain logic, performs GET-only API reads,
   never reaches a provider, and renders unknown/stale state explicitly instead
   of fabricating a value.

Strictly read-only (INV-001): neither the API routes, the dashboard, the `adm`
migrations, nor the tests contain trading, custody, wallet-signing,
private-key, or transaction-submission capability.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is the
  repository test authority. `apps/api/src/routes/admin/**` is an additive
  module inside the existing `@foresift/api` app; `apps/dashboard` is a new
  workspace app (`apps/*` is already a workspace glob) named
  `@foresift/dashboard` with a `bun test` script, a `typecheck` script, a
  tsconfig extending `tsconfig.base.json`, and **no third-party runtime
  dependency** — Bun built-ins plus `@foresift/shared-schemas` only. No
  framework, no bundler, no DOM, no browser test harness; rendering is pure
  string/`Response` production, so the milestone `test -d apps/dashboard &&
pnpm --filter @foresift/dashboard test` gate is satisfied without adding a
  heavyweight toolchain or weakening the repository test authority.
- **Storage**: PostgreSQL via `@foresift/persistence` (`DatabaseEngine` seam);
  tests run on PGlite per ADR-0014. Migrations are the SQL source of truth in a
  dedicated `adm` schema (mirroring the landed `wf`/`alert`/`prod` precedents
  and keeping the AC-261 `public`-schema absence probe green). New migration
  family `adm` — `migrations/g2_adm_*.sql`, additive only; the fail-closed
  family list in `packages/persistence/src/migrator.ts` is extended with `adm`
  and the central expected-script registry
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package (plan-sanctioned scope exception, milestone plan-level decision 1 /
  ADR-0019·ADR-0022 duty). The hand-maintained ADR-001 Drizzle mirror
  (`packages/persistence/src/generated/schema.ts`) catches up to SQL truth in
  the same package — the schema-parity gate enumerates tables and fails on any
  gap.
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). Because `packages/domain/**` is **outside this package's
  writeScopes**, the admin-only closed vocabularies (kill-switch kind and
  state, configuration lifecycle state, control action kind, overview section
  key, system mode) are declared once in `packages/shared-schemas/src/adm.ts`
  and imported by every consumer (D8). Every envelope object is `.strict()`.
- **Consumed seams (never reimplemented)**:
  - durable-workflow (§25.11 control actions, §25.10 reconciliation) —
    `@foresift/workflow-runtime` `applyScheduleControl`, `resolveScheduleConfig`,
    `assertForecastFresh`, `validateCronExpression`, `validateIanaTimezone`,
    `listDeadLetters`, `retryFromLastValidCheckpoint`, outbox/run/schedule row
    reads and the landed `wf.*` tables;
  - alert per-class metrics — `@foresift/alerts` `computeAlertMetric`,
    `computeConfirmedOpportunityMetrics`, `aggregateMetricObservations`,
    `assertNoEarlyWatchInConfirmedDenominator`, and `alert.*` observations;
  - production-readiness capability/activation state — `@foresift/capability-registry`
    `statesFor`/module-state reads, `evaluateActivationGate`/
    `activationGatePassed`, `requiredGatesForActivation`, containment/open-scope
    facts, deployment posture, and `prod.*` rows;
  - G1 capacity/cost forecast for §33.6 — `@foresift/capacity-planner`
    (`CapacityPlanner`, `createCostCapacityComposition`, `degrade-order`) and
    `@foresift/quota-forecast` (`computeCostForecast`, `CostForecast`);
  - security — `@foresift/security` `ActionGate`-class step-up/authorization
    primitives and the landed `sec.*` rights/audit rows;
  - existing API app — `apps/api/src/auth/client-context.ts`,
    `apps/api/src/config.ts`, and the request-handler shape of
    `apps/api/src/main.ts` (consumed, not edited: the mount seam is a named
    out-of-scope integration note, D10).
- **Test runtime**: PGlite-backed suites only; the full Bun suite runs
  exclusively through the coordinator (`pnpm test:all` or per-workload scripts)
  per the test-runtime contract — never a bare full-tree run.

## Constitution check

- **I (contract authority)**: every task traces to FR-ADM-001/003/007 or one of
  the 14 attached ACs (AC-010…014, AC-060…063, AC-260…264); `docs/spec/**`
  untouched; spec.md keeps seeded normative quotes intact.
- **III (simplicity / modular monolith)**: one additive API route module plus a
  dependency-light app; no new service, no second control plane, no
  orchestration framework; the six kill switches reuse the existing security
  step-up primitive and the `admin:high:kill-switch` scope already present in
  `packages/shared-schemas/src/sec.ts`.
- **IV (read-only)**: no execution/custody/signing surface; the overview and
  dashboard are GET-only; negative suites assert absence and no `adm` table
  models an order, transfer, or signature.
- **V/VI (time correctness)**: overview freshness, forecast expiry, kill-switch
  engagement, configuration versioning, and audit records are event-time
  records; state and audit rows are append-only and never backdated.
- **VII (provenance)**: every overview section carries its source package, row
  refs, and freshness; every configuration version carries the owner version id
  and content hash; every switch event and high-impact action carries actor,
  reason, step-up/CSRF/idempotency refs, and before/after evidence.
- **VIII (fail-closed)**: a missing/unreadable/expired/unknown kill-switch state
  resolves closed; a missing forecast, stale configuration, missing step-up, or
  absent audit evidence refuses the control action with a typed error; an
  unknown admin literal refuses at schema parse.
- **IX (abstraction)**: every owner is consumed through its public port; the
  dashboard depends on shared read-model schemas, never on database or provider
  SDKs.
- **X (traceability)**: routes, view models, and telemetry names map to
  FR-ADM-001/003/007 and the shared ACs; the generated-surfaces reconciliation
  keeps `docs/generated/adm-surfaces.json` honest.
- **XI/XII (deterministic + failure-path)**: every authored AC gets positive and
  negative suites; kill-switch refusal, forecast refusal, stale step-up, and
  read-only emergency mode are deterministic failure paths.
- **XIII/XIV (replay, durability)**: kill-switch state, configuration versions,
  resolved previews, overview snapshots, and action audits are persisted and
  replayable; admin state is reconstructible from the append-only tables.
- **XV (least privilege)**: no provider, channel, or model credentials in the
  admin plane; the overview port token forbids egress and the dashboard never
  receives a secret.

## Project structure (files inside writeScopes)

```text
packages/shared-schemas/src/adm.ts            # admin vocabularies + Zod row/read-model envelopes (NEW)
packages/shared-schemas/src/index.ts          # barrel export (EXTEND)
packages/shared-schemas/test/adm.spec.ts      # colocated schema tests (TEST)
migrations/g2_adm_0001_kill_switches.sql      # adm schema: scope-exact switch states + audited events
migrations/g2_adm_0002_configuration_versions.sql # immutable config versions + resolved-config previews
migrations/g2_adm_0003_overview_audit.sql     # overview snapshots + high-impact action audit
apps/api/src/routes/admin/kill-switches.ts    # fail-closed switch resolver + audited engage/disengage
apps/api/src/routes/admin/configuration-control.ts # version lifecycle + resolved preview + §25.11 delegation
apps/api/src/routes/admin/control-safety.ts   # step-up/CSRF/idempotency/reason/audit guard
apps/api/src/routes/admin/overview-sources.ts # read ports over wf/alert/prod/quota/cost/storage owners
apps/api/src/routes/admin/overview.ts         # provider-call-free read model + persisted snapshot
apps/api/src/routes/admin/router.ts           # transport-agnostic /api/v1/admin route table
apps/api/src/routes/admin/mount.ts            # compositional mount seam (no main.ts edit)
apps/api/src/routes/admin/index.ts            # barrel export
apps/dashboard/package.json                   # @foresift/dashboard scaffold, dependency-light (NEW app)
apps/dashboard/tsconfig.json                  # tsconfig extending tsconfig.base.json
apps/dashboard/src/index.ts                   # barrel export
apps/dashboard/src/client.ts                  # GET-only read-model client with injected fetch
apps/dashboard/src/view-models.ts             # pure read-model -> display-model mappers
apps/dashboard/src/render.ts                  # pure escaped HTML renderer (no DOM/framework)
apps/dashboard/src/server.ts                  # optional Bun.serve read-only SSR handler
apps/dashboard/test/*.spec.ts                 # test-owned dashboard suites
telemetry/adm.catalog.json                    # declarative event + metric catalog (NEW)
tests/fixtures/adm/                           # admin fixtures (TEST)
tests/acceptance/AC-010…014, AC-060…063, AC-260…264  # admin-scoped extends (TEST)
tests/negative/AC-010…014, AC-060…063, AC-260…264    # admin-scoped extends (TEST)
```

Plan-sanctioned scope exceptions (exact paths only, named so the task-graph
builder records them): `packages/persistence/src/migrator.ts` (family-list
extension with `adm`), `packages/persistence/src/generated/schema.ts`
(ADR-001 mirror catch-up), `packages/persistence/test/migrator.spec.ts`
(central expected-script registry), `tests/telemetry-catalog.spec.ts` (central
telemetry parity suite), and `docs/generated/**` — concretely
`docs/generated/adm-surfaces.json` (implementation-mapping and telemetry-catalog
reconciliation via the central generator, because `docs/generated/**` is
deliberately excluded from the package writeScopes; milestone plan-level
decision 2).

Fixture-path note: the manifest `fixtureRefs` say `tests/fixtures/adm/` and the
milestone grants `tests/fixtures/adm/**`; they agree, and all fixtures are
written under that single path.

The 14 assigned ACs (AC-010…014, AC-060…063, AC-260…264) are _shared_: every one
is also attached to another family's requirements, and each base
`tests/acceptance` / `tests/negative` file already exists on `main` with that
family's assertions (for example AC-014/AC-063 currently trace to FR-WF-004/
FR-WF-008). This package authors the **admin-scoped additions** into those exact
files (writeScoped `tests/acceptance/**` and `tests/negative/**`), preserving
the landed base assertions; it never re-homes or rewrites another family's suite.

## Architecture decisions

**D1. Admin is a resolve/preview/render/audit plane that delegates every
domain decision to its owner.** `configuration-control.ts` calls the landed
`@foresift/workflow-runtime` §25.11 surface; `overview-sources.ts` reads
`wf.*`/`alert.*`/`prod.*`/quota/cost/storage through the owners' public
functions; the alert metrics come from `computeConfirmedOpportunityMetrics` +
`aggregateMetricObservations`; activation/capability state comes from
`@foresift/capability-registry`; the §33.6 forecast comes from
`@foresift/quota-forecast`/`@foresift/capacity-planner`. The admin package
MUST NOT re-implement cron/timezone validation, resolved-config precedence,
forecast computation, run/dead-letter transitions, alert metric denominators,
or activation gating; a divergence is a defect, and the negative suites assert
delegation by making the owner refuse and the admin surface propagate the typed
refusal unchanged.

**D2. The overview is a pure read model with a structural no-provider guarantee
(FR-ADM-001, §28.2).** `overview.ts` is a total function over injected read
ports plus an injected clock. It has no provider client, no model client, and no
notification channel in scope; the read-port interface exposes no mutating
method. Assembly records, per section, the owning package, row refs, and
freshness, and persists one `adm.overview_snapshots` row whose
`provider_calls_triggered` and `external_write_attempts` are pinned to `0` by
SQL CHECK. A test injects a spy provider port and asserts it is never called and
that a refresh produces exactly one snapshot per call.

**D3. Kill switches are fail-closed, append-only, audited, and gate every
downstream call (FR-ADM-007, §28.13, §35.1).** `kill-switches.ts` resolves the
latest scope-exact state row for each of the six kinds; anything missing,
unreadable, expired, or unknown resolves to the closed state, and
`EMERGENCY_READ_ONLY_MODE` closed means "reads allowed, every write/automation
refused". Engage/disengage appends a new state row plus an event row (never
UPDATE), requires fresh phishing-resistant step-up, an effective authorization
scope, CSRF protection, an idempotency key, a reason, and audit evidence via
`control-safety.ts`, and refuses TOTP-only authentication. `assertCallAllowed`
is the single gate every admin and control-plane downstream call consults before
constructing a provider, model, notification, or MCP-client call; there is no
auto-reactivation and no fail-open path.

**D4. Kill-switch enforcement at foreign call sites is a named port seam, not a
foreign write.** This package owns the authoritative state, the fail-closed
resolution law, the audit, and the `assertCallAllowed` contract. Enforcement at
call sites inside other packages (`NotificationChannelPort`, provider clients,
MCP admission, model router) is provided through the existing ports as an
integration seam recorded in the convergence out-of-scope notes; the admin
package never edits another package's migration or runtime. The negative test
proves the gate refuses when the state is unknown and that the control plane
refuses to build a gated call when a switch is closed.

**D5. Configuration is immutable-version with a stored resolved preview
(FR-ADM-003, §28.3–§28.5).** `adm.configuration_versions` is append-only and
keyed `(config_kind, config_id, version)` with a content hash and a reference to
the owning package's authoritative version row; an edit creates a new DRAFT row
and a supersession link, never an UPDATE. ACTIVATE requires a `VALIDATED`
version, a `APPROVED` gate record, and (for schedules) a fresh §33.6 forecast
for the exact version; `ROLLED_BACK` restores a previously approved immutable
version as a NEW version and preserves history (ADR-0019/AC-279 duty).
`adm.resolved_config_previews` stores the precedence chain and resolved hash so
the preview the operator approved is exactly the configuration the run
receives; `resolveScheduleConfig` computes it, and stale/expired previews refuse.

**D6. High-impact admin actions require the full §35.1 evidence set
(AC-014, AC-063, AC-274-class discipline).** `control-safety.ts` refuses any
enable/pause/resume/run-now/disable/kill-switch/rollback action without fresh
phishing-resistant step-up, exact authorization, CSRF protection, an
idempotency key, a non-empty reason, and an audit record; TOTP-only
authentication is insufficient. The guard reuses the `admin:high:*` scope
vocabulary already landed in `packages/shared-schemas/src/sec.ts` instead of
inventing a second authorization model, and every refusal is typed and audited.

**D7. The dashboard renders API read models and holds no domain logic
(FR-ADM-001/003/007, §28.1).** `apps/dashboard` is dependency-light:
`client.ts` is GET-only against the admin surface, validates responses with the
shared Zod read-model schemas, and delegates all formatting to
`view-models.ts`; `render.ts` produces escaped HTML strings. It computes no
metric, gate, forecast, or switch decision of its own; an unknown, stale, or
refused read model renders explicit `UNKNOWN`/`STALE`/`REFUSED` markers rather
than a fabricated value. No framework, bundler, DOM, or provider SDK is
introduced, so the app is exercised by `bun test` over pure functions and
`Request`/`Response` without a browser harness and without weakening the
existing gates.

**D8. Admin-only closed vocabularies live in `packages/shared-schemas`, recorded
as a bounded deviation from milestone plan-level decision 3.** Milestone
plan-level decision 3 places shared closed vocabularies in `packages/domain`,
but `packages/domain/**` is outside this package's writeScopes. The admin
literals are therefore declared once, as const objects with compile-linked Zod
refinements, in `packages/shared-schemas/src/adm.ts`, and are imported by the
API routes, the dashboard, and the telemetry catalog. The future extraction of
these literals into `packages/domain` is recorded as an out-of-scope note; no
consumer restates them in the meantime.

**D9. Admin state lives in a dedicated `adm` schema.** Mirroring
ADR-G2WF-1/ADR-G2ALERT-1/ADR-G2PROD-1, `adm.*` tables are additive in their own
schema; no unqualified admin table is created in `public` (keeps the AC-261
probe green and gives the recovery package stable qualified names). Foreign
state (workflow runs, dead letters, alerts, capability states, capacity
contracts, backup evidence) is referenced by id or read through its owner,
never duplicated.

**D10. The admin router is transport-agnostic and mounted through an exported
seam.** `router.ts` exports typed route resolution plus a pure
`handleAdminRequest(deps, request)`; `mount.ts` composes it with an existing API
request handler. Because `apps/api/src/main.ts` and `apps/api/package.json` are
outside the package writeScopes, wiring the mount call and declaring the
additional workspace dependencies are named out-of-scope integration notes for
the API-surface owner; the router itself is fully exercised by the AC suites
through direct handler invocation, so no gate depends on the unwired file.

## Data model (adm schema; additive tables only)

- `adm.kill_switch_states` (state_row_id PK, switch_kind CHECK over the six
  §28.13 kinds, scope JSONB, state CHECK `ENGAGED|DISENGAGED`, reason,
  actor_ref, step_up_ref, audit_ref, superseded_by, created_at; append-only — no
  UPDATE path for state/scope; unique `(switch_kind, scope_hash)` open row).
- `adm.kill_switch_events` (event_id PK, switch_kind, from_state, to_state,
  reason, actor_ref, step_up_ref, csrf_ref, `idempotency_key` UNIQUE,
  audit_ref, occurred_at; append-only, immutable).
- `adm.configuration_versions` (config_version_id PK, config_kind CHECK
  `PROMPT|AGENT_PROFILE|MODEL_PROFILE|TOOL_PROFILE|WORKFLOW|FEATURE_DEFINITION|
RANKING_POLICY|OUTCOME_PROFILE|ALERT_POLICY|SCHEDULE`, config_id, version,
  `owner_version_ref`, `config_hash sha256:<hex>`, lifecycle_state CHECK
  `DRAFT|VALIDATED|APPROVED|ACTIVE|DEPRECATED|ROLLED_BACK`,
  resolved_config JSONB, `resolved_config_hash sha256:<hex>`, superseded_by,
  rolled_back_from, approved_by_ref, created_at; unique
  `(config_kind, config_id, version)`; no UPDATE of content or state — a change
  is a new row).
- `adm.resolved_config_previews` (preview_id PK, config_version_id, precedence
  JSONB ordered `SYSTEM_DEFAULTS < WORKFLOW_VERSION < AGENT_PROFILE_VERSION <
SCHEDULE_VERSION < RUN_NOW_OVERRIDE`, `resolved_hash sha256:<hex>`,
  computed_at, expires_at; immutable).
- `adm.overview_snapshots` (snapshot_id PK, generated_at, source_refs JSONB,
  section_hashes JSONB, `read_model_hash sha256:<hex>`,
  `provider_calls_triggered` integer CHECK `= 0`,
  `external_write_attempts` integer CHECK `= 0`; immutable).
- `adm.admin_action_audit` (action_id PK, action_kind CHECK
  `CONFIG_VALIDATE|CONFIG_ACTIVATE|CONFIG_ROLLBACK|SCHEDULE_ENABLE|
SCHEDULE_PAUSE|SCHEDULE_RESUME|SCHEDULE_RUN_NOW|SCHEDULE_DRY_RUN|
SCHEDULE_DISABLE|SCHEDULE_DELETE|KILL_SWITCH_ENGAGE|KILL_SWITCH_DISENGAGE`,
  target_ref, target_version_ref, actor_ref, `step_up_ref`, `csrf_ref`,
  `idempotency_key` UNIQUE, reason NOT NULL, before_hash, after_hash,
  audit_ref, recorded_at; append-only, immutable, successful and refused alike).

## Verification strategy per acceptance criterion

- **AC-014** (admin can validate, enable, pause, resume, run-now, dry-run, and
  disable a schedule): positive — the admin control plane's action handlers
  drive the full §25.11 lifecycle through `applyScheduleControl` on real SQL,
  each action returns the workflow owner's typed status, the dashboard renders
  the action set and the resulting status, and the immutable version is retained
  across an edit; negative — an admin action against a disabled schedule, an
  invalid cron/timezone, a stale step-up, a missing idempotency key, or a
  missing reason is refused typed with no state change, and a dry-run commits no
  run, no outbox row, and no opportunity influence.
- **AC-063** (cost forecast is displayed before schedule enable): positive — the
  admin enable preview displays the §33.6 forecast (runs/day, provider calls/
  day, model tokens/day, estimated model spend/day, quota exhaustion date,
  storage growth/month) with forecast id, hash, and `computedAt`, the operator
  must confirm the displayed forecast, and the persisted `wf.schedule_forecasts`
  row matches the displayed hash exactly; negative — enable with an absent,
  stale, future-dated, malformed, or superseded-version forecast is refused
  typed, the schedule stays DRAFT, and no forecast row is persisted.
- **AC-010** (duplicate scheduler deliveries create exactly one logical run):
  admin-scoped positive — the control plane's enable/run-now path routes through
  the trigger inbox so a duplicate delivery still yields one run; negative — a
  retried admin request with the same idempotency key creates no second run.
- **AC-011** (crash after decision commit but before Telegram sends exactly one
  notification): admin-scoped positive — the overview reports outbox/delivery
  counts from the engine's outbox and the kill-switch `DISABLE_NOTIFICATIONS`
  state gates the delivery side without duplicating the committed decision;
  negative — a replayed admin refresh or control action emits no notification of
  its own.
- **AC-012** (stale worker cannot commit after lease fencing changes): admin
  positive — the kill-switch and control surfaces read lease/fencing state and
  never reset it; negative — an admin run-now cannot resurrect a
  fenced/stale run, and the owner's typed refusal propagates unchanged.
- **AC-013** (active runs continue with their original immutable config/workflow
  version after deployment): positive — an edit creates a new configuration
  version while an active run keeps its resolved version and preview; negative —
  an in-place mutation of an ACTIVE version or a preview reuse for a different
  version is refused at schema and SQL level.
- **AC-060** (internal overhead targets met): positive — assembling the overview
  from injected read ports plus the control-plane delegation stays within the
  declared internal overhead budget on the benchmark workload, and the snapshot
  records zero provider calls and zero external writes; negative — an overview
  or action path that reaches a provider/model/notification port fails the
  no-egress assertion.
- **AC-061** (provider outage returns explicit partial/insufficient output and
  suppresses unsafe automated alerts): positive — the overview renders provider
  incidents and stale/insufficient sections explicitly with quality codes and
  the capability/degradation state from `@foresift/capability-registry`, and
  does not silently substitute cached certainty; negative — a forced provider
  incident cannot be rendered as a fresh complete section, and confirmed
  opportunity availability is suppressed per the owner's degradation state.
- **AC-062** (backup restore meets RPO/RTO in a drill): positive — the overview's
  storage/latest-backup status section consumes the recovery owner's drill and
  backup evidence (RPO/RTO tier, drill artifact, audit-chain check, resume
  blockers) and surfaces it without recomputing; negative — a missing, stale, or
  failed backup/drill evidence renders `UNKNOWN`/blocked rather than an
  optimistic status.
- **AC-260** (destructive restore drill meets the tiered RPO or blocks active
  opportunity mode): admin positive — the overview surfaces the measured RPO
  per tier and the automation-resume blocker, and the kill switch
  `DISABLE_ALL_AUTOMATION` can be engaged while a restore is incomplete;
  negative — the admin plane cannot report active automation while a tier
  objective is unmet.
- **AC-261** (clean restore verifies hashes, migrations, audit chain,
  cross-store references, workflow/inbox/outbox, quota reservations, collector
  checkpoint/gaps before automation resumes): positive — the overview's recovery
  readiness section lists each verification result and the admin resume gate
  consults it; negative — a failed or missing verification keeps automation
  paused and the `adm` tables remain in their own schema with no unqualified
  `public` table.
- **AC-262** (tier failure degrades the affected capability and prevents
  confirmed opportunity alerts while preserving safe deterministic risk
  monitoring): positive — the overview mirrors the capability registry's
  `DEGRADED`/`PAUSED` state and the kill-switch panel exposes the safe
  deterministic monitoring path; negative — the admin plane cannot force an
  affected capability back to `ACTIVE`, and no auto-reactivation is possible.
- **AC-263** (collector recovery neither skips an unmarked gap nor duplicates a
  canonical event): admin positive — the overview reports collector/checkpoint
  gap and duplicate diagnostics read from the owning package; negative — the
  admin plane cannot mark a gap resolved or mutate a checkpoint/event row.
- **AC-264** (backup retention, encryption, location, rights, legal hold,
  deletion, key access, restore credentials validated by policy tests): positive
  — the overview's storage/backup section displays the policy validation result
  and evidence refs from the recovery owner; negative — a failed or absent
  policy validation renders blocked/`UNKNOWN` and never a green status.

## Risks and mitigations

- Admin re-implementing domain logic (forecast, cron, gates, metrics): every
  owner call is a public function of an already-PROVEN package, the negative
  suites force the owner's typed refusal through unchanged, and no `adm` table
  stores a duplicate of an owner's authoritative value.
- Overview silently triggering provider spend: the assembly port interface has
  no provider/model/channel method, a spy port proves non-invocation, and the
  persisted snapshot's zero counters make a violation auditable; a conformance
  rule and a negative test both fail a live path that egresses.
- Kill switch fail-open or bypass: absence/unreadability resolves to the closed
  state, state rows are append-only, the action guard is total, and every
  refusal is audited; there is no automatic reactivation.
- Secret or stack-trace leakage through the admin surface or dashboard:
  responses are schema-validated typed envelopes, the renderer escapes all
  strings, and a test asserts no credential/stack field is emitted.
- Shared-AC collision with the workflow/recovery families: all extends are
  additive and preserve the landed base assertions; the package runs serialized
  (`parallelizable: false`) because `packages/shared-schemas/**`, the AC files,
  and the telemetry suite are shared surfaces.
- Dashboard toolchain creep: the app is framework-free, bundler-free,
  DOM-free, and dependency-light by decision (D7); the only gate is
  `pnpm --filter @foresift/dashboard test`, which runs pure functions and
  `Request`/`Response` under Bun Test.
- WriteScope gaps: dependency declarations in `apps/api/package.json`, the
  mount call in `apps/api/src/main.ts`, the `packages/domain` extraction of
  admin literals, and foreign kill-switch call-site wiring are outside this
  package's writeScopes and are recorded as out-of-scope integration notes
  during convergence rather than worked around.
- Scope bleed into the remaining FR-ADM family (Agent Workbench, Candidate
  Radar, frozen-run investigation, evaluation/Missed Gems UI, admin chat) and
  the §28.11 advanced-intelligence views: those belong to G3/G4 packages; the
  overview exposes only the FR-ADM-001/003/007 read model and gaps go to the
  out-of-scope notes.

## ADR texts (proposed; accepted under `docs/adr/0027-admin-control-laws.md`)

**ADR-G2ADM-1 — `adm`-schema table home for admin control state.** Kill-switch
states/events, immutable configuration versions, resolved-configuration
previews, overview snapshots, and high-impact action audits live in a dedicated
`adm` PostgreSQL schema (not `public`), mirroring the `wf`/`alert`/`prod`
precedents. Rationale: the landed AC-261 probe asserts absence of unqualified
tables on clean restores, and the recovery package needs stable qualified names.
Future packages MUST NOT create unqualified admin tables in `public`.

**ADR-G2ADM-2 — kill switches are fail-closed, append-only, audited, and gate
every downstream call.** The six global switches resolve to the closed state
when state is missing, unreadable, expired, or unknown; engagement and release
append records with fresh phishing-resistant step-up, CSRF protection,
idempotency, reason, and audit; there is no fail-open or automatic
reactivation, and `EMERGENCY_READ_ONLY_MODE` blocks every write/automation while
preserving read-only intelligence. Rationale: formalizes FR-ADM-007/§28.13/§35.1
so an admin control can never be the weakest link.

**ADR-G2ADM-3 — the overview is a provider-call-free read model over owning
packages.** The overview is a total function over injected read ports plus a
clock, with no provider, model, or notification capability in scope; every
section names its owning package and freshness, and each snapshot is persisted
with zero provider calls and zero external writes. Rationale: §28.2 forbids a
dashboard refresh from triggering external provider calls, and this makes the
property structural and auditable.

**ADR-G2ADM-4 — the configuration control plane owns the immutable-version
lifecycle and resolved preview, but delegates every schedule decision.** Edits
always create a new immutable version; ACTIVATE requires a validated/approved
version and, for schedules, a fresh §33.6 forecast bound to the exact version;
the resolved configuration with its precedence chain is stored and the run
receives exactly that configuration. Cron/timezone validation, forecasting, and
schedule control are delegated to `@foresift/workflow-runtime`,
`@foresift/capacity-planner`, and `@foresift/quota-forecast`. Rationale:
formalizes FR-ADM-003/§28.3–§28.5 without duplicating the durable substrate.

**ADR-G2ADM-5 — the dashboard is a dependency-light, read-only renderer of API
read models.** `apps/dashboard` holds no domain logic, performs GET-only reads,
validates read models with the shared schemas, renders unknown/stale/refused
state explicitly, and introduces no framework, bundler, DOM, or provider SDK.
Rationale: FR-ADM-001/003/007/§28.1 require an operator surface that cannot
become a second decision engine or an egress path.

**ADR-G2ADM-6 — admin-only closed vocabularies are declared in
`packages/shared-schemas` while `packages/domain` is outside the writeScopes.**
Bounded, recorded deviation from milestone plan-level decision 3: the six
kill-switch kinds, configuration lifecycle states, control action kinds,
overview section keys, and system modes are declared once in
`packages/shared-schemas/src/adm.ts`, imported by every consumer, and flagged
for later extraction into `packages/domain`. Rationale: the package cannot write
`packages/domain/**`, and a second restatement of the literals would be worse
than a single documented home.

## Verification commands (package scope)

```bash
test -d apps/dashboard && pnpm --filter @foresift/dashboard test
bun test tests/acceptance/AC-014.spec.ts tests/acceptance/AC-063.spec.ts
bun test tests/negative/AC-014.negative.spec.ts tests/negative/AC-063.negative.spec.ts
```

plus `pnpm verify` and `pnpm spec:verify` at the pushed HEAD per the
completion standard (run by the implementation loop, not this plan).
