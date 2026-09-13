# Implementation Plan: g2-alert-lifecycle

**Package**: `g2-alert-lifecycle` | **Date**: 2026-09-12 | **Spec**: `specs/g2-alert-lifecycle/spec.md` (scoped derivative of PRD §26 in full, the §26.5 commit boundary, §26.9, §9.2/§9.5/§9.6, and the §33.1/§33.2/§33.9/§34.3/§34.4 envelopes + manifest FR-ALERT-001…005)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the alert lifecycle as ONE new classification/content package
plus additive extensions, consuming the landed `g2-durable-workflow`
substrate (`RUNNING`, migrations `g2_wf_0001…0005` on `main`):

**The alert classification/content layer sits on top of the engine's
atomic commit boundary.** `packages/workflow-runtime/src/outbox.ts`
`commitDecisionWithOutbox` commits the decision + alert record + outbox
entry in ONE transaction, and `channels.ts` `NotificationChannelPort`
delivers idempotently by `idempotencyKey`. The engine guarantees
atomicity and delivery; this package defines what a valid classification
is (durable-workflow plan **D1**, milestone plan-level decision 6). No
module here re-implements the outbox, delivery workers, leases, retries,
dead letters, or channels.

1. **Separate class policies, content, TTL, metrics (FR-ALERT-001,
   AC-140)** — the §26.2 closed vocabulary `EARLY_WATCH`,
   `CONFIRMED_OPPORTUNITY`, `THESIS_STRENGTHENING`, `THESIS_WEAKENING`,
   `OPPORTUNITY_EXPIRED`, `RISK_ALERT`; one immutable policy version per
   class (TTL, cooldown, material-change thresholds, content policy,
   denominator membership) so the six classes have genuinely separate
   policies, content, TTL, metrics and denominators.
2. **EARLY_WATCH discipline (FR-ALERT-002)** — short TTL; the renderer
   MUST display explicit missing data and MUST reject high-conviction or
   buy language; EARLY_WATCH is excluded from the confirmed-opportunity
   precision denominator.
3. **CONFIRMED_OPPORTUNITY deterministic gates (FR-ALERT-003)** — the
   full §26.3 set as a total ordered gate function: decision `ALERT`,
   critical-risk absence, profile eligibility, minimum data coverage,
   minimum independent evidence groups, market/security/holder freshness,
   semantic validation, unresolved-conflict threshold, fingerprint/
   cooldown, daily/schedule budget, execution-aware tradability for the
   configured notional and delay, alert expiry / `valid_until`
   actionability, deterministic Solana security checks (or an approved
   profile fallback), and `STRICT_FREE` cost policy. Any unavailable
   required input fails closed.
4. **Update/expiry lifecycle (FR-ALERT-004, AC-141)** — material
   deterioration, cancellation, or expiry of a prior actionable alert
   emits an explicit update/cancellation notification, idempotent under
   the §26.4 fingerprint plus per-class cooldown, committed through the
   engine boundary.
5. **Per-class metrics and denominators (FR-ALERT-005)** — class-scoped
   numerator/denominator definitions with sample size; EARLY_WATCH is
   never pooled into confirmed precision or recall.
6. **Opportunity content completeness (§26.2/§26.7/§26.8, FR-ALERT-001)**
   — every opportunity-related notification embeds `valid_until`,
   `actionability_state`, configured notional, modeled entry/exit impact,
   cancellation state, evidence timestamp, execution assumptions, and
   the link to the frozen run/evidence.

Plus additive extensions: `packages/domain/src/alert.ts` +
`packages/shared-schemas/src/alert.ts` vocabularies/schemas, the `alert`
migration family (`migrations/g2_alert_*.sql` in a dedicated `alert`
schema), fixtures `tests/fixtures/alerts/`, telemetry
`telemetry/alert.catalog.json`, and the FR-ALERT-owned AC-140/AC-141
suites (positive and negative), with alert-scoped extends of the shared
AC-142/AC-143 and AC-245…249 suites (base suites stay with their
owners — FR-SOC/G5 and the G0/G1 core/data/eval/mat/obj families).

Strictly read-only (INV-001): no trading, custody, wallet-signing,
private-key, or transaction-submission capability anywhere in the
package, migrations, renderer, or tests.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority. New package `packages/alerts`
  (`@foresift/alerts`) follows the G0/G1/G2 scaffold pattern: workspace
  `*` dependencies on `@foresift/domain`, `@foresift/shared-schemas`,
  `@foresift/persistence`, and `@foresift/workflow-runtime`; `bun test`
  script; tsconfig extending `tsconfig.base.json`; no per-package runner
  config.
