# g0-mcp-surface — scoped specification

> This file is a SUBORDINATE DERIVATIVE of the authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`. It was seeded mechanically from
> the requirement manifest by `scripts/automation/bootstrap-package-spec.mjs` (builder v1). The PRD
> always wins over any wording below.

## Authority binding

- Milestone: `G0` (ACTIVE)
- Objective: Expose the MCP Streamable HTTP surface: tools, resources, and prompts served from the
  Shared Tool Core registry with structured output and pagination; per-client authentication,
  profiles, quotas, and revocation plus personal bearer mode; exact scheme-host-port Origin
  allowlist rejection (HTTP 403) before session creation or any side effect; mutually tested
  transport protocol versions, content types, session identifiers, resumable-event ownership,
  message size limits, and per-client rate/concurrency limits; and authorization re-evaluated on
  every call and resource fetch - strictly read-only with no trading, custody, or signing capability
  exposed to any client.
- Risk: HIGH · writeScopes: `apps/api/src/mcp/**`, `apps/api/src/auth/**`, `packages/tool-core/**`,
  `packages/shared-schemas/**`, `migrations/g0_mcp_*.sql`, `tests/fixtures/mcp/**`,
  `tests/acceptance/**`, `tests/negative/**`, `telemetry/mcp.*`
- Dependencies: `g0-tool-core` PROVEN, `g0-security-perimeter` PROVEN, `g0-cost-capacity` PROVEN
- Bound inputs at seed time: main `bc1913a79f25`, manifest `e0f9f1284473`, PRD `baa521d9c67e`

## Assigned requirements (normative text quoted verbatim)

### FR-MCP-001 — 38. Functional requirements catalogue (PRD line 6039)

> Streamable HTTP endpoint.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-002 — 38. Functional requirements catalogue (PRD line 6040)

> Tools, resources, and prompts.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-003 — 38. Functional requirements catalogue (PRD line 6041)

> Structured output and pagination.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-004 — 38. Functional requirements catalogue (PRD line 6042)

> Per-client auth/profile/quota/revoke.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-005 — 38. Functional requirements catalogue (PRD line 6043)

> Personal bearer mode.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-008 — 38. Functional requirements catalogue (PRD line 6477)

> Every Streamable HTTP request validates a normalized `Origin` against an exact scheme-host-port
> allowlist when the header is present; an invalid present origin returns HTTP 403 before session
> creation, authentication side effects, tool execution, or resource access.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-009 — 38. Functional requirements catalogue (PRD line 6478)

> MCP transport enforces mutually tested protocol versions, content types, method semantics, session
> identifiers, resumable-event ownership, message size, request correlation, and per-client
> rate/concurrency limits.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

### FR-MCP-010 — 38. Functional requirements catalogue (PRD line 6479)

> MCP resource and tool authorization is evaluated on every call and every resource fetch; a
> resource URI does not grant authority beyond the requesting credential, rights policy, and entity
> scope.

Normative level: MUST. Acceptance criteria: all 19 are shared across this package — see “Shared
acceptance criteria”.

- Security/rights/cost controls:
  INV-001,INV-002,INV-003,INV-004,INV-005,INV-006,INV-007,INV-008,INV-009,INV-010,Section
  9.5,Section 33,Section 34,Section 35,Section 37
- Schema refs: `packages/shared-schemas/src/mcp.ts`
- Fixture refs: `tests/fixtures/mcp/`
- Telemetry refs: `telemetry/mcp.*`

## Shared acceptance criteria

Attached to more than one requirement of this package — implement once, satisfy everywhere:

- **AC-001** · positive: `tests/acceptance/AC-001.spec.ts` · negative/failure:
  `tests/negative/AC-001.negative.spec.ts` — attached to 8 requirements
- **AC-002** · positive: `tests/acceptance/AC-002.spec.ts` · negative/failure:
  `tests/negative/AC-002.negative.spec.ts` — attached to 8 requirements
- **AC-003** · positive: `tests/acceptance/AC-003.spec.ts` · negative/failure:
  `tests/negative/AC-003.negative.spec.ts` — attached to 8 requirements
- **AC-004** · positive: `tests/acceptance/AC-004.spec.ts` · negative/failure:
  `tests/negative/AC-004.negative.spec.ts` — attached to 8 requirements
- **AC-050** · positive: `tests/acceptance/AC-050.spec.ts` · negative/failure:
  `tests/negative/AC-050.negative.spec.ts` — attached to 8 requirements
- **AC-051** · positive: `tests/acceptance/AC-051.spec.ts` · negative/failure:
  `tests/negative/AC-051.negative.spec.ts` — attached to 8 requirements
- **AC-052** · positive: `tests/acceptance/AC-052.spec.ts` · negative/failure:
  `tests/negative/AC-052.negative.spec.ts` — attached to 8 requirements
- **AC-053** · positive: `tests/acceptance/AC-053.spec.ts` · negative/failure:
  `tests/negative/AC-053.negative.spec.ts` — attached to 8 requirements
- **AC-144** · positive: `tests/acceptance/AC-144.spec.ts` · negative/failure:
  `tests/negative/AC-144.negative.spec.ts` — attached to 8 requirements
- **AC-250** · positive: `tests/acceptance/AC-250.spec.ts` · negative/failure:
  `tests/negative/AC-250.negative.spec.ts` — attached to 8 requirements
- **AC-251** · positive: `tests/acceptance/AC-251.spec.ts` · negative/failure:
  `tests/negative/AC-251.negative.spec.ts` — attached to 8 requirements
- **AC-252** · positive: `tests/acceptance/AC-252.spec.ts` · negative/failure:
  `tests/negative/AC-252.negative.spec.ts` — attached to 8 requirements
- **AC-253** · positive: `tests/acceptance/AC-253.spec.ts` · negative/failure:
  `tests/negative/AC-253.negative.spec.ts` — attached to 8 requirements
- **AC-254** · positive: `tests/acceptance/AC-254.spec.ts` · negative/failure:
  `tests/negative/AC-254.negative.spec.ts` — attached to 8 requirements
- **AC-255** · positive: `tests/acceptance/AC-255.spec.ts` · negative/failure:
  `tests/negative/AC-255.negative.spec.ts` — attached to 8 requirements
- **AC-256** · positive: `tests/acceptance/AC-256.spec.ts` · negative/failure:
  `tests/negative/AC-256.negative.spec.ts` — attached to 8 requirements
- **AC-257** · positive: `tests/acceptance/AC-257.spec.ts` · negative/failure:
  `tests/negative/AC-257.negative.spec.ts` — attached to 8 requirements
- **AC-258** · positive: `tests/acceptance/AC-258.spec.ts` · negative/failure:
  `tests/negative/AC-258.negative.spec.ts` — attached to 8 requirements
- **AC-259** · positive: `tests/acceptance/AC-259.spec.ts` · negative/failure:
  `tests/negative/AC-259.negative.spec.ts` — attached to 8 requirements

## Non-goals

Everything below is OUT OF SCOPE for this package:

- `g0-contracts-data-truth`: Establish the canonical data-truth foundation: versioned
  chain/asset/pool/launch/migration identity, immutable observations with revisions, point-in-time
  available_at replay with no-backdating, field-level quality codes, online/offline feature
  consistency, source lineage and independence groups, and tiered backup/PITR durability with
  separately protected encryption keys and recovery credentials over the shared persistence,
  object-store, and schema layers. This package also lands glob-driven root
  tsconfig/eslint/package/workspace configuration that picks up every later G0 package path
  automatically so subsequent packages need zero root-config edits. FR-DR recovery orchestration is
  delivered in G0 through packages/persistence/** (the manifest-declared owner); its
  workflow-runtime and release-conformance implementation mappings are reconciled by
  g0-traceability-conformance at milestone convergence.
- `g0-security-perimeter`: Stand up the permanent read-only security perimeter: append-only
  hash-chained audit chain with continuous verification, phishing-resistant step-up authentication
  primitives, deny-by-default egress/SSRF controls with rebinding tests, untrusted-content
  isolation, secrets and supply-chain policy, Alpha Lab import gating (approved non-executable
  schemas only, signature/hash/producer-trust verification, quarantine and content scanning, no
  direct policy activation), tenant-isolation and abuse-control primitives, incident process, and
  automated static/runtime proofs that no trading, custody, wallet-signing, private-key, or
  transaction-submission capability exists anywhere in the codebase.
- `g0-tool-core`: Implement the Shared Tool Core: a central versioned tool registry driving the
  exact authenticate-authorize-validate-cache-single-flight-quota-reserve-execute-audit pipeline
  with provenance, event-time, quality, and evidence envelopes; narrow actor/tool profiles; cache
  and cross-mode single-flight semantics; atomic quota reservation/commit/release; license-policy
  enforcement; and permanent prohibited-financial enforcement. The quota reservation/commit/release
  stage and the license-policy source land as stable extension-point interfaces (contracts plus
  dependency-injection seams) so later packages implement cost and quota semantics entirely outside
  packages/tool-core/** without editing it.
- `g0-provider-lifecycle`: Deliver provider operation lifecycle truth: stateful lifecycle
  (DISCOVERED through REMOVED) with documentation/pricing/rights verification TTLs that fail closed,
  deprecation rules for new implementations, audited read-only adapters bound to exact egress
  allowlists (GMGN strictly query-only, Helius supported raw/history operations), quarantine of
  responses carrying transaction payloads or key material, rights-change fail-closed handling, and
  source fingerprints for empirical dependence analysis.
- `g0-cost-capacity`: Operate the free-first cost, quota, and sustainable-capacity control plane:
  declared cost classes, quota units, reset policies, and STRICT_FREE permission for every provider
  operation; STRICT_FREE blocking of paid, unknown-cost, and fallback operations with audited
  denials; protected reserves; degrade-breadth/depth-before-protected-quota; batch coalescing and
  exact-cache/single-flight ahead of reservation; verified-plan cost forecasts; separately activated
  paid-provider mode; and independently capped
  scheduler/workflow/database/object-store/notification/model resource budgets with data-provider
  STRICT_FREE independent from any configured BYOK model budget. Cost and quota semantics implement
  the tool-core extension-point interfaces without editing packages/tool-core/**.
- `g0-first-party-observation`: Provide bounded first-party observation: the versioned allowlisted
  Solana collector and protocol registry (Pump bonding curve/PumpSwap, Raydium AMM
  v4/CPMM/CLMM/Stable AMM/LaunchLab, Orca Whirlpools, Meteora DLMM/DAMM v1-v2/DBC, Jupiter route
  observation) with durable monotonic checkpoints, gap detection and non-backdating backfill,
  reorg-safe immutable revisions, decode-drift incident pausing, deterministic bounded failover,
  Sustainable Capacity Contract ceilings, health and first-seen timing metrics, and zero
  signing/wallet capability; plus the point-in-time discovery-universe registry making free
  aggregate discovery the default broad-universe path, with complete first-seen attribution, finite
  batch-oriented monitoring, and deterministic versioned candidate promotion. External collector
  access flows through the security perimeter's egress controls and audited read-only adapter layer.
- `g0-traceability-conformance`: Close the milestone with release-blocking traceability: the
  machine-readable requirement manifest kept authoritative and integrity-checked, globally unique
  and stable requirement/acceptance/invariant/artifact IDs with explicit supersession links, CI
  conformance that fails on unmapped normative items, orphaned code paths, or implementations
  outside their dependency gate, signed and hashed evidence artifacts for
  manual/legal/rights/approval gates, per-decision requirement/policy/model/tool/version
  traceability, and reproducible release reports with document, manifest, migration, SBOM hashes,
  conformance results, activation state, and rollback target. This package is also the central
  generator of all docs/generated/<family>-surfaces.json surface mappings and reconciles
  telemetry/surface mapping ownership across the milestone at convergence.

<!-- Seeded normative content ends here. Planner-owned sections (integration notes,
     invariants, open points resolved from authoritative sources) go below this line. -->

## Scoped interpretation (planner-owned)

This package is the **transport wiring layer** for the MCP surface: it hosts the first API
application package (`apps/api`, `@foresift/api`), runs the MCP Streamable HTTP endpoint at the
PRD §17 path, and composes the already-proven policy modules of `packages/security` and the
pipeline of `packages/tool-core` — it must NOT re-implement any policy primitive. Every decision
below resolves to the safest, fail-closed, read-only interpretation of the PRD.

### What is built here

1. **Streamable HTTP endpoint (FR-MCP-001)** — `apps/api` serves `POST /mcp` (JSON-RPC over
   HTTP). Request admission order is fixed and enforced in one composition root:
   request-size cap → Origin gate → protocol guard → credential authentication → session
   resolution → per-client rate/concurrency admission → tool/resource dispatch. No stage may run
   after a refusal; every refusal is deterministic and typed.
2. **Tools, resources, prompts (FR-MCP-002)** — the §17.3 resource URI schemes
   (`evidence://`, `run://`, `candidate://`, `snapshot://`, `report://`, `conflict://`,
   `capacity://`, `tradability://`), the eight §17.3 prompts, and the §17.10 G0 tool surface
   (`system_health`, `quota_get_status`, `capacity_get_status`, `provider_get_health`,
   `collector_get_health`, `capability_get_status` plus the diagnostic/expert provider tools and
   domain tools) are exposed **through** `ToolCore.execute` from the Shared Tool Core registry —
   never by re-declaring tool logic in `apps/api`.
3. **Structured output and pagination (FR-MCP-003)** — tools advertise JSON Schema
   `outputSchema` (PRD §17.4); structured content plus concise human content; pagination cursors
   map onto the ToolCore result envelope; §29.4 caps apply (256 KiB request soft limit, 1 MiB MCP
   structured response, 100-record max page); explicit abstention/insufficient-data states pass
   through unmangled; no transaction payload, private key, seed phrase, signature request, or
   executable financial instruction may appear in any output.
4. **Per-client auth/profile/quota/revoke (FR-MCP-004)** — per-client scopes, tool profile,
   entity constraints, quota, Origin policy, expiry, and revocation are enforced per request via
   the credential store and `ToolCore` seams; `system_health` and `quota_get_status` surface the
   caller's own quota/status view only.
5. **Personal bearer mode (FR-MCP-005)** — §17.5 bearer keys with ≥256-bit entropy, stored as
   HMAC-SHA256 keyed hash with server-side pepper, shown exactly once, never logged, prefix-only
   identification, independent rate limits and incident attribution.
6. **Origin gate (FR-MCP-008)** — every request validates a present `Origin` against the exact
   scheme-host-port allowlist (§17.2 rules: no wildcards, no host-suffix matching, punycode /
   trailing-dot / default-port / mixed-case / IPv6 / redirect normalization tested, explicit
   absent-Origin policy, loopback-only local mode with a separate local allowlist, proxy headers
   trusted only from allowlisted proxies, Origin policy independent from auth policy). A refused
   Origin yields HTTP 403 **before** session creation, authentication side effects, tool
   execution, or resource access.
7. **Transport conformance (FR-MCP-009)** — mutually tested protocol revisions
   (baseline `2025-11-25` per G.13/ADR-027 compatibility matrix), content types, POST method
   semantics, session identifiers bound to actor/profile/origin/revision/expiry (§17.7: missing
   required session ID → 400, expired/terminated → 404, idempotent DELETE where supported,
   fixation/replay/hijack fixtures), resumable-event cursor ownership, message size caps
   (`maximum_request_bytes: 262144`), JSON-RPC request correlation, and per-client token-bucket
   rate plus concurrency limits.
8. **Per-access authorization (FR-MCP-010)** — every tool call and every resource fetch
   re-evaluates authorization (actor scope, entity scope, rights policy, retention state, §17.9);
   a resource URI never grants authority beyond the requesting credential; resource access is
   audit logged independently from creation.

### Applicable invariants (obligations in this package)

| ID      | Obligation on this surface                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001 | No route, tool, resource, prompt, or output on this surface can execute, sign, custody, or construct a financial transaction; outputs never carry transaction payloads (also AC-050/AC-254).  |
| INV-002 | Model-facing text on this surface can never replace deterministic identity, rights, cost, quota, capacity, or policy controls — all of those come from ToolCore stages and security verdicts. |
| INV-003 | No model output received through this surface directly causes an external side effect; dispatch is ToolCore-only with no side-effecting primitives.                                           |
| INV-004 | Surface configuration (allowlist, protocol revision, limits, credential policy) is versioned, auditable, and reconstructable.                                                                 |
| INV-005 | As-of/resource reads served here honor point-in-time availability semantics passed through ToolCore; no future data is served.                                                                |
| INV-006 | Backfill/recovery data is never backdated into what this surface serves; freshness metadata is honest.                                                                                        |
| INV-007 | Abstention/insufficient-data states are surfaced explicitly, never silently replaced (also AC-004).                                                                                           |
| INV-008 | Source-dependence/lineage metadata from ToolResultEnvelope is preserved in MCP output (also §17.4).                                                                                           |
| INV-009 | Session and rate-limit state transitions on this surface are idempotent and fenced (idempotent DELETE; bounded concurrent admissions).                                                        |
| INV-010 | This surface exposes research/intelligence only; it never frames or optimizes trading outcomes.                                                                                               |
| INV-037 | MCP Streamable HTTP validates Origin, protocol, authentication, resource scope, and request shape before execution — the admission order in item 1 is the normative encoding.                 |

### Binding ADRs

- **ADR-004** (inline, PRD): official TypeScript MCP SDK v1.x, Streamable HTTP over HTTPS,
  bearer tokens for personal/private mode. The SDK is added as an EXACT-pinned production
  dependency of `apps/api` (`verifyPinning` requires exact versions); workspace zod satisfies its
  peer range.
- **ADR-027** (inline, PRD §69.7): the compatibility matrix governs protocol-revision/client
  pairs; stable revision is served by default, draft revisions are opt-in only (AC-144).
- **ADR-0013**: all request/output shapes validated with zod; the new
  `packages/shared-schemas/src/mcp.ts` follows the `parseCoreSchema` registry pattern.
- **ADR-0014**: PGlite-backed suites run only through the workload coordinator; new suites that
  import PGlite are DATABASE_PGLITE workload members reached via `pnpm test:all` — never a bare
  full-tree `bun test` (test runtime contract).
- **ADR-0019**: the central migration registry duty lives in
  `packages/persistence/test/migrator.spec.ts`; adding `g0_mcp_*.sql` scripts requires extending
  that suite's expected-script list in the same package (plan-sanctioned scope exception —
  `packages/persistence/**` is outside this package's writeScopes).

### Integration points (landed dependency surface — compose, never re-implement)

- `packages/security` — `McpOriginGate.decide()` (normalized exact allowlist verdict, refusal
  reasons), `McpProtocolGuard.inspect()` (revision/content-type/method/size/session-binding/
  resumable-cursor verdicts), `McpCredentialStore` (issue/authenticate/revoke; this wiring MUST
  enable `strictPresentation` per the store's own contract), `OAuthBindingGuard` (binding checks
  consumed where the G6 substrate is exercised — full OAuth server is out of scope),
  `AbuseController.admit()` (per-client sliding-window rate and concurrency admission),
  `AuditChain.append({ occurredAt, actor, actionClass, subject, payload })` (independent resource-
  access audit, chain verification), `ResourceAccessGuard`/`SignedUrlService`/`deriveTenantContext`
  (§17.9 delivery controls).
- `packages/tool-core` — `createToolCore({ authn, authz, quotaAdapter, licenseSource, egressGuard,
objectStore })` seams; `ToolCore.execute(ToolExecutionRequest)` → ToolResultEnvelope with
  `nextCursor` metadata; deny-closed defaults retained; `HolderMode.MCP_MANUAL`; the eight
  `ToolProfileId` values bind per-client profiles; registry lookups drive tools/resources listing.
- `packages/shared-schemas` — `OriginVerdictSchema`/`ProtocolVerdictSchema` refusal-reason enums,
  `MCP_PROTOCOL_BASELINE_REVISION`, `ToolResultMetaSchema.nextCursor`; this package adds
  `packages/shared-schemas/src/mcp.ts` (MCP envelope, session, cursor, output metadata schemas)
  and registers it in the schema registry.
- `packages/persistence` — `DatabaseEngine` for the credential store and new session/rate-limit
  tables via `migrations/g0_mcp_*.sql`; migrator family regex extended with `mcp` plus the central
  registry suite update (ADR-0019 exception).
- Cost/capacity control plane (PROVEN) — quota visibility for `quota_get_status` /
  `capacity_get_status` flows through ToolCore quota seams; no direct provider calls from
  `apps/api`.

### Explicit boundary decisions

1. **G6 boundary**: FR-MCP-006/007/011/012 (full OAuth 2.1 authorization server, ChatGPT
   Scheduled readiness, OAuth token-binding details, large-resource streaming/signed-URL
   infrastructure) belong to dependency group **G6**, not this milestone. This package consumes
   the existing `OAuthBindingGuard` substrate for AC-253's existing coverage and never implements
   an OAuth server. AC-253 remains security-owned; this package adds no OAuth server code.
2. **Surface mappings**: `docs/generated/mcp-surfaces.json` (`apiToolUiRefs`) is generated
   centrally by g0-traceability-conformance at milestone convergence (milestone decision (2)).
   This package defines `telemetry/mcp.*` only.
3. **`packages/tool-core/**` is in writeScopes but stays untouched**: this design consumes the
   existing seams; any change would threaten the PROVEN gate of g0-tool-core.
4. **Root config**: the glob-driven root tsconfig/eslint/workspace configuration from
   g0-contracts-data-truth auto-picks `apps/**`; the only root edits needed are mechanical
   workspace/devDependency linkage of `@foresift/api` and lockfile regeneration (mechanical
   bookkeeping precedent, ADR-0020).
5. **Stateful sessions**: G.13 sets `stateful_sessions_enabled: false`. The session machinery
   (crypto-random IDs, §17.7 bindings, 400/404 semantics, idempotent DELETE) is implemented and
   mutually tested here so enabling stateful sessions later is a config flip, not new code —
   default operation remains stateless (per-request binding context).

### Per-AC scoped obligations

Shared ACs are implemented once, here, for the MCP requirements they attach to:

- **AC-001** — extend the existing facet blocks: mcp-surface facet covers client initialize →
  list scoped profile → tool call over the real HTTP surface with explicit degradation of
  unavailable optional providers.
- **AC-002** — mcp-surface facet proves quality/time/provenance/evidence fields survive the HTTP
  envelope (envelope passthrough, not re-derivation).
- **AC-003** — two concurrent holder modes dedupe to one provider call through the surface.
- **AC-004** — unsupported/conflicting data surfaces as explicit abstention over MCP.
- **AC-050/AC-254/AC-255** — negative-contract scans include `apps/api` routes/tools/schemas/env;
  no trading/signing/wallet/seed capability on the surface.
- **AC-051** — injection/SSRF fixtures cannot alter tools, scopes, URLs, budgets, or policies via
  this surface (mcp-surface facet joins the existing scans).
- **AC-052** — secrets (pepper, bearer secrets) never appear in model context, logs, traces, or
  outputs; keys shown once.
- **AC-053** — credentials independently scoped and revocable: revocation takes effect on the
  next request (credential store wired into every request path).
- **AC-144** — compatibility matrix tests for the stable revision and each supported target
  client; draft revisions opt-in only (new positive+negative suites).
- **AC-250..AC-253** — wire the security-owned verdict suites to the real HTTP semantics:
  403-before-anything for refused Origins (incl. punycode/trailing-dot/mixed-scheme/wrong-port),
  deterministic protocol refusals without tool execution, cross-tenant resource-fetch refusal,
  OAuth binding substrate green.
- **AC-257/AC-258** — surface-level facet: oversized/slow responses fail closed through the
  request cap; injection strings cannot mutate policy on this surface.
- **AC-259** — per-access audit chain append + verification remains green with mcp-surface
  `actionClass` events; tamper fixtures still detected.

### Success criteria

1. `test -d apps/api && pnpm --filter @foresift/api test` passes (milestone verification
   command); all new/extended suites run through the workload coordinator.
2. All 19 shared ACs pass with mcp-surface facets present; existing security/tool-core facets
   remain green.
3. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD.
4. No prohibited capability appears anywhere on the surface (static + runtime scans).
5. The task-graph build succeeds with only the sanctioned scope exceptions recorded.

### Resolved ambiguities

- **HTTP framework**: use the official MCP SDK's Streamable HTTP transport; where an HTTP layer
  is needed, Hono is acceptable (already version-available in the registry). Decision recorded in
  plan.md; SDK does the protocol framing.
- **Where the credential/session tables live**: `migrations/g0_mcp_*.sql` (writeScope-gated),
  registered centrally per ADR-0019.
- **Absent Origin**: default production policy refuses (§17.2 "never an accidental allow");
  `allow_absent_origin_for_registered_non_browser_clients: true` from G.13 is the per-client
  policy encoded on credentials, not a global default.
- **Pagination**: cursor mapping onto ToolResultEnvelope `nextCursor` with §29.4 caps enforced at
  the surface.
