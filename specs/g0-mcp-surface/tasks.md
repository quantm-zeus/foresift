# g0-mcp-surface — tasks

> Every task traces at least one assigned requirement (FR-MCP-001/002/003/004/005/008/009/010)
> and the shared acceptance criteria it advances. [P] marks a task parallelizable once its
> phase predecessors complete. Checkbox format `- [ ] T###` is parsed by the implementation
> task-graph builder; predicted writes are the backticked repo-relative paths in each body.

## Phase 1 — Foundation: package scaffold, schemas, migration registry

- [x] T001 [P] Scaffold the `apps/api` workspace package: `package.json` (`@foresift/api`,
      private, type module, exact-pinned `@modelcontextprotocol/sdk` production dependency,
      workspace deps on `@foresift/security`, `@foresift/tool-core`, `@foresift/shared-schemas`,
      `@foresift/persistence`, `@foresift/domain`), `tsconfig.json` (strict NodeNext,
      `apps/collector` precedent), root workspace linkage and lockfile regeneration
      (`package.json`, `pnpm-lock.yaml` — mechanical bookkeeping per ADR-0020). —
      **FR-MCP-001** — AC-001
- [x] T002 [P] Add `packages/shared-schemas/src/mcp.ts` (MCP output envelope, session binding,
      cursor, refusal-reason passthrough, output metadata schemas per §17.4) and register it in
      the schema registry; unit suite `packages/shared-schemas/test/mcp.spec.ts`. —
      **FR-MCP-003** — AC-002
- [x] T003 Add `migrations/g0_mcp_0001_sessions.sql` (session rows bound to
      actor/profile/origin/revision/expiry) and `migrations/g0_mcp_0002_rate_state.sql`
      (per-client rate/concurrency state); extend `packages/persistence/src/migrator.ts`
      `MIGRATION_FILE_PATTERN` with the `mcp` family AND update the central expected-script
      registry in `packages/persistence/test/migrator.spec.ts` (all assertion counts) — the
      plan-sanctioned scope exception per ADR-0019. — **FR-MCP-009** — AC-251
- [x] T004 [P] Create `tests/fixtures/mcp/`: valid/invalid Origin header sets
      (punycode, trailing-dot, mixed-case, wrong-port, IPv6, mixed-scheme), credential seeds
      (known HMAC test peppers only), session fixtures, resumable cursors, oversized payloads,
      injection strings. — **FR-MCP-008** — AC-250

## Phase 2 — Server composition: config + fixed admission pipeline

- [x] T005 Implement `apps/api/src/config.ts`: zod (ADR-0013) schema of the G.13 MCP security
      block — protocol baseline `2025-11-25`, STREAMABLE_HTTP, EXACT_ALLOWLIST origins,
      absent/null-origin policy, `stateful_sessions_enabled: false`, `maximum_request_bytes:
262144`, §29.4 caps (1 MiB structured response, 100-record page) — fail-closed on unknown
      keys. — **FR-MCP-001** — AC-251
- [x] T006 Implement `apps/api/src/mcp/admission.ts`: the single normative admission pipeline
      (size cap → Origin → protocol guard → credential auth → session resolution → rate/
      concurrency admission → dispatch) that short-circuits typed deterministic refusals with no
      downstream effect (INV-037; ADR-0022). — **FR-MCP-001** — AC-251
- [x] T007 Implement `apps/api/src/mcp/origin-wiring.ts`: compose the landed
      `McpOriginGate.decide()` verdict module (consumed from the security package — the only
      write is `apps/api/src/mcp/origin-wiring.ts`) with exact scheme-host-port allowlist;
      refused present Origin → HTTP 403 BEFORE session creation, authentication side effects,
      tool execution, or resource access; absent-Origin per §17.2 explicit policy (production
      refuses; per-client registered non-browser allowance honored from credential policy);
      loopback local mode with separate local allowlist; proxy headers trusted only from
      allowlisted proxies; Origin policy ⊥ authentication policy. — **FR-MCP-008** — AC-250
- [x] T008 Implement `apps/api/src/mcp/protocol-wiring.ts`: compose `McpProtocolGuard.inspect()`
      — protocol revision (baseline + mutually tested set), content type, POST method semantics,
      message size, session binding claims, resumable-cursor ownership — plus JSON-RPC request
      correlation and the MCP SDK Streamable HTTP transport (`/mcp` endpoint); draft revisions
      opt-in only. — **FR-MCP-009** — AC-251, AC-144
- [x] T009 Implement `apps/api/src/main.ts` + `apps/api/src/mcp/server.ts` composition root
      (Hono host only if the SDK transport needs it) wiring `createToolCore` seams (authn, authz,
      quotaAdapter, licenseSource, egressGuard, objectStore) with deny-closed defaults
      preserved; `HolderMode.MCP_MANUAL`; package smoke suite `apps/api/test/server.spec.ts`
      (PURE workload). — **FR-MCP-001** — AC-001