- **Storage**: PostgreSQL schema via `@foresift/persistence`
  (`DatabaseEngine` seam); tests run on PGlite per ADR-0014. Migrations are
  the SQL source of truth in a dedicated `alert` schema (mirroring the
  `wf` schema precedent and keeping the landed AC-261 `public`-schema
  absence probe green). New migration family `alert` — `g2_alert_*.sql`,
  additive only; the fail-closed family list in
  `packages/persistence/src/migrator.ts` is extended with `alert` and the
  central expected-script registry
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package (plan-sanctioned scope exception, milestone plan-level
  decision 1 / ADR-0019·ADR-0022 duty). The hand-maintained ADR-001
  Drizzle mirror (`packages/persistence/src/generated/schema.ts`) catches
  up to SQL truth in the same package — the schema-parity gate enumerates
  tables and fails on any gap.
- **Validation**: Zod schemas authoritative in `packages/shared-schemas`
  (ADR-0013). Closed vocabularies (alert class, update kind, actionability
  state, lifecycle/risk state, social capability state, metric keys) live
  in `packages/domain` and are imported, never restated, by
  `packages/shared-schemas` (milestone plan-level decision 3). Every
  envelope object is `.strict()`.
- **Engine seam**: this package depends on the `@foresift/workflow-runtime`
  public surface — `commitDecisionWithOutbox`, `NotificationChannelPort`,
  `OutboxCommitOutcome`, and the `ShadowInfluenceKind` choke point. The
  alert package supplies an already-classified, Zod-validated alert
  record and a rendered payload; the engine owns transactional commit and
  crash-safe exactly-once delivery (§26.5).
- **Test runtime**: PGlite-backed suites only; the full Bun suite runs
  exclusively through the coordinator (`pnpm test:all` or per-workload
  scripts) per the test-runtime contract — never a bare full-tree run.

## Constitution check

- **I (contract authority)**: every task traces to FR-ALERT-001…005 or one
  of the 9 attached ACs; `docs/spec/**` untouched; spec.md keeps seeded
  normative quotes intact.
- **III (simplicity)**: one classification/content package + additive
  vocabularies, schemas, migrations, and telemetry; no re-implementation
  of the durable engine, no orchestration framework, no new services.
- **IV (read-only)**: the package has no execution/custody/signing
  surface; negative suites assert its absence and the `alert` schema
  introduces no order/transfer table.
- **V/VI (time correctness)**: TTL/expiry decisions use injected clocks;
  stale `valid_until` becomes expired/suppressed, never sent late
  (§33.9); update notifications never backdate.
- **VII (provenance)**: every alert/content record carries the §26.4
  fingerprint, decision/run ref, evidence links, and content hash.
- **VIII (fail-closed)**: an unavailable gate input, missing social
  capability, unknown class, or unmapped policy version refuses with a
  typed error; confirmed-opportunity notifications are suppressed rather
  than degraded (§34.3).
- **IX (abstraction)**: delivery stays behind `NotificationChannelPort`;
  the alert package depends on the port, never a vendor SDK.
- **XII (positive + failure-path)**: every authored AC gets both suites;
  gate refusals, cooldown collapse, immaterial no-op, expiry, and
  duplicate-delivery paths are failure-path tested.
- **XIII/XIV (replay, durability)**: idempotent update keys, fingerprint
  dedupe, and persisted state; planning state itself lives on disk/git.
- **XV (least privilege)**: no channel credentials, no provider secrets;
  renderer input is data-only.

## Project structure (files inside writeScopes)

```text
packages/domain/src/alert.ts             # closed vocabularies + pure laws (NEW)
packages/domain/src/index.ts             # barrel export (EXTEND)
packages/shared-schemas/src/alert.ts     # Zod mirrors + row/content envelopes (NEW)
packages/shared-schemas/src/index.ts     # barrel export (EXTEND)
packages/alerts/                         # classification/content package (NEW)
  src/policies.ts                        # per-class immutable policy registry + TTL/cooldown
  src/gates.ts                           # §26.3 confirmed-opportunity gate set (total, ordered, fail-closed)
  src/classification.ts                  # classify decision+evidence into one §26.2 class (or suppress)
  src/content.ts                         # class-specific renderer; EARLY_WATCH language law; missing data
  src/fingerprints.ts                    # §26.4 fingerprint + material-change thresholds + cooldown ledger
  src/lifecycle.ts                       # deterioration/cancellation/expiry updates for actionable priors
  src/metrics.ts                         # per-class numerator/denominator separation + sample size
  src/commit.ts                          # thin adapter over the engine §26.5 commit boundary + channel port
  src/index.ts
migrations/g2_alert_0001_alert_state.sql # alert schema: policies, alert records, fingerprints
migrations/g2_alert_0002_updates_metrics.sql # update notifications, per-class metric observations
telemetry/alert.catalog.json             # declarative event + metric catalog (NEW)
tests/fixtures/alerts/                   # gate/content/lifecycle/fingerprint fixtures (NEW)
tests/acceptance/AC-140.spec.ts          # authored positive suites (NEW)
tests/acceptance/AC-141.spec.ts
tests/negative/AC-140.negative.spec.ts   # authored negative suites (NEW)
tests/negative/AC-141.negative.spec.ts
tests/acceptance + tests/negative AC-142/143, AC-245…249  # alert-scoped extends (EXTEND)
```

