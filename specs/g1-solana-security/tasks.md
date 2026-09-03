# Tasks: g1-solana-security

**Input**: `specs/g1-solana-security/spec.md`, `specs/g1-solana-security/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-SOLSEC-001…006) or an acceptance criterion of those requirements.
Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors (disjoint files).
Tests are mandatory per PRD evidence rules: positive AND negative/failure-path
specs for every acceptance criterion this package authors (AC-130, AC-131,
AC-132) plus additive extends of AC-230/AC-231. Plan-sanctioned scope
exceptions recorded per the milestone plan-level decisions and ADR-0019/0022
duty: `packages/persistence/src/migrator.ts` +
`packages/persistence/test/migrator.spec.ts` (central migration registry) and
`tests/telemetry-catalog.spec.ts` (central telemetry parity suite) are
extended by this package even though they sit outside the listed writeScopes.

## Phase 1 — Foundations: domain vocabularies and shared schemas (blocks later phases)

- [x] T001 Create `packages/domain/src/solsec.ts`: `TokenControl` (MINT, FREEZE,
      PERMANENT_DELEGATE, TRANSFER_FEE, TRANSFER_HOOK, CLOSE, METADATA_UPDATE,
      DEFAULT_STATE, NON_TRANSFERABLE, CONFIDENTIAL_TRANSFER, UNKNOWN_EXTENSION —
      the §65.2 control list), `TokenControlState` (KNOWN_RISK,
      ADMINISTRATIVE_CONTROL, NEUTRAL_CONFIGURATION, REVOKED_AUTHORITY,
      UNABLE_TO_VERIFY — §65.2's "known risk, administrative control, neutral
      configuration, revoked authority and unable-to-verify" distinction set),
      `SecuritySeverity` (CRITICAL/HIGH/MEDIUM/LOW/NONE per Appendix Q.1),
      `TransferSemanticsSupport` (KNOWN_MODELED, KNOWN_UNMODELED,
      UNKNOWN_REQUIRED, NOT_PRESENT), `PoolSupportState` (RESOLVED,
      DEGRADED_UNSUPPORTED, UNABLE_TO_VERIFY), `LpControlState`,
      `WithdrawalAuthorityState`, `LiquidityRemovalRisk`, `QuoteParityState`,
      `StateCompleteness`, `SystemAddressRole` (Appendix Q.2 roles),
      `SystemAddressReviewState`, `ProviderVerdict` (SAFE, RISK_DETECTED,
      UNABLE_TO_VERIFY), `SecurityConflictClass` (plan ADR-1 classes) — each
      with fail-closed parse throwing typed errors with stable ErrorCodes;
      plus the pure functions `profileRequiresCompleteExecutionModeling`
      blocking gate substrate (UNKNOWN_REQUIRED ⇒ block), and
      `isExcludableSystemAddress(role, confidence, reviewState)` implementing
      the Appendix Q.2 accepted-role + minimum-confidence floor. Add
      colocated `packages/domain/test/` fail-closed vocabulary tests. Traces:
      FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-003, FR-SOLSEC-004, FR-SOLSEC-006.
- [x] T002 Extend `packages/domain/src/index.ts` exports for the new solsec
      module. Traces: FR-SOLSEC-001…006.
- [x] T003 Create `packages/shared-schemas/src/solsec.ts`: Zod schemas for
      `TokenProgramAssessment`, `TokenControlFinding`, `TokenExtensionSupport`,
      `PoolSecurityAssessment`, `SecurityProviderReport`, `SecurityConflict`,
      `SystemAddressRegistryEntry`, `SystemAddressExclusionApplied` — importing
      domain enums (never restating), `.strict()`, digit-string/decimal rules,
      ISO-8601 Z timestamps, `sha256:<hex>` hashes for extension data,
      `SOLSEC_SCHEMA_REGISTRY_VERSION = 1`; unknown control/state values fail
      closed. Extend `packages/shared-schemas/src/index.ts` exports. Add
      colocated schema tests (unknown enum rejection, refinement boundaries).
      Traces: FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-003, FR-SOLSEC-004,
      FR-SOLSEC-005, FR-SOLSEC-006.

## Phase 2 — Persistence: migration family + migrator extension (blocks repos)

- [x] T004 Create `migrations/g1_solsec_0001_token_assessments.sql`:
      `token_program_assessments`, `token_control_findings` (UNIQUE per
      assessment+control; severity nullable except where control_state
      requires it; extension data as keyed hash), `token_extension_support`
      (versioned verdict rows, PRIMARY KEY includes verdict_policy_version);
      availability-order CHECKs; append-only triggers on findings and support
      rows; quality_codes constrained to the §13.9 vocabulary (G1 TRD
      precedent CHECK form). Traces: FR-SOLSEC-001, FR-SOLSEC-002,
      FR-SOLSEC-004.
- [x] T005 Create `migrations/g1_solsec_0002_pool_security.sql`:
      `pool_security_assessments` with `adapter_support_state`
      (RESOLVED/DEGRADED_UNSUPPORTED/UNABLE_TO_VERIFY), LP-control,
      withdrawal-authority, liquidity-removal, quote-parity, and
      state-completeness fields; the
      `pool_security_unsupported_not_resolved` CHECK so a DEGRADED_UNSUPPORTED
      row structurally cannot carry resolved-state fields (plan ADR-5,
      AC-230 law); availability-order CHECK; append-only trigger. Traces:
      FR-SOLSEC-003.
- [x] T006 Create `migrations/g1_solsec_0003_provider_evidence.sql`:
      `security_provider_reports` (source FK to source_identities, verdict
      vocabulary, raw_payload_ref — never secret material) and
      `security_conflicts` (conflict_class CHECK including
      PROVIDER_OPTIMISM_OVERRIDDEN; deterministic finding ids required
      non-empty; resolution always names the deterministic side); append-only
      triggers. Traces: FR-SOLSEC-005.
- [x] T007 Create `migrations/g1_solsec_0004_system_addresses.sql`:
      `system_address_registry` (role CHECK per Appendix Q.2, valid_from/until,
      confidence, review_state, registry_version, UNIQUE per
      chain+address+version+valid_from) with the
      `system_address_exclusion_floor` CHECK (reviewed + non-unknown role ⇒
      confidence ≥ 0.80 — plan ADR-3) and
      `system_address_exclusions_applied` audit rows (excluded boolean,
      raw_flow_ref so raw flows remain auditable); append-only trigger on the
      registry. Traces: FR-SOLSEC-006.
- [ ] T008 Extend `packages/persistence/src/migrator.ts`
      MIGRATION_FILE_PATTERN with the `solsec` family AND extend the central
      expected-script registry `packages/persistence/test/migrator.spec.ts`
      with `g1_solsec_0001_token_assessments`,
      `g1_solsec_0002_pool_security`, `g1_solsec_0003_provider_evidence`,
      `g1_solsec_0004_system_addresses` (lexicographic, checksum-pinned) —
      the plan-sanctioned central-registry scope exception (ADR-0019/0022
      duty; the registry suite must be updated in the same package or the
      task-graph guard refuses the build). Traces: FR-SOLSEC-001…006.

## Phase 3 — Core analyzers: the solana-security package (blocks AC suites)

- [x] T009 Scaffold `packages/solana-security` (package.json
      `@foresift/solana-security` with workspace `*` deps on
      domain/persistence/shared-schemas, `bun test` script, tsconfig extending
      tsconfig.base.json, no per-package runner config — G0/G1 scaffold
      pattern). Traces: FR-SOLSEC-001…006.
- [ ] T010 Implement `src/token-assessment.ts`: deterministic
      SPL/Token-2022 program, authority, and extension analysis keyed by
      program id + program/layout version (FR-SOLSEC-001) — parse the §65.2
      control list (mint/freeze authorities, permanent delegate, transfer-fee
      configuration + withheld authority, transfer hook program, default
      account state, close authority, non-transferable and
      confidential-transfer-related extensions, metadata/update authority,
      decimals/total supply, unknown/unsupported extensions) into
      `TokenControlFinding` rows with the five-state classification;
      unknown/unsupported extensions yield UNKNOWN_EXTENSION findings +
      `TOKEN_EXTENSION_UNKNOWN` quality + UNKNOWN_REQUIRED support rows —
      never guessed semantics (FR-SOLSEC-002 versioned evidence: every
      finding carries analyzer/policy versions, evidence ref, available_at).
      Add colocated tests with golden vectors (fail-closed unknown extension,
      revoked vs active authority distinction, point-in-time availability).
      Traces: FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-004, AC-130.
- [ ] T011 Implement `src/transfer-semantics.ts`: the versioned support
      verdict function over (program, program version, extension set,
      verdict-policy version) emitting `token_extension_support` rows
      (KNOWN_MODELED / KNOWN_UNMODELED / UNKNOWN_REQUIRED / NOT_PRESENT) and
      the pure blocking predicate `blocksCompleteExecutionModeling(verdict)`
      — profiles requiring complete execution modeling are blocked when any
      required extension is UNKNOWN_REQUIRED (§64.9 INSUFFICIENT_DATA shape;
      zero cost never assumed). Colocated tests: full truth table,
      fail-closed on unknown inputs, policy-version row separation (no
      historical rewrite). Traces: FR-SOLSEC-004, AC-130.
- [ ] T012 Implement `src/pool-security.ts`: pool/LP security assessment
      (§65.3) resolving the pool ONLY through the proven decoder-registry
      resolution surface (family + layout version + signed manifest — the
      `@foresift/program-decoders` public API is consumed read-only; no write
      lands there): pool ownership, position/LP control (burned / locked with
      evidence / open), withdrawal authority (revoked / present /
      present-with-observed-abuse / unable), migration lineage reference
      (consuming `migration_edges`, never rewriting), quote parity gate,
      liquidity concentration, recent adds/removals, large-sell impact;
      unsupported/mismatched design → `DEGRADED_UNSUPPORTED` with NULL
      resolved-state fields (plan ADR-5) and explicit quality codes
      (`POOL_MATH_UNSUPPORTED`/`UNSUPPORTED_PROGRAM_VERSION`). Colocated
      tests including the unsupported-design case and state-completeness
      blocking. Traces: FR-SOLSEC-003, FR-SOLSEC-001, AC-130, AC-230.
- [ ] T013 Implement `src/provider-evidence.ts`: security-provider report
      persistence (§65.7 — one independent evidence group; verdict
      SAFE/RISK_DETECTED/UNABLE_TO_VERIFY; raw payload stored as evidence
      reference) and the comparison gate `resolveSecurityConflict(...)`:
      provider SAFE output can never override a deterministic CRITICAL/HIGH
      finding — the conflict row records PROVIDER_OPTIMISM_OVERRIDDEN and
      resolution names the deterministic side; missing provider data is
      recorded as absence and never reduces severity (§35.12). Colocated
      tests: override refused, conflict recorded, provider risk without
      corroboration stored as UNRESOLVED-class evidence (never promoted to
      deterministic severity). Traces: FR-SOLSEC-005, AC-131.
- [ ] T014 Implement `src/severity.ts`: the Appendix Q.1-derived severity
      mapping as a versioned pure policy over deterministic findings (known
      non-transferability/transfer hook blocking modeled exit, malicious
      program owner, active authority with observed abuse, unusable/
      withdrawable liquidity → CRITICAL; active freeze/permanent delegate
      with concentrated creator control, unknown required extension → HIGH;
      administrative authorities without observed abuse, incomplete coverage
      → MEDIUM; plus LOW/NONE), with the Q.1 caveat encoded: an authority is
      not automatically malicious — status, holder, observed behavior,
      revocation ability and context are evidence inputs. Colocated tests:
      deterministic, versioned, pure. Traces: FR-SOLSEC-001, FR-SOLSEC-002,
      FR-SOLSEC-003, AC-131.
- [ ] T015 Implement `src/system-registry.ts`: registry persistence +
      point-in-time exclusion queries (validity interval contains T) and
      `decideExclusion(...)` producing `system_address_exclusions_applied`
      audit rows for BOTH exclusions and refusals, with raw flow references
      preserved; refusal (low confidence / pending review / rejected /
      unknown role) degrades quality codes (`SYSTEM_ADDRESS_UNCERTAIN`)
      instead of silently removing evidence; expose the registry-backed
      exclusion set through the normalizer context seam
      (`EconomicTradeContext.knownRouterAccounts` extension — consumed, not
      rewritten). Colocated tests: floor refusals, point-in-time resolution,
      revision-forward behavior (a registry revision never rewrites
      historical attribution inputs — §37.3 chaos case). Traces:
      FR-SOLSEC-006, AC-132.
- [ ] T016 Implement `src/index.ts` exports; run the prohibited-capability
      scanner (`node scripts/scan-prohibited-capabilities/cli.mjs`) to
      confirm the read-only boundary holds across the new package (no
      transaction construction, signing, key material, or submission
      references). Traces: FR-SOLSEC-001…006.

## Phase 4 — Fixtures and acceptance/negative suites (blocks gates)

- [ ] T017 Author `tests/fixtures/solsec/token-extensions.json`: golden
      vectors for all §65.2 controls on synthetic SPL and Token-2022
      programs — active/revoked authority pairs per control, unknown
      extension case, expected control_state + severity per vector.
      Traces: FR-SOLSEC-001, FR-SOLSEC-002, AC-130.
- [ ] T018 Author `tests/fixtures/solsec/pool-security.json`: resolved-pool
      vectors (LP burned/locked/open, withdrawal authority states, migration
      lineage, quote parity pass/fail, concentration, removals, large-sell)
      plus the unsupported-design vector expecting DEGRADED_UNSUPPORTED with
      NULL resolved fields. Traces: FR-SOLSEC-003, AC-130, AC-230.
- [ ] T019 Author `tests/fixtures/solsec/provider-override.json`:
      deterministic-CRITICAL × provider-SAFE override vectors (expected
      conflict class, resolution side, preserved provider evidence),
      provider-risk-uncorroborated vectors, and missing-provider vectors
      (severity unchanged). Traces: FR-SOLSEC-005, AC-131.
- [ ] T020 Author `tests/fixtures/solsec/system-registry.json`: router/
      exchange/launchpad/fee-collector/program exclusion vectors at accepted
      role+confidence; low-confidence, pending-review, rejected, and
      unknown-role refusal vectors; a revision-forward vector (historical
      attribution inputs unchanged). Traces: FR-SOLSEC-006, AC-132.
- [ ] T021 Author `tests/acceptance/AC-130.spec.ts` +
      `tests/negative/AC-130.negative.spec.ts`: positive — SPL/Token-2022
      fixtures correctly detect supported authorities/extensions with
      versioned evidence rows and pool fixture resolves LP/withdrawal/
      migration/removal through the allowlisted adapter; negative — unknown
      required transfer semantics BLOCK the profile-requiring-complete-
      execution-modeling path (blocking verdict, no silent assumption),
      unsupported pool design refuses resolved fields, fabricated/malformed
      control rows are refused by schema. Traces: FR-SOLSEC-001, FR-SOLSEC-002,
      FR-SOLSEC-003, FR-SOLSEC-004, AC-130.
- [ ] T022 Author `tests/acceptance/AC-131.spec.ts` +
      `tests/negative/AC-131.negative.spec.ts`: positive — deterministic
      critical authority/transfer risk stands when external providers report
      safe/no-risk, conflict recorded and exposed, provider report preserved
      as independent evidence; negative — any path where provider safe output
      downgrades or clears deterministic severity is structurally refused;
      missing provider data cannot reduce risk as if evidence were negative.
      Traces: FR-SOLSEC-005, AC-131.
- [ ] T023 Author `tests/acceptance/AC-132.spec.ts` +
      `tests/negative/AC-132.negative.spec.ts`: positive — known router,
      exchange, launchpad, fee collector, and program accounts do not create
      false common-funder/insider edges in actor attribution outputs (fed
      through the registry exclusion seam), raw flows remain auditable;
      negative — sub-floor registry rows (low confidence, pending review,
      rejected, unknown role) are not excludable and instead degrade quality
      codes. Traces: FR-SOLSEC-006, AC-132.
- [ ] T024 Extend `tests/acceptance/AC-230.spec.ts` +
      `tests/negative/AC-230.negative.spec.ts` ADDITIVELY with a
      solsec-scoped describe block: pool-security assessment resolves only
      through the matching versioned decoder/adapter + signed manifest;
      unknown/mismatched design returns explicit DEGRADED_UNSUPPORTED —
      never generic constant-product output (existing content untouched,
      header trace list updated). Traces: FR-SOLSEC-003, AC-230.

## Phase 5 — Telemetry contract, manifest regen, and gates

- [ ] T025 Create `telemetry/solsec.catalog.json` (DECLARATIVE_CONTRACT_ONLY
      header, fields mirroring `packages/shared-schemas/src/solsec.ts`
      exactly, requirementRefs per event): `token.assessed`,
      `token.extension_parsed`, `token.transfer_semantics_verdict`,
      `pool.security_assessed`, `security.provider_report_received`,
      `security.conflict_recorded`, `system_registry.exclusion_decided`.
      Extend `tests/telemetry-catalog.spec.ts` — the plan-sanctioned
      central-parity scope exception (milestone plan-level decision 4) —
      pinning the new catalog to the authoritative schemas. Traces:
      FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-003, FR-SOLSEC-005,
      FR-SOLSEC-006.
- [ ] T026 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the
      milestone verification command on the canonical tree: `test -d
