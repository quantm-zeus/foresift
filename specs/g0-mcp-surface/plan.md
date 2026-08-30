# g0-mcp-surface — implementation plan

> Subordinate to `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` and
> `specs/g0-mcp-surface/spec.md` (the scoped requirement derivative this plan implements).

## Summary

Build the MCP Streamable HTTP surface as the first API application package (`apps/api`,
`@foresift/api`): one composition root that runs the fixed fail-closed admission order
(request-size cap → Origin gate → protocol guard → credential authentication → session
resolution → per-client rate/concurrency admission → tool/resource dispatch), exposes the §17.3
tools/resources/prompts **through** `ToolCore.execute` from the Shared Tool Core registry with
§17.4 structured output and pagination, enforces §17.5 personal bearer mode and §17.7 session
security, and re-evaluates authorization on every call and every resource fetch (§17.9). All
policy verdicts come from the PROVEN `packages/security` modules — this package wires, never
re-implements.

## Technical context

- Runtime: Node ≥ 24 (strip-types), TypeScript strict, NodeNext; Bun test runner.
- New workspace package `apps/api` (`@foresift/api`, private, `"type": "module"`) — per-app
  tsconfig following the `apps/collector` precedent (root tsconfig excludes `apps/**`; the
  glob-driven root config from g0-contracts-data-truth auto-includes app paths).
- Official MCP SDK `@modelcontextprotocol/sdk` pinned EXACT (registry latest 1.x = 1.30.0;
  node ≥ 18, zod ^3.25 peer — compatible with workspace zod 3.25.76). ADR-004 mandates this SDK.
  HTTP layer: Hono (4.13.5 in registry) only if the SDK transport needs a host adapter.
- Validation: zod (ADR-0013) via `packages/shared-schemas`.
- DB tests: PGlite (ADR-0014) — new suites importing PGlite join the DATABASE_PGLITE workload
  and run only through `pnpm test:all` / coordinator (never a bare full-tree `bun test`).
- Production dependency versions pinned exact (`verifyPinning`).

## Constitution check

| Principle                                     | Status | Notes                                                                                                                 |
| --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Read-only perimeter (INV-001, AC-050/254/255) | PASS   | Surface exposes research tools only; negative-contract scans extended to `apps/api` routes/tools/schemas/env.         |
| Fail-closed defaults                          | PASS   | Admission order refuses deterministically; DenyClosed ToolCore seams retained; absent-Origin refuses in production.   |
| Compose, don't re-implement                   | PASS   | Origin/protocol/credential/abuse/audit modules consumed from `packages/security`; tool execution via `ToolCore` only. |
| Spec-driven traceability                      | PASS   | Every task traces FR-MCP-### + AC-###; central migration registry duty honored (ADR-0019).                            |
| Test runtime contract                         | PASS   | No bare full-tree `bun test`; workload classes derived from imports.                                                  |
| Git/no-amend, no placeholder artifacts        | PASS   | Additive work only; no template placeholders or unresolved markers.                                                   |

## Project structure (new files under writeScopes)