Plan-sanctioned scope exceptions (exact paths only, named so the
task-graph builder records them): `packages/persistence/src/migrator.ts`
(family-list extension with `alert`), `packages/persistence/src/generated/
schema.ts` (ADR-001 mirror catch-up), `packages/persistence/test/
migrator.spec.ts` (central expected-script registry), and
`tests/telemetry-catalog.spec.ts` (central telemetry parity suite).

Fixture-path ambiguity (resolved): the manifest's seeded `fixtureRefs`
say `tests/fixtures/alert/` (singular) while the milestone `writeScopes`
grant `tests/fixtures/alerts/**` (plural). Implementation writes fixtures
under the writeScoped plural path `tests/fixtures/alerts/`; the manifest
reference is treated as a declaration alias, not a second directory.

## Architecture decisions

**D1. Alert defines classification; the engine owns the commit
boundary.** `classification.ts` + `gates.ts` + `content.ts` produce an
already-classified, Zod-validated `AlertRecordInput` plus rendered
payload. `commit.ts` calls the engine's `commitDecisionWithOutbox`
(injecting `ShadowInfluenceKind.OPPORTUNITY_NOTIFICATION`) and the engine
commits decision + alert + outbox atomically and delivers exactly once.
This package MUST NOT write outbox rows directly or reimplement
delivery/retry/dead-letter logic (durable plan D1, milestone plan-level
decision 6). The alert package may open ONE enclosing transaction for its
own writes: `commitAlertUpdate` wraps the `alert.alert_updates` row, the
fingerprint/cooldown ledger advance, and the engine commit so a failure
inside the engine commit rolls the alert-owned writes back with it; the
engine re-enters that transaction as a nested SAVEPOINT and still owns
commit/rollback and exactly-once delivery (ADR-0025 decision 2, proven by
the injected-failure rollback test). The read/classify/commit adapter
`commitAlert` opens no transaction of its own.

**D2. One immutable policy version per alert class.** Policies are
data/DB rows keyed `(alert_class, version)`; `alertPolicyFor(class)`
is a total pure function over the six §26.2 classes and refuses an
unknown class with a stable typed error. Policies are never mutated in
place — a changed policy is a new row (ADR-0019 immutability duty). This
is what makes AC-140's "separate policies" real rather than cosmetic.

**D3. TTL is per class, and EARLY_WATCH TTL is short.** The policy
carries `ttl_seconds` and `cooldown_seconds`; EARLY_WATCH's TTL is
strictly shorter than CONFIRMED_OPPORTUNITY's and is asserted as a
policy invariant (AC-140). Expiry is evaluated against the injected
clock, and an alert past `valid_until` is expired/suppressed, never
delivered late (§33.9).

**D4. CONFIRMED_OPPORTUNITY is a total ordered gate function.** Each
§26.3 condition is a named gate returning `PASS` or a typed refusal with
the failing gate id; the classification is CONFIRMED_OPPORTUNITY only if
every gate passes. Missing inputs fail closed. The gate function consumes
gate results (tradability assessment, security checks, cost-policy
result, freshness, expiry) as inputs; it never recomputes execution,
security, or cost logic owned by other layers.

**D5. Fingerprint plus material-change threshold plus cooldown governs
repeats.** The §26.4 fingerprint is exactly `asset_id`, `profile_id`,
`alert_type`, `lifecycle_state`, `risk_state`, `thesis_version`,
`execution_scenario_id`, `valid_until_generation`, and the material
evidence fingerprint. A repeat is allowed only when severity, thesis, or
material evidence changes beyond the per-class thresholds; otherwise the
commit path suppresses the duplicate. Update notifications carry an
idempotency key derived from `(prior_alert, update_kind, fingerprint,
thesis_version)` so a replay collapses to one notification (AC-141).

