# Implementation Plan: g0-security-perimeter

**Branch**: `archon/task-foresift-g0-security-perimeter` | **Date**: 2026-08-24
**Spec**: `specs/g0-security-perimeter/spec.md` (scoped derivative; PRD-subordinate)
**Input**: Assigned requirements FR-SEC-001 through FR-SEC-012 from
`specs/implementation/current-milestone.json` (milestone G0, risk CRITICAL,
generation 0). Dependency `g0-contracts-data-truth` is PROVEN and merged:
the persistence engine, migrator, object store, shared schemas, and domain
substrate exist and are green.

## Summary

This is a **build-out generation**: the security perimeter does not exist yet
(`packages/security`, `packages/tenant-isolation`,
`scripts/scan-prohibited-capabilities`, `migrations/g0_sec_*`,
`telemetry/sec.*`, `docs/runbooks/**` are all absent from the tree today).
The package delivers:

1. **Two new workspace packages** — `@foresift/security` (audit chain,
   step-up/action gate, egress guard, untrusted-content isolation, secrets and
   supply-chain policy, import gating, MCP/OAuth policy primitives, abuse
   controls, incidents/pauses) and `@foresift/tenant-isolation` (tenant
   context, namespaced keys, row scoping, signed URLs, resource access).
   Root configs are already glob-driven (data-truth deliverable), so neither
   package needs any root-config edit.
2. **The negative-capability proof gate** — `scripts/scan-prohibited-
capabilities/cli.mjs`, a zero-dependency Node CLI proving absence of every
   §35.7 prohibited category over source, dependency manifests, route/tool
   inventories, environment schemas, plus a runtime canary library in
   `packages/security`; both engines consume ONE declarative pattern catalog
   (`catalog.json`) with a parity-pinned test.
3. **Four SQL migrations** (`g0_sec_0001..0004`) — append-only hash-chained
   audit tables with SQL-enforced immutability, MCP credential lifecycle,
   import-quarantine state machine (never-ACTIVE constraint), security
   incidents + capability pauses + activation-event ledger.
4. **Authoritative schemas** — `packages/shared-schemas/src/sec.ts` (Zod,
   repository ADR-0013), exported from the package index.
5. **Declarative telemetry contract** — `telemetry/sec.catalog.json` in the
   established catalog format (emitter wiring is a later milestone).
6. **Runbooks + threat models** — incident response, credential compromise,
   audit-chain failure, emergency dependency revocation, and the eleven-
   boundary threat-model register under `docs/runbooks/security/`.
7. **The full manifest-declared evidence floor** — 20 acceptance + 20 negative
   spec files covering AC-050..053, AC-250..259, AC-274..279, plus scanner
   self-test fixtures under `tests/fixtures/sec/`.

One supporting change outside write scopes is required and justified below
(migrator filename-family extension).

## Technical Context

**Language/Version**: TypeScript 5.9.x (NodeNext, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) on Node.js ≥24;
pnpm workspace. The scan CLI is plain `.mjs` (zero dependencies, runs before
any install step could be trusted).

**Primary Dependencies** (all already installed and locked):

- `zod` — authoritative schemas in `packages/shared-schemas` (ADR-0013).
- `drizzle-orm` — typed mirror of SQL migrations per product ADR-001.
- `@electric-sql/pglite` — deterministic in-process PostgreSQL test engine
  (repository ADR-0014).
- `vitest` — repo test runner; new packages get local vitest runner configs
  exactly like the proven packages (sibling material decision 5).
- Existing workspace substrate: `@foresift/domain` (ClockPort/fixedClock,
  ForesiftError), `@foresift/persistence` (DatabaseEngine, applyMigrations),
  `@foresift/object-store` (ObjectStoreAdapter for independent audit
  checkpoints), `@foresift/shared-schemas`.

**Storage**: PostgreSQL schema via `migrations/g0_sec_0001..0004_*.sql`
(source of truth, applied by the existing deterministic migrator) with
Drizzle mirrors parity-tested like the proven migrations; audit checkpoints
mirrored to the object store through the §14.8 staged-commit adapter already
delivered.