```text
apps/api/
  package.json                    @foresift/api, exact-pinned deps
  tsconfig.json                   per-app strict NodeNext config (collector precedent)
  src/main.ts                     composition root: config → engine → server start
  src/config.ts                   G.13-derived config schema (zod): baseline, allowlist,
                                  absent-origin policy, request/response/page caps
  src/mcp/
    server.ts                     Hono app + MCP SDK Streamable HTTP transport wiring at /mcp
    admission.ts                  THE fixed admission pipeline (order is normative, INV-037)
    origin-wiring.ts              McpOriginGate.decide() → HTTP 403 (typed refusal reasons)
    protocol-wiring.ts            McpProtocolGuard.inspect() + JSON-RPC correlation + SDK hooks
    session-store.ts              §17.7 session rows: crypto-random IDs bound to
                                  actor/profile/origin/revision/expiry; 400/404 semantics;
                                  idempotent DELETE (stateful_sessions_enabled=false default)
    rate-limits.ts                per-client token bucket + concurrency cap via AbuseController
    tools.ts                      §17.10 tool catalog exposure over ToolCore (list/call,
                                  profiles, listChanged)
    resources.ts                  §17.3 URI schemes; per-access authorization; byte/record/
                                  content-type limits; independent audit; signed-URL stance
    prompts.ts                    the eight §17.3 prompts
    output.ts                     §17.4 envelope: outputSchema, structured+human content,
                                  cursor pagination, quality/freshness/rights metadata,
                                  abstention passthrough, prohibited-payload scrub
  src/auth/
    bearer.ts                     §17.5 bearer extraction; strictPresentation wiring
    client-context.ts             per-client scopes/profile/entity/quota/origin/expiry context
  test/                           bun unit suites (PURE / DATABASE_PGLITE per imports)
packages/shared-schemas/src/mcp.ts        MCP envelope/session/cursor/output schemas + registry
packages/shared-schemas/test/mcp.spec.ts
migrations/g0_mcp_0001_sessions.sql       session + per-client rate-state tables (G0 naming)
migrations/g0_mcp_0002_credential_audit.sql  credential/audit support tables if not reused
telemetry/mcp.catalog.json                declarative catalog (mcp.* events, requirementRefs)
tests/fixtures/mcp/                       requests, origins, credentials, sessions, cursors
tests/acceptance/AC-144.spec.ts           new: compatibility matrix (stable + target clients)
tests/negative/AC-144.negative.spec.ts    new: draft revisions opt-in only
tests/acceptance/*.spec.ts                facet extensions AC-001..004, 050..053, 250..253,
                                          257..259 (mcp-surface facets, never breaking
                                          security-owned scans)
tests/negative/*.negative.spec.ts         matching negative facets
```

Supporting (outside writeScopes, plan-sanctioned exceptions):

- `packages/persistence/src/migrator.ts` — add `mcp` to `MIGRATION_FILE_PATTERN` family list.
- `packages/persistence/test/migrator.spec.ts` — central expected-script registry extended
  (ADR-0019 duty; `36` → new count at all four assertion sites).
- Root `package.json` / `pnpm-workspace.yaml` (if needed) + `pnpm-lock.yaml` — link `@foresift/api`
  workspace package (mechanical bookkeeping, ADR-0020).

## Data model

- `g0_mcp_sessions`: session_id (PK, crypto-random visible-ASCII), actor, profile_id, origin,
  protocol_revision, expires_at, terminated_at, created_at. Fenced transitions (INV-009):
  DELETE idempotent; expired rows read as 404.
- `g0_mcp_rate_state`: per-client sliding-window/token-bucket counters and in-flight concurrency
  counters keyed by credential id + class.
- Credentials keep using the existing `McpCredentialStore` storage contract; no new credential
  table unless a gap is proven during implementation (then a `g0_mcp_*.sql` migration + registry
  update).

## Verification strategy (per shared AC)

| AC                     | Strategy                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001                 | Extend facet blocks in `tests/acceptance/AC-001.spec.ts` (+ negative): real HTTP client initializes, lists a scoped profile, calls a domain tool through ToolCore; unavailable optional providers degrade explicitly. |
| AC-002                 | Facet: ToolResultEnvelope quality/time/provenance/evidence fields reach MCP structured output unmodified.                                                                                                             |
| AC-003                 | Facet: two concurrent holder modes (MCP_MANUAL + AUTOMATION) produce one provider call inside the dedupe window.                                                                                                      |
| AC-004                 | Facet: conflicting/unsupported data yields explicit abstention content over MCP.                                                                                                                                      |
| AC-050                 | Facet in negative-contract scans: `apps/api` route/tool/schema inventory added to the five-scan-surface pattern; no swap/bridge/order/transaction/sign/seed/wallet path.                                              |
| AC-051                 | Facet: injection fixtures through MCP arguments cannot alter tools/scopes/URLs/budgets/policies.                                                                                                                      |
| AC-052                 | Facet: pepper + bearer secrets absent from logs/traces/outputs; secret shown exactly once at issuance.                                                                                                                |
| AC-053                 | Positive + negative: revocation refuses the next request; scopes independently bounded.                                                                                                                               |
| AC-144                 | NEW suites: compatibility matrix for stable revision `2025-11-25` + supported target clients; negative: draft revision refused unless opt-in.                                                                         |
| AC-250                 | Facet wiring security's suite semantics to real HTTP: allowlisted Origin reaches auth; punycode-confused/trailing-dot/mixed-scheme/wrong-port/invalid Origins get 403 before anything else.                           |
| AC-251                 | Facet: unsupported revision, invalid content type, GET method, oversized message, foreign session ID, unauthorized cursor each fail deterministically with zero tool execution.                                       |
| AC-252                 | Facet: resource created under tenant A refused for tenant B lacking scope/rights — incl. signed-URL/range/redirect/path-confusion attempts.                                                                           |
| AC-253                 | Existing security-owned OAuth binding suite stays green (OAuthBindingGuard substrate); no OAuth server code added here.                                                                                               |
| AC-254/255/256/257/258 | Facets in the security-owned scans/SSRF/injection suites covering the new surface (env schema, dependency scan, oversized/slow-response fail-closed).                                                                 |
| AC-259                 | Facet: per-access `AuditChain.append` events with mcp-surface action classes; tamper/chain-break fixtures still detected.                                                                                             |

