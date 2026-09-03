# Implementation Plan: g1-solana-security

**Package**: `g1-solana-security` | **Date**: 2026-09-03 | **Spec**: `specs/g1-solana-security/spec.md` (scoped derivative of PRD §35.12, §64.9, §65.2–65.7, §37.3, §19.3, Appendix Q + manifest FR-SOLSEC-001…006)
**Authority**: PRD wins over every word below; material decisions are recorded as proposed ADR texts in this file.

## Summary

Deliver the deterministic Solana security plane — a new
`packages/solana-security` package — along five seams, consuming only the
proven substrate and never rewriting proven behavior:

1. **Token program assessment (FR-SOLSEC-001/002)** — deterministic
   SPL/Token-2022 program, authority, and extension analysis keyed by program
   id and program/layout version: mint, freeze, permanent-delegate,
   transfer-fee, transfer-hook, close, metadata/update, default-state,
   non-transferable, and confidential-transfer-related controls parsed into
   point-in-time, versioned evidence records (§65.2), each classified into the
   Appendix Q.1-derived state vocabulary (KNOWN_RISK, ADMINISTRATIVE_CONTROL,
   NEUTRAL_CONFIGURATION, REVOKED_AUTHORITY, UNABLE_TO_VERIFY).
2. **Pool/LP security (FR-SOLSEC-003)** — pool ownership, position/LP
   control, burn/lock evidence, withdrawal authority, migration lineage,
   quote quality, liquidity concentration, recent adds/removals, and
   large-sell impact assessed ONLY through the proven allowlisted versioned
   decoder/adapter registry (§35.12, §65.3); unsupported designs resolve to an
   explicit degraded state, never generic constant-product output.
3. **Transfer-semantics gating (FR-SOLSEC-004)** — a pure, versioned support
   verdict: unknown required transfer semantics produce a blocking verdict for
   profiles requiring complete execution modeling (`INSUFFICIENT_DATA` shape
   per §64.9; zero cost is never assumed), fail-closed on unknown extensions.
4. **Provider evidence subordination (FR-SOLSEC-005)** — external security
   reports (GoPlus/GMGN/Honeypot class, §65.7) are one independent evidence
   group; safe/no-issue output is stored as evidence and can never override a
   deterministic critical finding; conflicts are stored and exposed.
5. **System-address registry (FR-SOLSEC-006)** — a versioned registry
   (§65.5, Appendix Q.2: chain, address, role, valid-from/to, source,
   confidence, review state) whose role+confidence-scoped exclusions feed
   actor attribution through the proven normalizer seam, preventing
   infrastructure accounts from becoming false wallet-owner/funder evidence.

Strictly read-only (INV-001): no trading, custody, wallet-signing,
private-key, or transaction-submission capability. "Withdrawal authority" and
"liquidity removal" are decoded program facts (evidence), never capabilities.

## Technical Context

- **Language/runtime**: TypeScript (ESM, strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) in the existing pnpm workspace; Bun Test is
  the repository test authority.
- **Storage**: PostgreSQL schema via `@foresift/persistence` (`DatabaseEngine`
  seam); tests run on PGlite per ADR-0014. New migration family `g1_solsec_*`
  — additive only; the fail-closed migrator's family pattern is extended with
  `solsec` and the central registry suite
  (`packages/persistence/test/migrator.spec.ts`) is extended in the same
  package (ADR-0019/0022 duty, plan-sanctioned scope exception).
- **Validation**: Zod schemas authoritative in `packages/shared-schemas` as a
  NEW `solsec.ts` module (ADR-0013); closed vocabularies are declared in
  `packages/domain` (new `solsec.ts`) and imported — never restated.
  Unknown values fail closed with stable `ErrorCode`s.
- **Decoders**: `packages/program-decoders` and `packages/collector-solana`
  stay READ-ONLY consumers (no write-scope); the pool-security analyzer calls
  their proven resolution surface. The registry itself (programs/routers/
  launchpads/fee collectors) lives in the new package per writeScopes.
- **Test stack**: Bun Test; new suites colocated in
  `packages/solana-security/test/` plus root `tests/acceptance`/`tests/negative`
  files; `evidence/bun-migration/bun-migration-manifest.json` regenerated
  after new suites exist (mechanical, coordinator duty).
- **Telemetry**: declarative catalog only (`telemetry/solsec.catalog.json`) —
  emitter wiring is G2, never in this package's verification.