**Testing**: Vitest three layers — colocated package suites under
`packages/*/test/`; acceptance specs `tests/acceptance/AC-*.spec.ts`; negative
specs `tests/negative/AC-*.negative.spec.ts`. PGlite-backed suites reuse
`tests/acceptance/helpers.ts` (`makeTestDatabase`, `MIGRATIONS_DIR`) which
apply ALL migrations, so the sec set integrates automatically. Deterministic
time via injected ClockPort everywhere a freshness/expiry/window decision is
made. Scanner self-test corpus lives ONLY under `tests/fixtures/sec/` and is
excluded from production scans by an explicit, reviewed inventory rule.

**Target Platform**: Linux CI + local dev; single deployable modular monolith
(Constitution III). No new services, queues, or brokers.

**Constraints**: read-only product boundary (INV-001 / Constitution IV);
deterministic verification (XI); positive AND failure-path testing (XII);
fail-closed external integrations (VIII); least privilege and no secret
material anywhere (XV); every task traces to an assigned requirement or its
acceptance criteria (X).

## Constitution Check

_GATE: must pass before implementation. Re-checked after design._

| Principle                             | Verdict | Evidence                                                                                                                            |
| ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| I Product-Contract Authority          | PASS    | Scope limited to the twelve assigned requirements; `docs/spec/**` untouched; spec.md marked subordinate.                            |
| II Greenfield Architecture            | PASS    | Design derived from PRD §§9.3/35/37/41 + Appendix D ADRs; predecessor repo never consulted.                                         |
| III Modular-Monolith-First Simplicity | PASS    | Two library packages + one script directory inside one deployable; no services, brokers, or speculative abstractions.               |
| IV Read-Only Product Boundary         | PASS    | The package's entire purpose is proving/enforcing INV-001; scanners, canaries, and fixtures contain no executable prohibited path.  |
| V Point-in-Time Correctness           | PASS    | Audit records carry occurrence instants; pause/activation ledger preserves historical state read-only.                              |
| VI Event-Time / Earliest-Availability | PASS    | Not primary here; no availability semantics are redefined by this package.                                                          |
| VII Provenance & Evidence             | PASS    | Audit chain links actor/action/subject/hashes; import gate records producer/hash/signature evidence; threat register maps suites.   |
| VIII Fail-Closed Integrations         | PASS    | Every gate refuses on ambiguity: unknown origin, unresolvable policy, failed verification, unsupported format — all typed refusals. |
| IX Provider/Capability Abstraction    | PASS    | DNS resolver, signature verifiers, entropy source behind injectable seams; no vendor SDK dependency.                                |
| X Requirement Traceability            | PASS    | tasks.md maps each task to FR-SEC IDs; validator-enforced; no foreign requirement ID appears there.                                 |
| XI Deterministic Verification         | PASS    | Gates are code: scan CLI exit status, vitest suites, `pnpm verify` — identical locally and in CI.                                   |
| XII Positive AND Failure-Path Testing | PASS    | All 20 assigned ACs ship acceptance AND negative specs per manifest testRefs; corruption/bypass/rebinding batteries included.       |
| XIII Replay/Recovery/Idempotency      | PASS    | Idempotency-key requirement in the high-impact gate; fenced audit appends; checkpoint verification idempotent and re-runnable.      |
| XIV Durable Resumable Operations      | PASS    | Work persists on disk/git additively; continuation state lives in these artifacts, not conversational memory.                       |
| XV Security & Least Privilege         | PASS    | Only keyed hashes and key references stored; no secret material committed; deny-by-default posture in every module.                 |
| XVI Autonomous-Agent Governance       | PASS    | Material decisions recorded here; out-of-scope gaps routed to the run's notes file, never fixed out of scope.                       |
| XVII Additive Git History             | PASS    | Coherent units committed additively on the package branch; product source reaches main only through CI-gated PRs.                   |
| XVIII No AI Claim Is Completion       | PASS    | Completion decided by `package-plan-complete.mjs` now and by `pnpm verify`/CI later.                                                |

## Project Structure

### Documentation (this feature)

```text
specs/g0-security-perimeter/
  spec.md      # scoped derivative (PRD-subordinate)
  plan.md      # this file
  tasks.md     # ordered traceable breakdown
```

Generation 0 uses the bare package id only — the deterministic guards resolve
`specs/g0-security-perimeter/` directly; no mirrored `@g<N>` directory exists
for this package.

### Source deltas (all inside binding writeScopes)

