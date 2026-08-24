# Tasks: g0-security-perimeter

**Input**: `specs/g0-security-perimeter/spec.md`, `specs/g0-security-perimeter/plan.md`
**Traceability rule**: every task cites at least one assigned requirement
(FR-SEC-001 through FR-SEC-012) or an acceptance criterion of those
requirements. Requirement IDs not assigned to this package never appear here.

Format: `- [ ] T### [P?]` — **[P]** = parallelizable with its neighbors
(disjoint files). Tests are mandatory per PRD evidence rules: every acceptance
criterion listed in spec.md §3 gets BOTH its manifest-declared positive spec
(`tests/acceptance/AC-*.spec.ts`) AND failure-path spec
(`tests/negative/AC-*.negative.spec.ts`). No task creates or simulates a real
prohibited capability anywhere outside the inert scanner self-test corpus.

## Phase A — Enabling change and foundation (blocks everything)

- [x] T101 Extend the migration filename-family pattern in
      `packages/persistence/src/migrator.ts` from `(data|dr)` to
      `(data|dr|sec)` and update its header/doc comments (plan.md material
      decision 1; the ONLY content edit outside binding writeScopes).
      Land FIRST, run `pnpm --filter @foresift/persistence test` and require
      the existing migrator suite green untouched. Traces: FR-SEC-002,
      FR-SEC-008, FR-SEC-011 (their declared `g0_sec_*.sql` persistence refs
      are otherwise unapplyable), and by extension every FR-SEC requirement's
      storage layer.
- [x] T102 Scaffold `packages/security` (`@foresift/security`): package.json
      (workspace deps on domain/persistence/object-store/shared-schemas),
      tsconfig extending `tsconfig.base.json`, local `vitest.config.ts`
      mirroring root timeout budgets (plan material decision 7), `src/index.ts`.
      Verify `pnpm install` regenerates the lockfile mechanically and
      `pnpm --filter @foresift/security test` runs (empty suite OK).
      Traces: FR-SEC-001…FR-SEC-012 (carrier package for ten of twelve).
- [x] T103 [P] Scaffold `packages/tenant-isolation` (`@foresift/tenant-isolation`)
      identically (deps: domain/shared-schemas/security where needed).
      Traces: FR-SEC-009 (owner package), FR-SEC-001 (declared implRef).
- [x] T104 [P] Add `packages/shared-schemas/src/sec.ts` with the authoritative
      Zod schemas for: audit event/checkpoint records, step-up policy and
      challenge proofs, action-gate decisions, MCP origin/protocol verdicts,
      OAuth token bindings, egress allowlists and decisions, untrusted-content
      envelopes, secret lifecycle records, import artifact manifests +
      quarantine states + scan findings, tenant contexts, abuse decisions,
      security incidents, capability pauses, activation events, threat-model
      register entries, prohibited-capability findings, claims-policy and
      public-output redaction results. Export from `src/index.ts`; add
      `test/sec.spec.ts` covering accept/refuse matrices per schema
      (`.strict()` unknown-key refusals included). Traces: FR-SEC-001,
      FR-SEC-002, FR-SEC-007, FR-SEC-008, FR-SEC-009 (manifest schemaRefs
      target `packages/shared-schemas/src/sec.ts`).
- [x] T105 Define `SecErrorCode` stable machine codes in
      `packages/security/src/errors.ts` following the repository typed-error
      style (plan material decision 3): audit-integrity, step-up/action-gate,
      origin/protocol/OAuth, egress, untrusted-content, secrets, supply-chain,
      import-quarantine, incident, pause/reactivation, claims/redaction, and
      prohibited-capability refusal classes. Traces: FR-SEC-001 through
      FR-SEC-012 (typed fail-closed error contract for every perimeter gate;
      Constitution VIII/XII).
- [x] T106 Write the four migrations `g0_sec_0001_audit_chain.sql`,
      `g0_sec_0002_mcp_credentials.sql`,
      `g0_sec_0003_import_quarantine.sql`,
      `g0_sec_0004_incidents_pauses.sql` exactly per plan.md Data Model
      (SQL-enforced immutability triggers, CHECK-constrained state machines
      including never-ACTIVE quarantine, severity taxonomy, smallest-scope
      pauses, append-only activation ledger), plus their Drizzle mirrors under
      `packages/security/src/generated/` parity-tested against
      information_schema. Migrations must apply cleanly over a fully migrated
      PGlite database containing all proven data/dr sets. Traces: FR-SEC-002,
      FR-SEC-008, FR-SEC-011 (table owners); AC-259, AC-278, AC-279 substrates.