Milestone verification: `test -d apps/api && pnpm --filter @foresift/api test`; plus
`pnpm verify` and `pnpm spec:verify` at pushed HEAD.

## Risks and mitigations

- **SDK transport vs fail-closed admission** — the MCP SDK owns protocol framing; mitigate by
  fronting the SDK transport with the admission pipeline (every refusal decided BEFORE the SDK
  sees a session) and mutually testing each dimension (AC-250/251).
- **Scope drift into `packages/tool-core`** — writeScope includes it, but design consumes seams
  only; any core change would re-open a PROVEN gate. Guardrail: tasks never predict tool-core
  writes.
- **Migration registry breakage** — the central suite hard-asserts the full script list; new
  `g0_mcp_*.sql` scripts REQUIRE the registry update in the same package (ADR-0019 exception,
  named in tasks so the graph builder accepts it).
- **Secret leakage through new logging** — secret-scrubbing assertions in AC-052 facet + code
  review gate; pepper never persisted, secret never logged.
- **OOM hazard** — PGlite suites via coordinator only; per-file PGlite instances bounded as in
  existing persistence suites.

## Material decisions (proposed ADR text)

### ADR-0021 (proposed): MCP surface is a wiring composition over proven policy modules

**Status**: Proposed · **Context**: FR-MCP-001..010 require a Streamable HTTP surface with
Origin/protocol/credential/session/rate policy; `packages/security` already provides those
verdicts and `packages/tool-core` the execution pipeline. **Decision**: `apps/api` implements
transport wiring and composition only; all policy verdicts come from `packages/security`
modules and all execution from `ToolCore` seams; `packages/tool-core/**` remains untouched;
`strictPresentation` is enabled on `McpCredentialStore` per its M14 contract. **Consequences**:
policy evolution lands in one place; the surface package cannot silently weaken a verdict;
tests must prove the wiring (not the policies) plus end-to-end admission order.

### ADR-0022 (proposed): Admission order is normative and fail-closed

**Status**: Proposed · **Context**: INV-037 requires Origin/protocol/auth/resource-scope/shape
validation before execution; §17.2 requires 403 before any side effect. **Decision**: every
request traverses exactly: size cap → Origin (403 on refusal) → protocol guard → credential
authentication → session resolution → rate/concurrency admission → dispatch; refusals at any
stage short-circuit with typed, deterministic errors and no downstream effect. **Consequences**:
mutual tests assert both verdicts and non-occurrence of downstream effects; adding a stage
requires updating this order and its tests.

### ADR-0023 (proposed): Session machinery ships stateless-default

**Status**: Proposed · **Context**: G.13 sets `stateful_sessions_enabled: false`; §17.7 defines
session semantics conditionally. **Decision**: full §17.7 machinery (crypto-random IDs bound to
actor/profile/origin/revision/expiry, 400 missing / 404 expired, idempotent DELETE, fixation/
replay fixtures) is implemented and tested now, but the default deployment operates stateless
with per-request binding; enabling stateful sessions is a config flip. **Consequences**: no
later security-critical rewrite; default posture stays minimal.

## Task sequencing overview

Foundation (schemas, migration registry, fixtures) → server composition (config, admission,
origin/protocol wiring) → auth/session/rate-limits → tools/resources/prompts/output →
acceptance facets + new AC-144 suites → telemetry + verify convergence. Details and ordering in
`tasks.md`.