```text
packages/security/
  package.json  tsconfig.json  vitest.config.ts     # @foresift/security scaffold
  src/errors.ts                # SecErrorCode vocabulary (typed, stable codes)
  src/audit-chain.ts           # FR-SEC-002 append/verify/checkpoint over DatabaseEngine + ObjectStoreAdapter
  src/audit-categories.ts      # §35.9 coverage vocabulary (typed event classes)
  src/action-gate.ts           # FR-SEC-001 evaluateHighImpactAction (step-up freshness, authenticator class, CSRF, idempotency, reason, audit)
  src/csrf.ts                  # double-submit/origin-binding token validation primitives
  src/mcp-origin.ts            # AC-250 exact Origin decision engine
  src/mcp-protocol-guard.ts    # AC-251 revision/content-type/size/session/cursor rules
  src/oauth-binding.ts         # AC-253 PKCE/redirect/audience/expiry/scope/passthrough validators
  src/egress.ts                # FR-SEC-004 URL guard + resolver seam + redirect/size/time/TLS caps
  src/untrusted-content.ts     # FR-SEC-005 envelope, instruction-role refusal, structured extraction, render safety (§35.5)
  src/webhook-integrity.ts     # signature/timestamp/max-age/replay-cache validation (§35.6 primitives)
  src/supply-chain.ts          # FR-SEC-006 pinning/lockfile/SBOM/provenance/build-hash record checks
  src/secrets-policy.ts        # FR-SEC-007 classification, context/log/export guards, env forbidden-name scan, lifecycle records
  src/import-gating.ts         # FR-SEC-008 format allowlist, limits, signature/hash/producer trust, quarantine state machine
  src/negative-capability.ts   # FR-SEC-003 runtime canary: schema/route/inventory checks consuming the shared catalog
  src/decoder-authority.ts     # AC-256 deprecated-parser authority policy validator
  src/abuse-controls.ts        # FR-SEC-010 flood/amplification/enumeration policies, protected-monitoring allowance
  src/incidents.ts             # FR-SEC-011 incident records, severity taxonomy, containment states
  src/gate-pause.ts            # AC-278/279 scoped pauses (no auto-reactivation), activation events, rollback ledger
  src/claims-policy.ts         # AC-276 content-policy validator; AC-277 public-output redaction engine
  src/index.ts                 # public surface
  test/*.spec.ts               # colocated unit/integration suites

packages/tenant-isolation/
  package.json  tsconfig.json  vitest.config.ts     # @foresift/tenant-isolation scaffold
  src/tenant-context.ts        # TenantContext, mode (PERSONAL|WORKSPACE|PUBLIC), namespaced key derivation for cache/queue/session/quota/log/metric/model-context
  src/row-scope.ts             # mandatory tenant predicate helpers; refuse unscoped queries when isolation active
  src/signed-url.ts            # tenant-bound, expiring, audience-bound signed URLs
  src/resource-access.ts       # AC-252 cross-tenant resource URI authorization (scope+rights+vector defenses)
  src/index.ts
  test/*.spec.ts

scripts/scan-prohibited-capabilities/
  cli.mjs                      # zero-dep entrypoint: node scripts/scan-prohibited-capabilities/cli.mjs
  catalog.json                 # single declarative source of prohibited-pattern categories (consumed by CLI AND runtime canary)
  scan.mjs                     # static source/dependency/inventory/env-schema scanning engine
  inventory.mjs                # route/tool/schema inventory collection + read-only-wallet allowlist verification
  README.md                    # gate contract, exit codes, fixture-corpus exclusion rules

packages/shared-schemas/
  src/sec.ts                   # authoritative Zod schemas (schemaRefs target)
  src/index.ts                 # + export * from './sec.ts'
  test/sec.spec.ts             # schema suite

migrations/
  g0_sec_0001_audit_chain.sql          # append-only events (immutability triggers), checkpoints, verify-run records
  g0_sec_0002_mcp_credentials.sql      # keyed-hash credentials, scopes, origin policy, expiry, revocation, last-used
  g0_sec_0003_import_quarantine.sql    # artifact intake → quarantine → scanning → validating → REJECTED | shadow-eligible (never ACTIVE)
  g0_sec_0004_incidents_pauses.sql     # security_incidents, capability_pauses, activation_events, rollback snapshots

telemetry/sec.catalog.json              # declarative event contracts (established catalog format)

docs/runbooks/security/
  incident-response.md                 # severity matrix, containment, evidence preservation, notification policy, recovery verification, postmortem, regression-test duty
  credential-compromise.md             # revoke, affected-run search, provider review, cache invalidation, incident creation (§35.11)
  audit-chain-failure.md               # verification failure → critical incident → high-impact activation block (§35.9)
  emergency-dependency-revocation.md   # §35.8 revocation/rollback runbook
  threat-models/register.md            # all eleven boundaries: assets, trust assumptions, threats, controls, mapped automated suites

tests/fixtures/sec/                     # scanner self-test corpus + SSRF/injection/import attack fixtures (ONLY sanctioned prohibited-content location)
tests/acceptance/AC-{050,051,052,053,250..259,274..279}.spec.ts
tests/negative/AC-{050,051,052,053,250..259,274..279}.negative.spec.ts
```