- [x] T107 [P] Write `telemetry/sec.catalog.json` in the established declarative
      catalog format: events for audit entry/checkpoint/verification-failure,
      step-up completion/refusal, egress blocks, credential revocation,
      import quarantine/rejection, incident opening, capability pause/resume,
      cross-tenant access blocked, abuse control triggered, scan violation
      found — each with requirementRefs into this package and field lists
      mirroring the sec schemas exactly. Traces: FR-SEC-002, FR-SEC-003,
      FR-SEC-004, FR-SEC-007, FR-SEC-008, FR-SEC-009, FR-SEC-010, FR-SEC-011
      (manifest telemetryRefs `telemetry/sec.*`).

## Phase B — Audit chain, incidents, pauses (integrity core)

- [x] T108 Implement `src/audit-categories.ts`: the §35.9 coverage vocabulary
      as typed event classes (authentication/authorization, tool/resource
      access, provider/collector calls and blocked operations,
      configuration/capability/cost/rights/source-dependence/pool-adapter/
      public-gate changes, approvals/step-up/imports/promotions/pauses/
      retirements/rollbacks, secret lifecycle, incidents and recovery) with a
      completeness test asserting every §35.9 bullet maps to a class.
      Traces: FR-SEC-002.
- [x] T109 Implement `src/audit-chain.ts`: canonical-JSON payload hashing,
      `entry_hash = sha256(prev_entry_hash || canonical_payload)` chaining,
      fenced appends against SQL immutability triggers, periodic batch
      checkpoints written to `sec_audit_checkpoints` AND mirrored through the
      object store adapter (plan material decision 5), and a continuous
      verifier returning first-divergence diagnostics for gaps, reordering,
      mutation, deletion, and chain breaks; verification failure raises the
      critical incident (with T110) and the high-impact gate consults audit
      health (with T114). Traces: FR-SEC-002; AC-259.
- [x] T110 Implement `src/incidents.ts` over `security_incidents`: open with
      severity (SEV1..SEV4)/owner/kind, containment-state transitions,
      evidence-reference preservation, notification-policy flags,
      recovery-verification and postmortem linkage, resolution rules.
      Traces: FR-SEC-011.
- [x] T111 Implement `src/gate-pause.ts` over `capability_pauses` +
      `activation_events`: minimal-scope pause creation on critical gate
      failure with durable reason, machine-checked auto-reactivation refusal,
      explicit audited resume; immutable approved-set snapshots, new
      activation events on restore/rollback, historical-decision preservation,
      actionable-candidate re-evaluation markers for later consumers.
      Traces: FR-SEC-011, FR-SEC-012; AC-278, AC-279 (ledger substrate).

## Phase C — Step-up gate and transport-security primitives

- [ ] T112 Implement `src/csrf.ts` (double-submit + origin-binding validation)
      and `src/action-gate.ts`: `evaluateHighImpactAction` enforcing fresh
      phishing-resistant step-up proof (authenticator-class policy refusing
      TOTP-only), exact authorization scope match against the Appendix B
      `admin:high:*` class, CSRF validity, idempotency key, reason entry, and
      audit emission on every decision; freshness windows evaluated via
      injected clock. Refusal reasons typed per missing dimension.
      Traces: FR-SEC-001; AC-274.
- [ ] T113 Implement `src/mcp-origin.ts`: exact-match Origin decision engine —
      allowlist hit reaches authentication; present-but-invalid origins
      (punycode-confused, trailing-dot, mixed-scheme, wrong-port, wrong-host)
      refused BEFORE session/tool/resource processing with typed verdicts
      consumable as HTTP 403 by later transport wiring (plan material
      decision 4). Absent-Origin policy configurable per deployment mode.
      Traces: FR-SEC-001; AC-250.
- [ ] T114 Wire audit-health consultation into the high-impact gate: while a
      critical audit-verification incident is open, high-impact activation
      actions refuse. Traces: FR-SEC-001, FR-SEC-002, FR-SEC-011 (§35.9
      block rule); AC-274, AC-259 integration.
- [ ] T115 Implement `src/mcp-protocol-guard.ts`: protocol-revision allowlist
      (ADR-004 baseline), content-type/method validation, message-size caps,
      session binding checks (actor/profile/origin/revision), resumable-cursor
      authorization — deterministic typed failures without tool execution.
      Traces: FR-SEC-001; AC-251.