**D6. Content is class-templated and the EARLY_WATCH language law is
enforced mechanically.** `content.ts` selects the template from the
class policy, injects explicit missing-data fields, and runs a
deterministic high-conviction/buy-language check that refuses or
rewrites EARLY_WATCH content (FR-ALERT-002). Opportunity templates
require `valid_until`, `actionability_state`, configured notional,
modeled entry/exit impact, cancellation state, evidence timestamp,
execution assumptions, and the frozen run/evidence link, and suppress
any positive headline when the body contains a critical contradiction or
failed required delay/stress scenario (§26.8).

**D7. Metrics and denominators are separated by class.** `metrics.ts`
emits per-class observations with explicit numerator, denominator, and
sample size. The confirmed-opportunity precision/recall denominator
never includes EARLY_WATCH; a cross-class pooled metric is refused
(FR-ALERT-005, AC-140). Metric observations are class-scoped rows, so
per-class rates remain reconstructible.

**D8. Social capability is an input; SOCIAL_UNAVAILABLE is unknown
coverage.** The alert layer consumes the §26.1 social capability state.
When it is `SOCIAL_UNAVAILABLE` (or otherwise absent), the content
renders it as missing data, it cannot reduce opportunity score, prove
lack of interest, satisfy organic confirmation, or block a profile
without an explicit approved fallback (§67.4, AC-142 contribution), and
the classification never treats it as a negative social feature. Social
adapters and the `FR-SOC` runtime stay owned by G5.

**D9. Alert state lives in a dedicated `alert` schema.** Mirroring
ADR-G2WF-1, `alert.*` tables are additive in their own schema; no
unqualified alert table is created in `public` (keeps the AC-261 probe
green and gives the admin/recovery packages stable qualified names).

## Data model (alert schema; additive tables only)

- `alert.alert_policies` (policy_id PK, alert_class, version,
  `config_hash sha256:<hex>`, immutable `config` JSONB, `ttl_seconds`,
  `cooldown_seconds`, `high_conviction_allowed`, `confirmed_denominator`
  flag, thresholds JSONB, superseded_by, created_at; unique
  `(alert_class, version)`).
- `alert.alert_records` (alert_id PK, decision_ref, run_ref, alert_class,
  `fingerprint sha256:<hex>`, thesis_version, lifecycle_state, risk_state,
  severity, actionability_state, valid_until, execution_assumptions JSONB,
  evidence_refs JSONB, `content_hash sha256:<hex>`, supersedes_alert_id,
  created_at; no UPDATE path for classification fields).
- `alert.alert_fingerprints` (fingerprint PK, alert_class, last_alert_id,
  last_severity, last_thesis_version, `last_material_evidence_hash`,
  last_delivered_at, cooldown_until, updated_at).
- `alert.alert_updates` (update_id PK, prior_alert_ref, update_kind
  CHECK `MATERIAL_DETERIORATION|CANCELLATION|EXPIRY|RISK`, fingerprint,
  idempotency_key UNIQUE, alert_ref, outbox_ref, created_at).
- `alert.alert_metric_observations` (metric_id PK, alert_class, metric_key,
  numerator, denominator, sample_size, window_start, window_end,
  observed_at; CHECK denominator >= 0 and class-scoped metric keys).

## Verification strategy per acceptance criterion

- **AC-140** (separate policies/content/TTL/metrics/denominators):
  positive — the two classes resolve to different immutable policy rows
  with different TTL/cooldown, render through different templates, and
  produce separate metric numerator/denominator rows with sample size;
  negative — an unknown/mismatched class is refused, the confirmed
  template applied to EARLY_WATCH is refused, and a pooled cross-class
  denominator is refused.
- **AC-141** (material invalidation/expiry → idempotent update):
  positive — material deterioration, cancellation, and expiry of an
  actionable prior alert each create exactly one update/cancellation
  notification through `commitDecisionWithOutbox`; a replayed update
  collapses on its idempotency key and a crashed delivery re-sends
  exactly once via the engine; negative — a below-threshold change and a
  non-actionable/expired prior alert produce no update, and two updates
  inside cooldown collapse to one.
- **AC-142** (alert-scoped contribution to the shared FR-SOC/G5 suite):
  positive — an absent/paid-unavailable social capability input yields an
  alert content record that explicitly carries `SOCIAL_UNAVAILABLE` and
  is treated as unknown coverage; negative — the classification refuses
  to derive a negative social feature or an organic-confirmation claim
  from `SOCIAL_UNAVAILABLE`, and it cannot block a profile without an
  explicit approved fallback. The base AC-142 suite stays owned by
  FR-SOC/G5; this package contributes the alert-side extend.