## Data Model

Four migrations extend the proven schema (lexicographically sorting AFTER all
applied `g0_data_*`/`g0_dr_*` ids, so the out-of-order defense stays silent):

1. **`g0_sec_0001_audit_chain`** — `sec_audit_events`: `seq` (identity),
   `occurred_at`, `actor`, `action_class` (CHECK against the §35.9 coverage
   vocabulary), `subject`, `payload_canonical` (canonical JSON text),
   `payload_sha256`, `prev_entry_hash`, `entry_hash`
   (`sha256(prev || canonical)`), plus BEFORE UPDATE/DELETE triggers raising
   `AUDIT_IMMUTABLE`. `sec_audit_checkpoints`: batch range `[from_seq,to_seq]`,
   chained checkpoint hash, optional batch signature, `stored_at`,
   `object_ref` (independently verifiable copy through the object store).
   `sec_audit_verify_runs`: continuous verifier results (range, verdict,
   first-divergence seq).
2. **`g0_sec_0002_mcp_credentials`** — credential id, keyed hash (never the
   secret), scope array, origin policy reference, profile bindings, entity
   boundaries, rate-limit class, expiry, optional IP constraints, `revoked_at`,
   `last_used_at`. Independence proven by per-row revocation.
3. **`g0_sec_0003_import_quarantine`** — artifact intake records: manifest
   hash, producer key id, format, byte size, state CHECK-constrained to
   `RECEIVED → QUARANTINED → SCANNED → VALIDATING → REJECTED |
SHADOW_ELIGIBLE` (no ACTIVE transition exists in the type system or the
   constraint), scan findings child rows, step-up approval reference.
4. **`g0_sec_0004_incidents_pauses`** — `security_incidents`: severity
   (`SEV1..SEV4` CHECK), owner, kind, opened_at/resolved_at, containment
   state, evidence references, notification-policy flags, recovery-verification
   and postmortem links. `capability_pauses`: smallest-affected-scope string,
   reason, opening incident FK, `resumed_at` (NULL = paused; resume requires
   explicit audited action; auto-reactivation refused at API level).
   `activation_events`: append-only ledger of activate/rollback events with
   immutable approved-set snapshot references and actionable-candidate
   re-evaluation markers (AC-279 substrate).

Drizzle mirrors live in `packages/security/src/generated/` parity-tested
against information_schema like the proven persistence package.

## Verification Strategy (per acceptance criterion)

All twenty ACs have manifest-declared positive and negative spec paths — both
files MUST exist and pass. Engines: PGlite via existing helpers; injected
clocks for freshness/expiry/replay windows; the resolver seam for rebinding;
the scanner CLI executed as a child process for end-to-end exit-status proofs.