- [ ] T116 [P] Implement `src/oauth-binding.ts`: PKCE required, exact redirect
      URI matching, audience/resource-indicator binding, expiry, scope
      narrowing, upstream-token-passthrough refusal. Traces: FR-SEC-001; AC-253.
- [ ] T117 Implement the MCP credential lifecycle over
      `g0_sec_0002_mcp_credentials`: ≥256-bit entropy generation via
      injectable entropy seam, keyed hash at rest (raw secret shown once),
      scope set, origin policy binding, profile/tool/resource/entity bounds,
      rate-limit class, expiry, optional IP constraints, last-used metadata,
      independent per-credential revocation. Traces: FR-SEC-001; AC-053.

## Phase D — Egress, untrusted content, webhooks, abuse

- [ ] T118 Implement `src/egress.ts`: exact egress allowlists per plane
      (control plane / collector / Alpha Lab), URL parsing defenses (encoded
      hosts, userinfo, mixed schemes, custom/onion schemes, unsafe ports),
      IP-range denial (loopback, private, link-local, metadata; IPv4+IPv6),
      resolver-seam resolve→pin→connect flow, redirect revalidation with
      per-hop origin approval and redirect-count cap, response byte/time/
      decompression-ratio/content-type caps, TLS enforcement. Deny-by-default:
      anything not explicitly allowed refuses with a typed reason.
      Traces: FR-SEC-004; AC-051, AC-257.
- [ ] T119 Implement `src/untrusted-content.ts`: content-class labeling for
      the seven untrusted sources, refusal of insertion into
      system/developer instruction roles, structured-extraction envelope with
      source labels, render-safety validators (Markdown/HTML/SVG sanitization
      policy, remote-image policy, link rel/noopener-noreferrer + exfiltration-
      resistant link policy, confusable-address warning hooks), memory-isolation
      key derivation by actor/session/workspace. Traces: FR-SEC-005; AC-051,
      AC-052 (context-envelope cooperation with T126), AC-258.
- [ ] T120 Implement `src/webhook-integrity.ts`: cryptographic signature
      verification (injectable verifier), timestamp + maximum-age checks,
      replay prevention via message/event-ID + payload-hash cache,
      unsigned/stale/malformed callback refusal, fixed-endpoint rule
      (reconnect/backfill URLs come from configuration, never event payloads),
      malformed-event-cannot-advance-checkpoint contract hook.
      Traces: FR-SEC-005; AC-051 (forged scheduler webhook battery).
- [ ] T121 Implement `src/abuse-controls.ts`: flood limiter, expensive-query
      amplification cost weighting, quota-exhaustion degrade-not-bypass rules,
      scraping/enumeration detection counters, prompt-attack screening hook,
      protected-risk-monitoring allowance (an explicit non-weakening set that
      abuse responses can never suspend), feedback-loop guard stubs for
      market-manipulation coordination signals. Deterministic clock only.
      Traces: FR-SEC-010.

## Phase E — Negative capability, supply chain, secrets, imports, claims

- [ ] T122 Build `scripts/scan-prohibited-capabilities/`: `catalog.json`
      (declarative prohibited-pattern categories per §35.7/§41.1: private-key/
      seed, signing, transaction build/sign/submit, swap/order execution,
      bridge/staking, custody/wallet management, exchange trading, copy
      trading), `scan.mjs` (source + dependency-manifest scanning with
      code-context signals), `inventory.mjs` (route/tool/schema inventory
      collection + read-only-wallet-intelligence allowlist verification),
      `cli.mjs` (exit 0 clean / nonzero findings, stable JSON report),
      README documenting the fixture-corpus exclusion rule. Traces:
      FR-SEC-003; AC-050, AC-254.
- [ ] T123 Implement `src/negative-capability.ts` runtime canary consuming the
      SAME `catalog.json` (plan material decision 2): registered-schema/route
      inventory checks, GMGN-shaped read-only query admission vs forbidden
      variant rejection, environment-schema forbidden-name scan, plus the
      parity test asserting CLI and canary classify every fixture identically.
      Traces: FR-SEC-003; AC-050, AC-254, AC-255.
- [ ] T124 [P] Implement `src/decoder-authority.ts`: configuration validator
      refusing a deprecated parser marked sole/authoritative economic-event
      decoder while raw-operation + local decoding passes. Traces: FR-SEC-003;
      AC-256.