packages/solana-security && pnpm --filter @foresift/solana-security
test`; plus the extended central suites (`pnpm --filter
@foresift/persistence test`; `tests/telemetry-catalog.spec.ts`;
      AC-130/131/132 files). All green required. Traces: FR-SOLSEC-001…006
      (package-gate proof of every assigned requirement's substrate).
- [ ] T027 [executor: COORDINATOR] Regenerate the coordinator test manifest
      (`node scripts/automation/bun-migration-manifest.mjs --out
evidence/bun-migration/bun-migration-manifest.json`) after all new test
      files exist so `pnpm test`/`test:all` collect and classify them
      (PGlite-backed suites → DATABASE_PGLITE; OOM-safe per the test runtime
      contract). Mechanical bookkeeping (ADR-0020: coordinator-owned,
      zero-AI). Traces: FR-SOLSEC-001…006 (verification substrate for every
      assigned requirement).
- [ ] T028 [executor: COORDINATOR] [evidence: VERIFICATION_ONLY] Run the full
      aggregate gate `pnpm verify` and the integrity gate `pnpm spec:verify`
      at the pushed HEAD; require green (the complete Bun suite runs ONLY
      through the coordinator — never a bare `bun test` over the tree). If
      anything turns red outside writeScopes, classify per governance, fix
      only in-scope failures, and record the rest in the run's out-of-scope
      notes. Traces: FR-SOLSEC-001…006 (full suite + manifest integrity
      proof).

## Cross-artifact consistency analysis (speckit-analyze, completed at planning)

- **Coverage**: 6/6 assigned requirements traced (FR-SOLSEC-001…006);
  every assigned AC has an explicit owner: AC-130/131/132 authored here
  (T021–T023), AC-230/231 extended additively here (T024; AC-231 itself is
  regression-locked — authored by g0-first-party-observation), AC-133…136 and
  AC-233/237 regression-locked (authored by g1-data-truth-extensions and
  earlier packages), AC-232/234/235/236/238/239 owned by
  g1-execution-simulation per spec I2 and recorded in out-of-scope notes.
- **Traceability**: no task cites a requirement outside the package's
  assignment (validator-enforced); every task cites ≥1 FR-SOLSEC-* or its AC.
- **Scope**: every predicted write lands inside writeScopes except the two
  plan-sanctioned exceptions (T008 central migration registry +
  migrator family extension; T025 central telemetry parity suite) recorded
  here, in plan.md, and consistent with the live g1-data-truth precedent;
  `evidence/bun-migration/bun-migration-manifest.json` regen (T027) is
  mechanical bookkeeping per repo precedent (g0-first-party-observation T063).
- **Ordering**: Phase 1 → 2 → 3 → 4 → 5 dependencies flow through explicit
  T-id references; vocabularies (Phase 1) precede schemas and SQL; SQL
  (Phase 2) precedes analyzers (Phase 3); analyzers precede fixtures/suites
  (Phase 4); suites precede the manifest regen and gates (Phase 5).
- **Read-only law**: no task introduces trading/custody/signing/
  transaction-submission capability; T016 runs the prohibited-capability
  scanner as an explicit gate; withdrawal-authority and liquidity-removal
  fields are decoded evidence, never capabilities.
- **No placeholders**: no template markers, no unresolved clarification
  blocks anywhere in the scoped artifacts.