| AC group                       | Positive proof                                                                                                                                         | Negative/failure-path proof                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-050/254 (absence scans)     | CLI green over real tree; runtime canary green over registered inventories; read-only wallet-intelligence entries permitted by explicit allowlist rule | Each prohibited-category fixture under `tests/fixtures/sec/` makes the CLI/canary FAIL with the right finding class; tampered inventory refuses       |
| AC-255 (GMGN pair)             | GMGN-shaped read-only query/schema fixtures pass every gate                                                                                            | Paired swap/private-key/transaction variants refused at build-scan and runtime-validation layers                                                      |
| AC-256 (decoder authority)     | raw-operations + local decoding configuration accepted                                                                                                 | Helius enhanced-parser-as-authoritative configuration refused with typed error                                                                        |
| AC-051 (attack battery)        | clean webhook/callback and safe Markdown/link inputs accepted                                                                                          | forged signature, stale timestamp, replayed id, malicious Markdown/SVG/link-exfil payloads each refused                                               |
| AC-257 (SSRF battery)          | allowlisted HTTPS endpoint with clean resolution passes                                                                                                | loopback/private/link-local/metadata IPv4+IPv6, redirects, rebinding, encoded hosts, userinfo, mixed schemes, oversize, slow-stream — all fail closed |
| AC-258 (injection containment) | seven content classes carried as labeled data through extraction envelope                                                                              | instruction strings in each class cannot mutate tools/scopes/URLs/budgets/policies/side effects (mutation-attempt assertions)                         |
| AC-052 (secret hygiene)        | sanitized envelopes/logs/exports pass through                                                                                                          | classified-material insertion into model context/log/trace/export/UI refused each way; env forbidden-name scan catches seeded offenders               |
| AC-053 (credentials)           | mint → use → last-used metadata flow works                                                                                                             | revocation kills exactly one credential; expired/scoped-out/origin-mismatched uses refused                                                            |
| AC-250/251 (origin/protocol)   | valid origin + protocol reaches authentication                                                                                                         | invalid/punycode/trailing-dot/mixed-scheme/wrong-port origins and bad version/content-type/size/session/cursor each fail deterministically            |
| AC-252/275 (isolation)         | same-tenant flows succeed across all eleven surfaces                                                                                                   | cross-tenant reads via direct rows/artifacts/cache/queues/sessions/quotas/logs/metrics/signed URLs/model context and bypass vectors all refused       |
| AC-253 (OAuth binding)         | fully-bound compliant token passes                                                                                                                     | missing PKCE, loose redirect, wrong audience, expired token, widened scope, upstream passthrough each refused                                         |
| AC-259 (audit integrity)       | append → checkpoint → independent verify green                                                                                                         | mutation/deletion/insertion/reordering/chain-break fixtures detected; checkpoint mismatch against object-store copy detected                          |
| AC-274 (high-impact gate)      | complete fresh step-up + CSRF + idempotency + reason request passes and audits                                                                         | each dimension missing/stale separately refused (TOTP-only explicitly insufficient)                                                                   |
| AC-276/277 (claims/redaction)  | compliant public output passes                                                                                                                         | each prohibited claim class refused; missing required disclosure fields refused; threshold/entity-detail leakage stripped                             |
| AC-278 (pause semantics)       | critical gate failure opens minimal-scoped pause with reason                                                                                           | auto-reactivation attempt refused; unrelated scopes unaffected (blast-radius assertion)                                                               |
| AC-279 (rollback ledger)       | rollback creates new activation event over approved snapshot; history intact                                                                           | history mutation attempted and refused; alert resumption blocked until re-evaluation marker consumed                                                  |

Cross-cutting: the four milestone verification commands (`test -d
packages/security && pnpm --filter @foresift/security test`, the tenant-
isolation equivalent, and `node scripts/scan-prohibited-capabilities/cli.mjs`)
plus `pnpm verify` (spec:verify, format:check, lint, typecheck, full tests)
green at HEAD.

## Risks