- [ ] T125 Implement `src/supply-chain.ts`: pinning verification (exact
      versions for production deps), lockfile presence/reproducibility record,
      SBOM record schema emission, provenance-attestation record fields,
      build-hash recording hooks, restricted-lifecycle-script check,
      network/filesystem/process/crypto/dynamic-code dependency review flags.
      Traces: FR-SEC-006; AC-254 (dependency scan surface).
- [ ] T126 Implement `src/secrets-policy.ts`: secret classification registry,
      context-envelope guard refusing classified material toward model
      context, log/trace redaction policy, export/UI denial rules, Alpha Lab
      export prohibition flag, environment separation checks, rotation/
      revocation/overlap-window/last-used lifecycle records over keyed
      references (never material), incident-triggered invalidation hookup,
      prohibited-secret-class configuration validation. Traces: FR-SEC-007;
      AC-052.
- [ ] T127 Implement `src/import-gating.ts` over the quarantine state machine:
      format allowlist (versioned JSON/JSONL, Parquet, approved compressed
      containers), file-count/path/size/decompression limits, symlink/path-
      traversal/executable-format refusal, asymmetric signature verification
      against trusted producer public-key allowlist (injectable verifier),
      content-hash/canonical-serialization checks, producer trust/expiry/
      revocation, step-up approval reference requirement, quarantine intake +
      content-scanning stage, terminal states REJECTED | SHADOW_ELIGIBLE only
      (no ACTIVE transition exists), isolated-parsing boundary contract.
      Traces: FR-SEC-008; AC-051 (import attack fixtures), AC-274 (step-up
      coupling).
- [ ] T128 Implement `src/claims-policy.ts`: prohibited-claim pattern classes
      (guaranteed-profit, risk-free, universal-recall, uncalibrated
      probability, unsupported performance) across marketing/UI/API/export
      channels with clean-text controls; public-output envelope validator
      requiring evidence/timestamps/execution-assumptions/limitations/
      disclaimer AND stripping detector thresholds + sensitive entity details.
      Traces: FR-SEC-010 (claims-abuse surface), FR-SEC-012 (public
      distribution boundary); AC-276, AC-277.

## Phase F — Tenant isolation

- [ ] T129 Implement `packages/tenant-isolation/src/tenant-context.ts`:
      TenantContext derivation, mode enum (PERSONAL | WORKSPACE | PUBLIC),
      namespaced key derivation for cache, queues, sessions, quotas, logs,
      metrics, and model-context partitions. Traces: FR-SEC-009.
- [ ] T130 Implement `row-scope.ts`: mandatory tenant predicate composition
      for queries; refuse unscoped queries whenever isolation mode is active
      (fail-closed); row/artifact ownership assertions. Traces: FR-SEC-009;
      AC-275.
- [ ] T131 Implement `signed-url.ts` (tenant-bound, expiring, audience-bound
      minting/validation) and `resource-access.ts` (cross-tenant resource URI
      authorization refusing signed-URL, range, redirect, and path-confusion
      bypass vectors without original scope+rights). Traces: FR-SEC-009,
      FR-SEC-001; AC-252, AC-275.

## Phase G — Runbooks and threat models

- [ ] T132 Write `docs/runbooks/security/incident-response.md` (severity
      matrix, owner assignment, containment steps, evidence preservation,
      credential rotation duties, notification policy, recovery verification,
      postmortem template, regression-test duty),
      `credential-compromise.md`, `audit-chain-failure.md`, and
      `emergency-dependency-revocation.md` per §35.8/§35.9/§35.11 duties.
      Traces: FR-SEC-011, FR-SEC-006 (revocation runbook), FR-SEC-002
      (audit-failure runbook), FR-SEC-007 (compromise runbook).
- [ ] T133 Write `docs/runbooks/security/threat-models/register.md` covering
      ALL eleven boundaries (MCP, admin, webhooks, providers, collector,
      model, database, object store, Alpha Lab, notifications, public
      distribution): assets, trust assumptions (§9.3), top threats, controls
      delivered by this package, and mapped automated suites — naming later
      packages' future suites explicitly where a subsystem arrives later.
      A conformance test asserts register boundaries stay enumerated and each
      mapped suite path exists or is marked deferred-to-package.
      Traces: FR-SEC-012.

## Phase H — Fixture corpus and manifest-declared test suites