## Constitution Check

- **I. Product-Contract Authority**: scope limited to the six assigned
  requirements; `docs/spec/**` untouched; spec.md marked subordinate; seeded
  normative content preserved verbatim.
- **II. Greenfield**: designed from §35.12, §65.2–65.7 and Appendix Q
  directly; the predecessor repository is not consulted.
- **III. Modular-monolith-first**: exactly one new focused package plus
  additive extensions (domain vocabulary, shared schema, migration family,
  telemetry catalog) — no brokers, no service splits; every analyzer is a
  pure deterministic function over persisted/fetched evidence.
- **IV. Read-only boundary (NON-NEGOTIABLE)**: the package analyzes authority
  and control surfaces; it never builds, signs, or submits transactions and
  holds no key material. `scripts/scan-prohibited-capabilities/cli.mjs` stays
  green; wording avoids capability-implying verbs for decoded authority facts.
- **V. Point-in-time correctness**: every token/pool control is point-in-time
  evidence (§35.12); assessments carry event/availability timestamps and the
  registry is versioned with validity intervals (INV-005/006; FR-SOLSEC-002).
- **VI. Event-time/earliest-availability**: registry revisions and assessment
  records store `available_at` distinct from `event_at`/`as_of`; backfilled
  extension parsing never backdates availability.
- **VII. Provenance & evidence**: every finding carries program/policy/
  analyzer versions, source references, and evidence ids (INV-004); provider
  verdicts persist raw payload references, never silently dropped.
- **VIII. Fail-closed**: unknown program versions, unknown extensions,
  unknown designs, and missing required state refuse with typed errors or
  explicit degraded/blocking states — never guessed (Constitution VIII;
  FR-SOLSEC-004).
- **IX. Provider abstraction**: security providers are consumed as
  evidence payloads through declared source identities; no vendor SDK enters
  `packages/solana-security`.
- **X. Traceability**: tasks cite only FR-SOLSEC-001…006 and their ACs; the
  validator rejects out-of-scope requirement IDs.
- **XI/XII. Deterministic + dual-path verification**: AC-130/131/132 authored
  here with positive AND negative specs at manifest-declared paths; AC-230/231
  extended additively; `pnpm verify` + `pnpm spec:verify` at the pushed HEAD.
- **XIII. Replay/Recovery/Idempotency**: assessment persistence is
  idempotent under re-parse (deterministic content identity); registry
  inserts are append-only with append-only triggers (G0 pattern).
- **XIV. Durable operations**: planning artifacts persisted to the run
  directory; registry state in SQL, never process-local.
- **XV. Security & least privilege**: no secrets; provider payloads stored as
  evidence references; registry review state is governance metadata, never
  credentials.
- **XVI–XVIII. Agent governance**: completion decided by
  `package-plan-complete.mjs`, package gates, and CI; commits additive.

## Data model (SQL truth under `migrations/`)

### `g1_solsec_0001_token_assessments.sql` (family `solsec`)

```text
CREATE TABLE token_program_assessments (        -- §65.2, FR-SOLSEC-001/002
    assessment_id          text PRIMARY KEY,   -- deterministic content id
    asset_representation_id text NOT NULL,
    chain_id               text NOT NULL REFERENCES chains(chain_id),
    mint_address           text NOT NULL,
    program_id             text NOT NULL,      -- SPL Token or Token-2022 program
    program_version        text NOT NULL,      -- versioned layout/extension set
    as_of                  timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    analyzer_version       text NOT NULL,      -- INV-004 reconstruction inputs
    policy_version         text NOT NULL,
    quality_codes          text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT token_program_assessments_availability_order
        CHECK (available_at >= as_of)
);

CREATE TABLE token_control_findings (           -- FR-SOLSEC-002: one row per control
    finding_id             text PRIMARY KEY,
    assessment_id          text NOT NULL REFERENCES token_program_assessments(assessment_id),
    control                text NOT NULL CHECK (control IN (
        'MINT','FREEZE','PERMANENT_DELEGATE','TRANSFER_FEE','TRANSFER_HOOK',
        'CLOSE','METADATA_UPDATE','DEFAULT_STATE','NON_TRANSFERABLE',
        'CONFIDENTIAL_TRANSFER','UNKNOWN_EXTENSION')),
    control_state          text NOT NULL CHECK (control_state IN (
        'KNOWN_RISK','ADMINISTRATIVE_CONTROL','NEUTRAL_CONFIGURATION',
        'REVOKED_AUTHORITY','UNABLE_TO_VERIFY')),   -- §65.2 distinction set
    authority_address      text,               -- decoded authority (evidence)
    extension_data_hash    text,               -- sha256 of raw extension bytes
    evidence_ref           text NOT NULL,      -- persisted observation/receipt
    severity               text CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','NONE')),
    severity_policy_version text NOT NULL,
    available_at           timestamptz NOT NULL,
    UNIQUE (assessment_id, control)
);

CREATE TABLE token_extension_support (          -- FR-SOLSEC-004 substrate
    program_id             text NOT NULL,
    program_version        text NOT NULL,
    extension              text NOT NULL,
    transfer_semantics     text NOT NULL CHECK (transfer_semantics IN (
        'KNOWN_MODELED','KNOWN_UNMODELED','UNKNOWN_REQUIRED','NOT_PRESENT')),
    verdict_policy_version text NOT NULL,
    available_at           timestamptz NOT NULL,
    PRIMARY KEY (program_id, program_version, extension, verdict_policy_version)
);
-- append-only triggers (G0 pattern) on findings + support rows
```