## Phase 3 — Auth, sessions, rate limits

- [x] T010 Implement `apps/api/src/auth/bearer.ts` + `apps/api/src/auth/client-context.ts`:
      §17.5 personal bearer mode over `McpCredentialStore` with `strictPresentation` enabled
      (sourceIp + origin + requestedScopes on every presentation), ≥256-bit entropy,
      HMAC-SHA256 keyed hash + server-side pepper, prefix-only identification, secret shown
      exactly once and never logged, per-client scopes/tool-profile/entity/quota/origin/expiry
      context. — **FR-MCP-005** — AC-052, AC-053
- [x] T011 Implement credential lifecycle endpoints/operations: issue (once-only secret
      display), list-prefix, and revoke; revocation takes effect on the next request; independent
      per-client rate-limit classes and incident attribution recorded. — **FR-MCP-004** — AC-053
- [x] T012 Implement `apps/api/src/mcp/session-store.ts` (PGlite-backed): crypto-random
      visible-ASCII session IDs never encoding secrets, bound to authenticated actor, tool
      profile, Origin policy, protocol revision, and expiry; missing required session ID → 400;
      expired/terminated → 404; idempotent DELETE termination; conversation memory stays in the
      platform session store. Suite `apps/api/test/session-store.spec.ts` (DATABASE_PGLITE via
      coordinator). — **FR-MCP-009** — AC-251
- [x] T013 Implement `apps/api/src/mcp/rate-limits.ts`: per-client token-bucket rate + concurrent
      request cap composed from `AbuseController.admit()`; refusal is deterministic and audited;
      state transitions idempotent and fenced (INV-009). — **FR-MCP-009** — AC-251

## Phase 4 — Tools, resources, prompts, output

- [x] T014 Implement `apps/api/src/mcp/tools.ts`: expose the §17.10 G0 tool catalog
      (`system_health`, `quota_get_status`, `capacity_get_status`, `provider_get_health`,
      `collector_get_health`, `capability_get_status`, diagnostic/expert provider tools, domain
      tools) STRICTLY through the Shared Tool Core registry + `ToolCore.execute`; per-client
      `ToolProfileId` binding; provider-specific atomic tools only for allowed profiles;
      plan-gated operations absent from STRICT_FREE profiles. — **FR-MCP-002** — AC-001
- [x] T015 Implement `apps/api/src/mcp/output.ts`: §17.4 output contract — JSON Schema
      `outputSchema` per tool, structured + concise human content, evidence/resource links over
      oversized raw payloads, §29.4 caps, deterministic ordering + cursor pagination mapped to
      `nextCursor`, quality/freshness/capability/rights/cost/source-dependence/partial-result
      metadata, explicit abstention states, and a prohibited-payload scrub (no transaction
      payload, private key, signature request, seed phrase, route transaction, executable
      financial instruction). — **FR-MCP-003** — AC-002, AC-004, AC-050
- [x] T016 Implement `apps/api/src/mcp/resources.ts`: §17.3 URI schemes (`evidence://`,
      `run://`, `candidate://`, `snapshot://`, `report://`, `conflict://`, `capacity://`,
      `tradability://`); authorization re-evaluated on EVERY access (actor scope, entity scope,
      rights policy, retention state); a URI grants no authority beyond the credential; byte/
      record/decompression/content-type limits; large downloads only via short-lived
      audience-bound signed URLs or bounded proxied streaming; raw artifacts blocked when rights
      permit derived data only; browser-rendered resources sanitized (no remote loads/active
      content). — **FR-MCP-010** — AC-252
- [x] T017 Implement independent resource-access auditing: every resource fetch (and every tool
      call) appends to `AuditChain.append({ occurredAt, actor, actionClass, subject, payload })`
      with mcp-surface action classes selected from the existing security audit-category
      registry (dependency consumption only — the write is the audit wiring in
      `apps/api/src/mcp/resources.ts` and `apps/api/test/audit-facet.spec.ts`; no chain edits,
      no new audit-category files). —
      **FR-MCP-010** — AC-259
- [x] T018 Implement `apps/api/src/mcp/prompts.ts`: the eight §17.3 prompts
      (`analyze-token`, `investigate-alert`, `compare-candidates`, `audit-security`,
      `explain-original-decision`, `re-evaluate-current`, `analyze-wallet-cluster`,
      `challenge-opportunity-thesis`) bound to the caller's profile/scopes. —
      **FR-MCP-002** — AC-001

## Phase 5 — Acceptance facets, AC-144 suites, negative scans

- [x] T019 [P] Extend `tests/acceptance/AC-001.spec.ts` + `tests/negative/AC-001.negative.spec.ts`
      with the mcp-surface facet: manual client initialize → list scoped profile → analyze via
      HTTP tool call; explicit degradation of unavailable optional providers. — **FR-MCP-002** —
      AC-001