- [ ] T134 Create `tests/fixtures/sec/`: scanner self-test corpus (one inert
      sample per prohibited category that MUST be detected; read-only wallet
      intelligence positive control; GMGN query pair), SSRF attack fixtures,
      injection/Malicious-Markdown/webhook forgery fixtures, import-attack
      fixtures (pickle-style bytes, path traversal archives, oversize,
      signature mismatch). All inert by construction; documented exclusion
      from production scans. Traces: FR-SEC-003, FR-SEC-004, FR-SEC-005,
      FR-SEC-008; AC-050, AC-051, AC-254, AC-255, AC-257, AC-258.
- [ ] T135 Write acceptance specs `tests/acceptance/AC-050.spec.ts`,
      `tests/acceptance/AC-254.spec.ts`, `tests/acceptance/AC-255.spec.ts`,
      `tests/acceptance/AC-256.spec.ts` (scan surfaces green over the tree;
      detection proven per category; GMGN pair; decoder authority).
      Traces: FR-SEC-003.
- [ ] T136 [P] Write acceptance specs `tests/acceptance/AC-051.spec.ts`,
      `tests/acceptance/AC-257.spec.ts`, `tests/acceptance/AC-258.spec.ts`
      (attack batteries pass on clean inputs; every bypass class fails
      closed). Traces: FR-SEC-004, FR-SEC-005.
- [ ] T137 [P] Write acceptance specs `tests/acceptance/AC-052.spec.ts`,
      `tests/acceptance/AC-053.spec.ts` (secret-hygiene flows; credential
      lifecycle). Traces: FR-SEC-007, FR-SEC-001.
- [ ] T138 [P] Write acceptance specs `tests/acceptance/AC-250.spec.ts`,
      `tests/acceptance/AC-251.spec.ts`, `tests/acceptance/AC-252.spec.ts`,
      `tests/acceptance/AC-253.spec.ts` (origin/protocol/resource/OAuth
      primitives admit valid traffic). Traces: FR-SEC-001, FR-SEC-009.
- [ ] T139 Write acceptance spec `tests/acceptance/AC-259.spec.ts`
      (append → checkpoint → independent verification green end-to-end on
      PGlite + object store). Traces: FR-SEC-002.
- [ ] T140 [P] Write acceptance specs `tests/acceptance/AC-274.spec.ts`,
      `tests/acceptance/AC-275.spec.ts`, `tests/acceptance/AC-276.spec.ts`,
      `tests/acceptance/AC-277.spec.ts`, `tests/acceptance/AC-278.spec.ts`,
      `tests/acceptance/AC-279.spec.ts` (gate admits complete requests;
      isolation matrix holds; claims/redaction pass compliant outputs;
      pause/rollback semantics correct). Traces: FR-SEC-001, FR-SEC-009,
      FR-SEC-010, FR-SEC-011, FR-SEC-012.
- [ ] T141 Write negative specs `tests/negative/AC-050.negative.spec.ts`,
      `tests/negative/AC-254.negative.spec.ts`,
      `tests/negative/AC-255.negative.spec.ts`,
      `tests/negative/AC-256.negative.spec.ts` (each prohibited-category
      fixture DETECTED; tampered inventories refuse; forbidden variants fail
      build/runtime policy). Traces: FR-SEC-003.
- [ ] T142 [P] Write negative specs `tests/negative/AC-051.negative.spec.ts`,
      `tests/negative/AC-257.negative.spec.ts`,
      `tests/negative/AC-258.negative.spec.ts` (full SSRF battery incl.
      rebinding/IPv6/encoded/userinfo/mixed-scheme/oversize/slow-stream;
      webhook forgery set; injection-containment mutations attempted and
      refused). Traces: FR-SEC-004, FR-SEC-005.
- [ ] T143 [P] Write negative specs `tests/negative/AC-052.negative.spec.ts`,
      `tests/negative/AC-053.negative.spec.ts` (classified material refused
      toward context/log/trace/export/UI; revoked/expired/misused credentials
      refused). Traces: FR-SEC-007, FR-SEC-001.
- [ ] T144 [P] Write negative specs `tests/negative/AC-250.negative.spec.ts`,
      `tests/negative/AC-251.negative.spec.ts`,
      `tests/negative/AC-252.negative.spec.ts`,
      `tests/negative/AC-253.negative.spec.ts` (every listed bypass vector
      refused deterministically before processing). Traces: FR-SEC-001,
      FR-SEC-009.