### `g1_solsec_0002_pool_security.sql`

```text
CREATE TABLE pool_security_assessments (        -- §65.3, FR-SOLSEC-003
    assessment_id          text PRIMARY KEY,
    pool_id                text NOT NULL,      -- composePoolId key form
    chain_id               text NOT NULL REFERENCES chains(chain_id),
    decoder_family         text NOT NULL,      -- allowlisted family that resolved
    decoder_version        text NOT NULL,
    adapter_support_state  text NOT NULL CHECK (adapter_support_state IN (
        'RESOLVED','DEGRADED_UNSUPPORTED','UNABLE_TO_VERIFY')),  -- AC-230 law
    lp_control_state       text CHECK (lp_control_state IN (
        'BURNED','LOCKED_WITH_EVIDENCE','OPEN_CONTROL','UNABLE_TO_VERIFY')),
    withdrawal_authority_state text CHECK (withdrawal_authority_state IN (
        'REVOKED','PRESENT_OPEN','PRESENT_WITH_OBSERVED_ABUSE','UNABLE_TO_VERIFY')),
    liquidity_removal_risk text CHECK (liquidity_removal_risk IN (
        'NONE_EVIDENCED','POSSIBLE','OBSERVED','UNABLE_TO_VERIFY')),
    migration_lineage_ref  text,               -- migration_edges key, not a rewrite
    liquidity_concentration double precision CHECK (liquidity_concentration BETWEEN 0 AND 1),
    recent_net_removal_raw text,               -- signed decimal of removals
    large_sell_impact      double precision,
    quote_parity_state     text CHECK (quote_parity_state IN (
        'PASS','FAIL','UNABLE_TO_VERIFY')),   -- §35.12 quote-parity gate
    state_completeness     text NOT NULL CHECK (state_completeness IN (
        'COMPLETE','INCOMPLETE_BLOCKING')),
    as_of                  timestamptz NOT NULL,
    available_at           timestamptz NOT NULL,
    analyzer_version       text NOT NULL,
    policy_version         text NOT NULL,
    evidence_refs          text[] NOT NULL,
    quality_codes          text[] NOT NULL CHECK (cardinality(quality_codes) > 0),
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pool_security_assessments_availability_order
        CHECK (available_at >= as_of),
    CONSTRAINT pool_security_unsupported_not_resolved
        CHECK (adapter_support_state <> 'DEGRADED_UNSUPPORTED'
            OR lp_control_state IS NULL AND withdrawal_authority_state IS NULL
               AND liquidity_removal_risk IS NULL)
);
```

### `g1_solsec_0003_provider_evidence.sql`