- [x] T020 [P] Extend AC-002/AC-003/AC-004 positive+negative suites with mcp-surface facets:
      envelope passthrough (quality/time/provenance/evidence), concurrent-mode single provider
      call, explicit abstention over MCP. — **FR-MCP-003** — AC-002, AC-003, AC-004
- [x] T021 [P] Create `tests/acceptance/AC-144.spec.ts` + `tests/negative/AC-144.negative.spec.ts`:
      compatibility matrix green for stable revision `2025-11-25` and each supported target
      client; draft revisions refused unless explicitly opted in. — **FR-MCP-009** — AC-144
- [ ] T022 [P] Extend AC-050/AC-254/AC-255 scan suites: add `apps/api` routes, tools, schemas,
      and environment schema to the five-scan-surface pattern; prove no swap/bridge/order
      execution, transaction build/sign/submit, private-key/seed, wallet
      creation/import/export/custody path exists on the surface; GMGN query fixtures pass while
      prohibited schemas/endpoints/tools/env/imports fail policy. — **FR-MCP-003** — AC-050,
      AC-254, AC-255
- [x] T023 [P] Extend AC-250/AC-251 positive+negative suites: real-HTTP wiring of Origin verdicts
      (allowlisted passes; punycode-confused/trailing-dot/mixed-scheme/wrong-port/invalid → 403
      before anything) and protocol refusals (unsupported revision, invalid content type,
      invalid method, oversized message, foreign session ID, unauthorized cursor → deterministic
      failure, zero tool execution). — **FR-MCP-008** — AC-250, AC-251
- [x] T024 [P] Extend AC-252 positive+negative suites: cross-client/cross-tenant resource fetch
      refused without original scope+rights, including signed-URL, range, redirect, and
      path-confusion attempts. — **FR-MCP-010** — AC-252
- [x] T025 [P] Extend AC-051/AC-052/AC-053 and AC-257/AC-258/AC-259 suites with surface facets:
      injection fixtures cannot alter tools/scopes/URLs/budgets/policies; pepper/bearer secrets
      absent from logs/traces/outputs; revocation effective next request; SSRF/oversized/slow
      fail-closed through the request cap; audit tamper detection green with surface events.
      Re-run the security-owned AC-253 OAuth binding suite unchanged to confirm the surface
      composes with it (no OAuth server code in this package). —
      **FR-MCP-004** — AC-051, AC-052, AC-053, AC-257, AC-258, AC-259

## Phase 6 — Telemetry, session fixtures, convergence

- [x] T026 [P] Add `telemetry/mcp.catalog.json` (declarative catalog: `mcp.*` events — surface
      request/refusal outcomes by stage, session lifecycle, rate-limit admissions, resource
      access — with requirementRefs to the FR-MCP assignments) satisfying the telemetry catalog
      contract test. — **FR-MCP-001** — AC-251
- [x] T027 Run the full gate: `pnpm --filter @foresift/api test`,
      `packages/persistence/test/migrator.spec.ts` green with the extended registry,
      `pnpm verify` and `pnpm spec:verify` at HEAD; fix all findings additively (no amend, no
      rebase). — **FR-MCP-001** — AC-001, AC-251
- [x] T028 Close the traceability matrix below and confirm the material decisions of this plan
      (proposed ADR texts: admission-order composition, stateless-default sessions, MCP SDK
      pinning) are carried into the ADR process — the proposed texts live in the package plan;
      formal ADR authorship happens through the convergence review, not as a predicted write of
      this package. —
      **FR-MCP-001** — AC-001

## Traceability matrix

| Task      | Requirements                       | Acceptance criteria                                    |
| --------- | ---------------------------------- | ------------------------------------------------------ |
| T001–T005 | FR-MCP-001, FR-MCP-003, FR-MCP-009 | AC-001, AC-251                                         |
| T006–T009 | FR-MCP-001, FR-MCP-008, FR-MCP-009 | AC-250, AC-251, AC-144, AC-001                         |
| T010–T013 | FR-MCP-004, FR-MCP-005, FR-MCP-009 | AC-052, AC-053, AC-251                                 |
| T014–T018 | FR-MCP-002, FR-MCP-003, FR-MCP-010 | AC-001, AC-002, AC-004, AC-050, AC-252, AC-259         |
| T019–T025 | FR-MCP-002..FR-MCP-010             | AC-001..AC-004, AC-050..AC-053, AC-144, AC-250..AC-259 |
| T026–T028 | FR-MCP-001                         | AC-001, AC-251                                         |

## Scope exceptions (plan-sanctioned)

- `packages/persistence/src/migrator.ts` + `packages/persistence/test/migrator.spec.ts`
  (T003): ADR-0019 central migration registry duty — must be edited in the same package that
  adds `g0_mcp_*.sql` scripts.
- Root `package.json` / `pnpm-lock.yaml` (T001): mechanical workspace linkage of `@foresift/api`
  (ADR-0020 bookkeeping precedent).