- [ ] T145 Write negative spec `tests/negative/AC-259.negative.spec.ts`
      (mutation/deletion/insertion/reordering/chain-break each detected;
      checkpoint-vs-object-copy mismatch detected; immutability triggers
      refuse SQL-level tampering). Traces: FR-SEC-002.
- [ ] T146 [P] Write negative specs `tests/negative/AC-274.negative.spec.ts`
      (each missing/stale dimension separately refused; TOTP-only
      insufficient), `tests/negative/AC-275.negative.spec.ts`
      (eleven-surface cross-tenant matrix),
      `tests/negative/AC-276.negative.spec.ts`,
      `tests/negative/AC-277.negative.spec.ts` (claim classes refused;
      disclosure fields missing refused; leakage stripped),
      `tests/negative/AC-278.negative.spec.ts`,
      `tests/negative/AC-279.negative.spec.ts` (auto-reactivation refused;
      history mutation refused; resumption gated on re-evaluation marker).
      Traces: FR-SEC-001, FR-SEC-009, FR-SEC-010, FR-SEC-011, FR-SEC-012.

## Phase I — Convergence verification

- [ ] T147 Run the three milestone verification commands declared for this
      package in `specs/implementation/current-milestone.json` (the security
      package suite, the tenant-isolation package suite, and the scan CLI) —
      all green at HEAD. The exact command strings are reproduced in the
      fenced block at the end of this file; run them verbatim from the
      repository root. Traces: FR-SEC-001 through FR-SEC-012 (package-wide
      proof).

- [ ] T148 Run `pnpm verify` (= spec:verify, format:check, lint, typecheck,
      full tests) and require green at HEAD; prove the 40 manifest-declared
      test files exist and pass; confirm migrations apply over the full
      proven migration set. Anything red is classified per governance and
      fixed ONLY within writeScopes (plus the single justified migrator
      change); everything else goes to out-of-scope notes. Traces:
      FR-SEC-001 through FR-SEC-012.
- [ ] T149 Scope-and-boundary guard: `git status`/`git diff` versus base shows
      changes ONLY inside binding writeScopes plus the justified
      `packages/persistence/src/migrator.ts` pattern extension and mechanical
      lockfile regeneration; grep the delivered tree (excluding the sanctioned
      fixture corpus and these planning artifacts) for prohibited-capability
      patterns with the project's own scanner and require clean. Traces:
      FR-SEC-001 through FR-SEC-012 (INV-001 permanence).
- [ ] T150 Cross-artifact consistency sweep: scoped artifacts free of template
      placeholders; every task above traces only FR-SEC requirements; work
      committed additively in coherent units so the stage never ends on a
      dirty tracked tree; corrections land as new commits; product source
      reaches main only via CI-gated PRs. Traces: FR-SEC-001 through
      FR-SEC-012.

## Traceability matrix (AC → tasks)

| AC     | Tasks                             |
| ------ | --------------------------------- |
| AC-050 | T122, T123, T134–T136, T141       |
| AC-051 | T118–T120, T127, T134, T136, T142 |
| AC-052 | T119, T126, T137, T143            |
| AC-053 | T117, T137, T143                  |
| AC-250 | T113, T138, T144                  |
| AC-251 | T115, T138, T144                  |
| AC-252 | T131, T138, T144                  |
| AC-253 | T116, T138, T144                  |
| AC-254 | T122, T123, T125, T135, T141      |
| AC-255 | T123, T134–T136, T141             |
| AC-256 | T124, T135, T141                  |
| AC-257 | T118, T134, T136, T142            |
| AC-258 | T119, T134, T136, T142            |
| AC-259 | T106, T108, T109, T139, T145      |
| AC-274 | T112, T114, T140, T146            |
| AC-275 | T129–T131, T140, T146             |
| AC-276 | T128, T140, T146                  |
| AC-277 | T128, T140, T146                  |
| AC-278 | T106, T111, T140, T146            |
| AC-279 | T106, T111, T140, T146            |

Every phase closes with its focused checks green before later phases begin.
No task creates trading, custody, signing, private-key, or
transaction-submission capability anywhere (INV-001); no task edits anything
outside the binding writeScopes except the single justified migrator pattern
extension recorded in plan.md material decision 1 and the mechanical lockfile
regeneration.

## Milestone verification commands (referenced by T147; run verbatim)

```sh
test -d packages/security && pnpm --filter @foresift/security test
test -d packages/tenant-isolation && pnpm --filter @foresift/tenant-isolation test
node scripts/scan-prohibited-capabilities/cli.mjs
```