- **AC-143** (alert-scoped contribution): positive — the alert layer only
  consumes capability states from the approved input envelope and never
  enables or references a scraping/private-endpoint adapter; negative —
  an alert input or model request attempting to enable an unauthorized
  adapter is refused by schema validation and by the classification
  input contract. Base suite stays with FR-SOC/G5.
- **AC-245…249** (alert-scoped extends of the existing shared suites):
  the confirmed-opportunity gate consumes the independence/evidence
  inputs rather than re-deriving them, so a confirmation whose evidence
  groups are empirically dependent (AC-245), whose gate depends on
  duplicated lineage (AC-246), whose retrospective dependence estimate
  would alter a frozen historical evidence count (AC-247), whose mature
  success/failure/risk counts or effective sample size are below
  registered thresholds (AC-248), or whose placebo/leakage controls show
  unexplained lift (AC-249) cannot be classified as
  CONFIRMED_OPPORTUNITY. The existing `tests/acceptance/AC-245…249.spec.ts`
  and negative files stay green and stay owned by their G0/G1 families.
- **§33.1/§33.9** (delivery latency and decision budget): a positive
  performance assertion that the classification+content+commit path adds
  bounded internal overhead and that an alert whose actionability budget
  is exceeded is expired/suppressed instead of delivered late.

## Risks and mitigations

- Class-boundary drift: every class decision and every gate refusal is a
  typed, telemetry-emitting outcome, so a mis-route is observable rather
  than silent; classification is a pure function over validated inputs.
- Overclaim on early-watch: the language law is mechanical and tested
  both ways (positive content accepted, high-conviction wording refused),
  not a documentation convention.
- Gate weakening under partial data: the gate set is total and
  fail-closed; partial provider/security/cost input refuses the
  classification instead of degrading to EARLY_WATCH.
- Notification storm or missed update: fingerprint + material threshold
  - per-class cooldown bound repeats; the engine's idempotent channel and
    outbox ensure a crash cannot duplicate or lose an update.
- Missing social capability read as negative evidence: `SOCIAL_UNAVAILABLE`
  is modeled as unknown coverage and asserted not to affect score,
  confirmation, or blocking without an approved fallback.
- Scope bleed into social/admin/recovery logic: the alert package only
  defines classification/content/policy/metrics and refuses foreign
  domain logic; gaps go to `out-of-scope-notes.md`.

## ADR texts (accepted in `docs/adr/0025-alert-lifecycle-laws.md`)

**ADR-G2ALERT-1 — `alert`-schema table home for alert state.**
Alert policies, alert records, fingerprints, update notifications, and
per-class metric observations live in a dedicated `alert` PostgreSQL
schema (not `public`), mirroring the `wf` schema precedent
(ADR-G2WF-1). Rationale: the landed AC-261 probe asserts absence of
unqualified workflow/alert tables on clean restores, and the
admin/recovery packages get stable qualified names. Future packages MUST
NOT create unqualified alert tables in `public`.

**ADR-G2ALERT-2 — the alert package consumes the engine commit
boundary.** Alert classification, content, TTL, and per-class metrics
are owned by `packages/alerts`; transactional commit, exactly-once
delivery, retry, and dead letters remain owned by
`packages/workflow-runtime`. The alert layer hands a validated
classified record to `commitDecisionWithOutbox` and never commits
side effects itself. Rationale: formalizes durable-workflow plan D1 and
milestone plan-level decision 6 so neither package re-implements the
other's guarantee.

**ADR-G2ALERT-3 — SOCIAL_UNAVAILABLE is unknown coverage, not negative
evidence.** Within the alert layer, a missing or paid-unavailable social
capability is rendered as explicit missing data and can never reduce
opportunity score, prove low organic demand, satisfy organic
confirmation, or block a profile without an explicit approved fallback
(§67.4, AC-142). Social capability adapters and their rights/coverage
governance remain owned by the `FR-SOC` packages; the alert layer only
consumes and displays the capability state.

## Verification commands (package scope)

```bash
test -d packages/alerts && pnpm --filter @foresift/alerts test
bun test tests/acceptance/AC-140.spec.ts tests/acceptance/AC-141.spec.ts
bun test tests/negative/AC-140.negative.spec.ts tests/negative/AC-141.negative.spec.ts
```

plus `pnpm verify` and `pnpm spec:verify` at the pushed HEAD per the
completion standard (run by the implementation loop, not this plan).