```text
CREATE TABLE security_provider_reports (        -- §65.7, FR-SOLSEC-005
    report_id              text PRIMARY KEY,
    asset_representation_id text NOT NULL,
    source_id              text NOT NULL REFERENCES source_identities(source_id),
    verdict                text NOT NULL CHECK (verdict IN (
        'SAFE','RISK_DETECTED','UNABLE_TO_VERIFY')),
    raw_payload_ref        text NOT NULL,      -- evidence pointer, never secrets
    reported_at            timestamptz,
    available_at           timestamptz NOT NULL,
    quality_codes          text[] NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_conflicts (               -- FR-SOLSEC-005: stored + exposed
    conflict_id            text PRIMARY KEY,
    asset_representation_id text NOT NULL,
    deterministic_finding_ids text[] NOT NULL CHECK (cardinality(deterministic_finding_ids) > 0),
    provider_report_ids    text[] NOT NULL DEFAULT ARRAY[]::text[],
    conflict_class         text NOT NULL CHECK (conflict_class IN (
        'PROVIDER_OPTIMISM_OVERRIDDEN',      -- safe/no-issue vs deterministic critical
        'PROVIDER_RISK_NO_DETERMINISTIC_CORROBORATION',
        'UNABLE_TO_VERIFY')),
    resolution             text NOT NULL,      -- deterministic side ALWAYS stands
    available_at           timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);
-- append-only triggers (G0 pattern)
```

### `g1_solsec_0004_system_addresses.sql`

```text
CREATE TABLE system_address_registry (          -- §65.5, Appendix Q.2, FR-SOLSEC-006
    registry_entry_id      text PRIMARY KEY,
    chain_id               text NOT NULL REFERENCES chains(chain_id),
    address                text NOT NULL,
    role                   text NOT NULL CHECK (role IN (
        'PROGRAM','ROUTER','POOL','LAUNCHPAD','BRIDGE','EXCHANGE_SERVICE',
        'MARKET_MAKER','FEE_COLLECTOR','BURN_LOCK','UNKNOWN_INFRASTRUCTURE')),
    valid_from             timestamptz NOT NULL,
    valid_until            timestamptz,        -- NULL = still valid
    source                 text NOT NULL,
    confidence             double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    review_state           text NOT NULL CHECK (review_state IN (
        'REVIEWED','PENDING_REVIEW','REJECTED')),
    registry_version       text NOT NULL,
    available_at           timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, address, registry_version, valid_from),
    -- Appendix Q.2: exclusion requires an ACCEPTED role AND minimum confidence.
    -- Anything below the floor is structurally non-excludable.
    CONSTRAINT system_address_exclusion_floor
        CHECK (review_state <> 'REVIEWED' OR role = 'UNKNOWN_INFRASTRUCTURE'
            OR confidence >= 0.80)
);
CREATE TABLE system_address_exclusions_applied (  -- audit of every exclusion
    exclusion_id           text PRIMARY KEY,
    registry_entry_id      text NOT NULL REFERENCES system_address_registry(registry_entry_id),
    consumer               text NOT NULL,      -- e.g. 'economic-trade-normalizer'
    applied_at             timestamptz NOT NULL,
    valid_at               timestamptz NOT NULL,
    excluded               boolean NOT NULL,   -- false when role/confidence refused
    raw_flow_ref           text NOT NULL       -- raw flows remain auditable (Q.2)
);
-- append-only trigger on the registry
```

## Module layout (inside writeScopes)