| Risk                                                                                                                                | Mitigation                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrator refuses `g0_sec_*` filenames (`MIGRATION_FILENAME_UNKNOWN`), breaking EVERY migration-running suite including proven ones. | One-line family-pattern extension in `packages/persistence/src/migrator.ts` (justified supporting change, material decision 1) landed FIRST, before any sec migration exists; additive, fail-closed direction unchanged.      |
| Scanner false positives against legitimate code (e.g., docs describing prohibitions, the scanner itself, negative fixtures).        | Pattern catalog requires code-context signals (imports/API calls), not bare words; documented, hashed inventory allowlist covers scanner/docs/fixtures; allowlist entries audited by test count so nothing can hide silently. |
| Scanner false negatives leave a prohibited path unproven.                                                                           | Self-test corpus proves every category DETECTED (positive detection assertions); runtime canary independently checks inventories at runtime; parity test keeps both engines aligned with one catalog.                         |
| Audit-chain design drifts toward mutable "correctable" logs.                                                                        | Append-only enforced in SQL triggers, not conventions; corrections are compensating events only; corruption fixtures prove detection.                                                                                         |
| Freshness/expiry logic becomes nondeterministic or timezone-broken.                                                                 | Injected ClockPort exclusively; UTC timestamps; fixed-clock tests for every window boundary (fresh, stale, boundary-instant).                                                                                                 |
| Scope creep into MCP transport/admin UI wiring (later packages' territory).                                                         | Policy-module boundary recorded as material decision 4; non-goals enumerated in spec §6; any discovered gap goes to out-of-scope notes.                                                                                       |
| Complete state left uncommitted blocks landing (create-pr refuses dirty trees).                                                     | Commit coherent units additively as they converge (material decision 6); never end the stage with a dirty tracked tree.                                                                                                       |
| Fixture corpus itself becomes a prohibited-capability vector.                                                                       | Corpus contains inert text snippets under `tests/fixtures/sec/` only, excluded from production scans by explicit rule, asserted inert by construction (no imports resolve, no execution path).                                |

## Material decisions

1. **Migrator filename-family extension (supporting change outside
   writeScopes)**: the manifest's `persistenceRefs` declare
   `migrations/g0_sec_*.sql`, but the delivered migrator accepts only
   `(data|dr)` families and REFUSES anything else fail-closed
   (`MIGRATION_FILENAME_UNKNOWN`). Extending its regex to
   `/^g\d+_(data|dr|sec)_\d{4}_[a-z0-9_]+\.sql$/` (+ doc comment) is the
   minimal enabling change: purely additive, preserves every defense
   (unknown families still refused; checksum/out-of-order/vanished-file
   defenses untouched), and without it not even this package's own suites can
   apply their declared migrations. Landed as the FIRST commit, with the
   existing migrator suite kept green. Recorded here because
   `packages/persistence/**` is outside this package's writeScopes; the
   alternative (renaming sec migrations to a `dr`/`data` prefix) would falsify
   manifest-declared persistence refs and is rejected.
2. **One declarative scan catalog, two engines**: prohibited-pattern
   definitions live in `scripts/scan-prohibited-capabilities/catalog.json`
   (data, not code). The zero-dependency CLI consumes it for static gates; the
   runtime canary in `packages/security` consumes the SAME file for
   inventory/runtime checks. A parity-pinned test asserts both engines classify
   every fixture identically, preventing silent divergence between build-time
   and runtime enforcement.
3. **Package-local security error vocabulary**: `SecErrorCode` stable string
   codes live in `packages/security/src/errors.ts` rather than extending
   `packages/domain`'s ErrorCode enum (that file is outside writeScopes).
   Codes follow the established naming style; the domain `CONTRACT_INVIOLABLE`
   -style generic remains available for cross-cutting refusals. Adding codes to
   domain later is a trivially compatible move for a future package.
4. **Policy modules vs transport wiring**: MCP Origin/protocol/OAuth/resource
   criteria are delivered as pure decision modules returning typed
   accept/refuse verdicts; HTTP-level wiring (403 responses, session stores,
   OAuth server) belongs to the mcp-surface package. This follows the
   manifest's own implRefs (`packages/security/**`,
   `packages/tenant-isolation/**` only) and keeps this package free of
   transport concerns it does not own.
5. **Independent audit checkpoint location = object store**: §35.9 demands
   periodic checkpoints at an independently verifiable location. Rather than
   inventing a second storage system, checkpoints are written BOTH to SQL and
   through the existing `ObjectStoreAdapter` (product ADR-003) whose staged
   commit protocol is already delivered and tested; independence comes from a
   separate failure domain plus hash-verifiable bytes, and the restore-side
   integration point required by the data-truth verifier interface is a
   function, not new infrastructure.
6. **Committed-tree completion**: coherent units are committed additively on
   the package branch as they converge; the stage never ends with a dirty
   tracked tree (`create-pr` refuses one and the implementation completion
   gate demands a committed one). Corrections are new commits; main is reached
   only through CI-gated PRs.
7. **Per-package vitest runner configs**: each new package gets a local
   `vitest.config.ts` mirroring root timeout budgets so the milestone-declared
   `pnpm --filter <pkg> test` commands collect the colocated suites (root
   config's projects cover only `tests/**`; identical to the proven sibling
   arrangement).

## Supporting changes outside writeScopes (justified)

1. `packages/persistence/src/migrator.ts` — the family-pattern extension of
   material decision 1 (regex + comment lines only; no behavioral change for
   existing families). Its existing test suite must stay green untouched.
2. `pnpm-lock.yaml` — mechanical regeneration via `pnpm install` after adding
   the two new workspace packages; no hand edits.
3. None otherwise planned. Anything discovered mid-implementation goes to the
   run's `out-of-scope-notes.md` instead of being fixed out of scope.