```text
packages/domain/src/
  solsec.ts              # NEW — TokenControl (10-control vocabulary),
                         #   TokenControlState (§65.2 five-state set),
                         #   SecuritySeverity (Q.1 CRITICAL/HIGH/MEDIUM/LOW/NONE),
                         #   TransferSemanticsSupport (KNOWN_MODELED,
                         #   KNOWN_UNMODELED, UNKNOWN_REQUIRED, NOT_PRESENT),
                         #   PoolSupportState, LpControlState, WithdrawalAuthorityState,
                         #   LiquidityRemovalRisk, SystemAddressRole, ReviewState,
                         #   provider verdict + conflict classes; fail-closed parse;
                         #   profileRequiresCompleteExecutionModeling(transferSemantics)
                         #   → blocking predicate (FR-SOLSEC-004)
                         #   providerReportCannotOverride(deterministicSeverity, verdict)
                         #   (FR-SOLSEC-005); isExcludableSystemAddress(role,
                         #   confidence, reviewState) (Q.2 floor, FR-SOLSEC-006)
  index.ts               # extend exports

packages/shared-schemas/src/
  solsec.ts              # NEW — TokenProgramAssessment, TokenControlFinding,
                         #   TokenExtensionSupport, PoolSecurityAssessment,
                         #   SecurityProviderReport, SecurityConflict,
                         #   SystemAddressRegistryEntry schemas; imports domain
                         #   enums (never restates); SOLSEC_SCHEMA_REGISTRY_VERSION
  index.ts               # export solsec.ts

packages/solana-security/                     # NEW package (@foresift/solana-security)
  src/
    index.ts
    token-assessment.ts   # SPL/Token-2022 extension parsing keyed by
                          #   program+layout version (§65.2 list → findings);
                          #   unknown extension → UNKNOWN_REQUIRED support row +
                          #   TOKEN_EXTENSION_UNKNOWN quality (fail-closed)
    pool-security.ts      # pool/LP assessment via allowlisted decoder registry
                          #   resolution; unsupported → DEGRADED_UNSUPPORTED,
                          #   never generic math (§35.12)
    transfer-semantics.ts # versioned support verdicts + the FR-SOLSEC-004
                          #   blocking gate consumed by execution simulation
    provider-evidence.ts  # security-provider report persistence + the
                          #   deterministic-override comparison (§65.7)
    system-registry.ts    # registry queries + exclusion decision records with
                          #   audit rows (Q.2; normalizer seam)
    severity.ts           # Q.1-derived severity mapping (versioned policy),
                          #   pure + deterministic
  test/                   # colocated suites (PGlite-backed where persistence needed)

tests/fixtures/solsec/                        # NEW dir
  token-extensions.json  # §65.2 control vectors: all 10 controls + unknown
                         #   extension (AC-130)
  pool-security.json     # LP control/withdrawal/migration/removal vectors incl.
                         #   unsupported-design case (AC-130, AC-231 extension)
  provider-override.json # AC-131 vectors: provider SAFE vs deterministic CRITICAL
  system-registry.json   # AC-132 vectors: router/exchange/launchpad/fee-collector
                         #   exclusions + low-confidence non-exclusion

tests/acceptance/  — AC-130, AC-131, AC-132.spec.ts AUTHORED here;
                     AC-230/AC-231 extended with solsec describe blocks (additive)
tests/negative/    — AC-130/131/132.negative.spec.ts authored here;
                     AC-230/AC-231 negatives extended additively
telemetry/solsec.catalog.json  — NEW: token.assessed, token.extension_parsed,
                     token.transfer_semantics_verdict, pool.security_assessed,
                     security.provider_report_received, security.conflict_recorded,
                     system_registry.exclusion_decided (DECLARATIVE_CONTRACT_ONLY)
tests/telemetry-catalog.spec.ts — extended in place (plan-sanctioned scope
                     exception, milestone plan-level decision 4)
packages/persistence/test/migrator.spec.ts — extended in place (plan-sanctioned
                     scope exception, ADR-0019/0022 duty) with the solsec family
                     + g1_solsec_* scripts
packages/persistence/src/migrator.ts — MIGRATION_FILE_PATTERN extended with
                     `solsec` family (fail-closed discovery)
evidence/bun-migration/bun-migration-manifest.json — regenerated after new
                     suites exist (mechanical, coordinator duty)
```

## Verification strategy per acceptance criterion

| AC                         | Surface                                  | Positive proof                                                                                                                                                                                                                                                    | Negative proof                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-130                     | token+pool detection/blocking            | fixture `token-extensions.json`: all 10 named controls detected on supported programs with versioned evidence rows; pool fixture resolves LP/withdrawal/migration/removal through the allowlisted adapter; unknown required transfer semantics → blocking verdict | negative: unknown extension yields UNABLE_TO_VERIFY/UNKNOWN_REQUIRED + blocked verdict (never a guess); unsupported pool design refuses lp/withdrawal fields; fabricated control row refused by schema |
| AC-131                     | provider cannot override                 | fixture `provider-override.json`: deterministic CRITICAL + provider SAFE → critical stands, conflict row recorded with class PROVIDER_OPTIMISM_OVERRIDDEN, provider verdict preserved as evidence                                                                 | negative: a path where provider safe output downgrades/blocks-or-clears deterministic severity is structurally refused (gate predicate + SQL CHECK); missing provider data never reduces risk          |
| AC-132                     | registry prevents false edges            | fixture `system-registry.json`: router/exchange/launchpad/fee-collector/program accounts excluded from actor attribution at accepted role+confidence; raw flows stay auditable (exclusions_applied rows)                                                          | negative: low-confidence or non-reviewed or rejected registry rows are NOT excludable (floor CHECK refuses); uncertain label degrades quality codes instead of silently removing evidence              |
| AC-133                     | (owned by g1-data-truth-extensions)      | regression-locked: existing suite stays green; registry exclusions feed its actor seam without changing event identity                                                                                                                                            | existing negatives stay green                                                                                                                                                                          |
| AC-134/135/136             | (owned by g1-data-truth-extensions)      | regression-locked: existing suites stay green                                                                                                                                                                                                                     | existing negatives stay green                                                                                                                                                                          |
| AC-230                     | adapter resolution (extended)            | solsec describe block: pool-security assessment resolves ONLY via matching versioned decoder/adapter + signed manifest; unsupported design → explicit degraded state, never generic constant-product                                                              | negative: mismatched layout/program refuses; DEGRADED_UNSUPPORTED row cannot carry resolved-state fields                                                                                               |
| AC-231                     | decoder verification (regression-locked) | existing suite stays green; pool-security consumes only ACTIVE verified manifests                                                                                                                                                                                 | negative: assessment against unverified/deprecated manifest refuses                                                                                                                                    |
| AC-232/234/235/236/238/239 | (owned by g1-execution-simulation)       | out of scope here; FR-SOLSEC obligations surface through AC-130 blocking + support verdicts the simulator will consume                                                                                                                                            | out of scope here; recorded in out-of-scope notes                                                                                                                                                      |
| AC-233/237                 | (authored by earlier packages)           | regression-locked green                                                                                                                                                                                                                                           | existing negatives stay green                                                                                                                                                                          |

Package-level unit suites (`packages/solana-security/test/**`): vocabulary
fail-closed parses; severity mapping determinism + policy versioning; blocking
predicate truth table; provider-override gate purity; registry floor logic;
append-only/idempotent persistence; point-in-time resolution (assessment at T
uses registry rows whose validity interval contains T).

## Material decisions (proposed ADR texts — bind future packages)

### ADR-1 — Deterministic security severity is non-overridable state

**Decision**: deterministic security findings (token controls, pool control,
transfer-semantics blocking) are computed by versioned pure analyzers and
persisted with their severity. External security-provider verdicts are stored
as evidence in their own table and compared, never merged: a provider
`SAFE`/no-issue output can add an independent-evidence data point and a
conflict record, but cannot alter, downgrade, or gate a deterministic finding.
The comparison emits `security_conflicts` rows; resolution always names the
deterministic side. Missing provider data is recorded as absence and never
reduces severity (§35.12: "missing social/wallet data cannot reduce risk as if
evidence were negative").

**Why binding**: g1-objective-governance consumes security severity as a hard
constraint that no weighted score may compensate for; g1-execution-simulation
consumes the blocking verdict. Both must be able to trust that severity is a
deterministic function, not a negotiated blend.

### ADR-2 — Transfer-semantics support verdicts are versioned and fail-closed

**Decision**: the transfer-semantics surface is a pure verdict function over
(program, program version, extension set, verdict-policy version). Every
extension resolves to KNOWN_MODELED, KNOWN_UNMODELED, UNKNOWN_REQUIRED, or
NOT_PRESENT; any UNKNOWN_REQUIRED on a profile requiring complete execution
modeling blocks that profile (`INSUFFICIENT_DATA` shape per §64.9). Verdicts
are persisted per policy version; policy changes create new verdict rows and
never rewrite historical ones (INV-004/005). The blocking decision itself is
taken by the consuming profile engine (g1-execution-simulation); this package
owns the verdict substrate.

**Why binding**: the simulator's TransferSemanticsAdapter resolution (its
internal staging order) consumes these verdicts; both sides must agree on the
vocabulary and the blocking contract from day one.

### ADR-3 — System-address exclusion is role+confidence-floored and audited

**Decision**: exclusion of an address from actor features requires (a) a
REVIEWED registry row, (b) an accepted infrastructure role (any role except
UNKNOWN_INFRASTRUCTURE), and (c) confidence ≥ 0.80. The floor is a SQL CHECK
(structurally non-excludable below it). Every exclusion decision — including
refusals — is recorded in `system_address_exclusions_applied` with the raw
flow reference, so raw flows remain auditable (Appendix Q.2) and uncertain
labels degrade quality codes (`SYSTEM_ADDRESS_UNCERTAIN`) rather than silently
removing evidence. Registry rows are versioned with validity intervals; a
registry revision never retroactively rewrites historical attribution inputs —
it changes results from its `available_at` forward (§37.3 chaos case).

**Why binding**: AC-132 and the wallet-cluster consumers (later milestone)
must share one exclusion law; the audit row is the reconciliation surface.

### ADR-4 — New migration family `solsec`

**Decision**: FR-SOLSEC uses `g1_solsec_*.sql` per the milestone writeScopes;
the migrator's fail-closed filename pattern is extended with the `solsec`
family in the same package that introduces it (ADR-0019/0022 central-registry
duty: `packages/persistence/test/migrator.spec.ts` extended here,
plan-sanctioned scope exception). Migration files stay additive — no G0/G1
table owned by another family is altered.

### ADR-5 — Pool-security assessments reuse the decoder-registry resolution law

**Decision**: pool security assessments do not introduce a second adapter
system. They resolve the pool through the proven
`packages/program-decoders` registry (family + layout version + signed
manifest, FR-COL-002) and record the resolution outcome
(`RESOLVED` / `DEGRADED_UNSUPPORTED` / `UNABLE_TO_VERIFY`) on the assessment.
A `DEGRADED_UNSUPPORTED` assessment structurally cannot carry resolved-state
fields (SQL CHECK) — the AC-230 law ("an unknown or mismatched design returns
an explicit unsupported/degraded state rather than generic constant-product
output") holds at the security layer too.

## Risks and mitigations (planning-level)

| Risk                                                                                       | Likelihood | Impact | Mitigation                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `**` write-scope glob requires `packages/solana-security` to exist before shard validation | High       | MEDIUM | package scaffolded in the first tasks so predicted writes resolve inside scopes                                         |
| Severity mapping drifts into subjective scoring                                            | Medium     | HIGH   | severity is a versioned pure policy over deterministic findings (ADR-1); no LLM, no blended provider verdicts           |
| Registry exclusions silently broadening                                                    | Low        | HIGH   | role+confidence floor is a SQL CHECK; every exclusion (and refusal) audited (ADR-3); AC-132 negative pins refusals      |
| Token-2022 extension set grows between parse and verification                              | Medium     | MEDIUM | unknown extension → UNKNOWN_REQUIRED fail-closed (never partial trust); upgrade detection reuses drift law              |
| AC-23x family files double-authored with g1-execution-simulation                           | Medium     | MEDIUM | file ownership fixed by spec I2 (this package: 130–132 + AC-230/231 extension only); out-of-scope notes record the rest |
| Normalizer integration creep (rewriting proven actor attribution)                          | Low        | MEDIUM | normalizer is read-only consumer; changes ride the plan-sanctioned scope exception only, via its context seam           |
| Migration family regex extension breaks migrator tests                                     | Low        | LOW    | central registry suite extended in the same PR (ADR-0019/0022 duty, live-proven pattern from g1-data-truth)             |

## Non-goals reaffirmed (must not creep into tasks.md)

No trading/custody/signing surfaces (permanent); no execution simulator,
adapters, stress scenarios, or tradability decisions (g1-execution-simulation
owns AC-232/234/235/236/238/239 authorship); no feature-registry or ranking
machinery (g1-signal-registry); no outcome maturity/evaluation statistics
(g1-outcome-evaluation); no objective constraints (g1-objective-governance);
no capacity admission control (g1-capacity-contracts); no discovery coverage
claims (g1-discovery-coverage); no wallet/cluster graph construction
(FR-DFD, later milestone — AC-132 is proven at the actor-attribution seam,
spec I4); no economic-event normalization changes (proven substrate consumed
as-is); no telemetry emitter wiring (G2); no `docs/generated/**` regeneration
(milestone plan-level decision 2).

## Validation

```bash
node scripts/automation/package-plan-complete.mjs \
  --package g1-solana-security \
  --artifacts-dir /home/minhquan_eth/.archon/workspaces/quantm-zeus/foresift/artifacts/runs/32b7700a4440c69643d25c094c6df915

# Task-graph build + shard planning (must stay green, all writes in scope):
node scripts/automation/build-implementation-task-graph.mjs --package g1-solana-security

# Package gate (milestone verificationCommands):
test -d packages/solana-security && pnpm --filter @foresift/solana-security test

# Extended central suites (plan-sanctioned scope exceptions):
pnpm --filter @foresift/persistence test
bun test tests/telemetry-catalog.spec.ts tests/acceptance/AC-130.spec.ts tests/acceptance/AC-131.spec.ts tests/acceptance/AC-132.spec.ts

# Overall gates at the pushed HEAD (not planning-only):
pnpm verify
pnpm spec:verify
```
