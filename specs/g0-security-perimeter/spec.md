# Work-Package Specification: g0-security-perimeter

> **SUBORDINATION NOTICE**: This file is a **scoped Spec Kit derivative** of the
> authoritative product contract
> `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` and its
> machine-readable requirement manifest
> (`docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`).
> It is subordinate to the PRD in all cases. Where this file and the PRD appear
> to conflict, the PRD wins and the conflict is recorded as an ADR. Nothing here
> edits, weakens, or reinterprets an authoritative requirement.

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Milestone         | G0 (foundation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Package id        | `g0-security-perimeter` (milestone entry, status RUNNING, generation 0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Risk              | CRITICAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dependencies      | `g0-contracts-data-truth` (PROVEN — persistence, object-store, shared-schemas, and domain substrate are merged and green on this branch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Normative source  | PRD §35 (Security, privacy, abuse, and external-capability requirements), §38.43 (FR-SEC family), §39 acceptance criteria, §45 architecture invariants; manifest `line` anchors 6482–6493 into the PRD file; activation gates §9.5/§40/§46; rollback anchor §85.6                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Package objective | Stand up the permanent read-only security perimeter: append-only hash-chained audit chain with continuous verification, phishing-resistant step-up authentication primitives, deny-by-default egress/SSRF controls with rebinding tests, untrusted-content isolation, secrets and supply-chain policy, Alpha Lab import gating (approved non-executable schemas only, signature/hash/producer-trust verification, quarantine and content scanning, no direct policy activation), tenant-isolation and abuse-control primitives, incident process, and automated static/runtime proofs that no trading, custody, wallet-signing, private-key, or transaction-submission capability exists anywhere in the codebase. |

## 1. Scope statement

This package owns the permanent read-only security perimeter: tamper-evident
audit integrity, high-impact-action step-up gating, deny-by-default egress,
untrusted-content isolation, secrets/supply-chain policy, Alpha Lab import
gating, tenant isolation, abuse controls, incident process, threat models, and
the automated proofs of negative capability. It is implemented inside the
package's binding write scopes:

```text
packages/security/**                        packages/tenant-isolation/**
packages/shared-schemas/**                  scripts/scan-prohibited-capabilities/**
migrations/g0_sec_*.sql                     tests/fixtures/sec/**
tests/acceptance/**                         tests/negative/**
telemetry/sec.*                             docs/runbooks/**
```

Per the milestone decomposition record
(`specs/implementation/current-milestone.json`), all
`docs/generated/<family>-surfaces.json` artifacts are generated centrally by
the traceability/conformance package at milestone convergence and are NOT
produced by this package, even though the manifest lists
`docs/generated/sec-surfaces.json` in `apiToolUiRefs`.

## 2. Assigned requirements (normative text quoted from the authoritative manifest)

All twelve assigned requirements are normative level **MUST**, dependency group
**G0**, subsection 38.43 "MCP, security, recovery, public release, and
conformance". Every requirement carries the same family-level control set:
INV-001 through INV-010, §9.5, §33, §34, §35, §37, with activation gates
dependency-group G0, §40, and §46.

### FR-SEC-001 — Phishing-resistant step-up for high-impact actions

- **Normative text (manifest, PRD line 6482)**: "High-impact actions require
  phishing-resistant step-up authentication, fresh authorization, CSRF
  protection, idempotency, reason entry, and audit; TOTP alone is not
  sufficient for production high-impact actions."
- **Owner**: `packages/security`. **Schema ref**:
  `packages/shared-schemas/src/sec.ts`. **Implementation refs**:
  `packages/security/**`, `packages/tenant-isolation/**`.
- Binding elaboration from the authoritative contract: §35.1 admin
  authentication controls (Google OIDC through a reviewed adapter, exact
  owner-email allowlist in personal mode, secure HTTP-only same-site cookies,
  session rotation, short idle/bounded absolute lifetime, phishing-resistant
  passkey/hardware-backed step-up for secret changes, capability expansion,
  schedule/alert activation, artifact trust changes, public publishing, kill
  switches, and irreversible administration; TOTP MAY be a recovery factor but
  never the sole high-impact production factor); Appendix B default action
  scopes — the `admin:high:*` class (`configuration-activate`,
  `provider-operation-state`, `collector-state`, `pool-adapter-state`,
  `alpha-artifact-state`, `public-authorization`, `kill-switch`,
  `secret-rotation`, `restore`, `release-conformance`) is exactly the
  high-impact class requiring step-up plus approval artifact.

### FR-SEC-002 — Append-only hash-chained audit with continuous verification

- **Normative text (manifest, PRD line 6483)**: "Audit records are append-only,
  hash chained or signed in batches, periodically checkpointed to an
  independently verifiable location, and continuously verified for gaps,
  reordering, mutation, or deletion."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.9: audit covers authentication and
  authorization; tool/resource access; provider/collector calls and blocked
  operations; configuration, capability, cost, rights, source-dependence,
  pool-adapter, and public-gate changes; approvals, step-up, imports,
  promotions, pauses, retirements, and rollbacks; secret lifecycle; incidents
  and recovery actions. Audit verification failure creates a critical incident
  and blocks high-impact activation. Product ADR-056 requires chained/signed
  audit checkpoints.

### FR-SEC-003 — Automated proof of prohibited-capability absence

- **Normative text (manifest, PRD line 6484)**: "Static analysis, dependency
  policy, route/tool inventory, environment-schema scanning, and runtime
  canaries prove absence of private-key, seed phrase, signing,
  transaction-building, swap, submit, bridge, custody, or exchange-trading
  capability."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.7 (production MUST NOT contain an enabled path
  for wallet creation/import/export, seed phrase or private key
  input/storage, transaction construction, swap/order routing for execution,
  signing, broadcast/submission, custody, exchange trading API, copy trading;
  controls include dependency/runtime catalogue scanning, generated tool/
  OpenAPI/MCP schema scanning, environment-variable allowlist and
  forbidden-name scan, provider bundle decomposition into read-only operation
  adapters, no wholesale installation of GMGN or another skill/MCP bundle
  containing trading capability, no transaction payload persistence or model
  rendering, quote adapters discard and reject transaction-construction
  fields, isolated negative fixtures prove rejection) and §41.1 (permanently
  prohibited capabilities cannot be enabled by any ADR or configuration).
  Read-only wallet intelligence routes and schemas remain permitted
  (AC-254).

### FR-SEC-004 — Deny-by-default egress control and SSRF defenses

- **Normative text (manifest, PRD line 6485)**: "Outbound requests enforce DNS
  resolution policy, private/link-local/loopback/metadata-address denial,
  redirect revalidation, response byte/time limits, TLS validation, and exact
  egress allowlists; DNS rebinding and mixed-encoding bypasses are tested."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.3: provider and chain endpoints are exact
  allowlisted destinations; arbitrary URL fetch is prohibited for privileged
  agents; block localhost, loopback, link-local, private ranges, metadata
  endpoints, onion/custom schemes, and unsafe ports; resolve and revalidate
  DNS before each connection/redirect where applicable; reject redirects to a
  different unapproved origin; cap response size, decompression ratio,
  duration, content type, and redirect count; separate egress policies for
  control plane, collector, and Alpha Lab; authorization-server URL retrieval
  receives the same SSRF defenses.

### FR-SEC-005 — Untrusted-content isolation

- **Normative text (manifest, PRD line 6486)**: "Token metadata, social text,
  websites, provider text, notebooks, model output, and imported artifacts are
  untrusted data; they cannot alter system instructions, tool schemas, scopes,
  URLs, budgets, policies, or side effects."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.4: external prose, token metadata, social text,
  websites, provider descriptions, notebook text, and imported labels are
  untrusted data; untrusted content is never inserted into system/developer
  instruction roles; privileged reasoning receives structured extraction and
  source labels; every tool call is revalidated against user intent, actor
  scope, candidate scope, policy, budget, capability, and action class;
  memory is isolated by actor/session/workspace; internal writes require
  explicit approval and deterministic authorization; secrets never enter model
  context; model output cannot alter tool schemas, Origin policies, providers,
  schedules, capabilities, or alert policy. §35.5 render-safety rules
  (Markdown/HTML/SVG/link sanitization policy, CSP posture, remote-image
  policy, exfiltration-resistant links) bind the content-safety validators
  this package delivers.

### FR-SEC-006 — Supply-chain security policy

- **Normative text (manifest, PRD line 6487)**: "Dependencies, container
  images, workflow bundles, database migrations, generated schemas, and
  release artifacts are pinned, hashed, scanned, SBOM-recorded,
  provenance-attested where supported, and reproducible from the lockfile."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.8: lockfile mandatory; exact dependency pinning
  for production builds; automated vulnerability, provenance, license, and
  malicious-package scanning; secret scanning; SBOM generation; restricted
  lifecycle/install scripts; signed build/deployment provenance where
  available; dependency review for packages that access network, filesystem,
  process execution, crypto keys, or dynamic code; reproducible build hash
  recorded in deployments and replay manifests; emergency dependency
  revocation and rollback runbook.

### FR-SEC-007 — Secret lifecycle and handling policy

- **Normative text (manifest, PRD line 6488)**: "Secrets use least privilege,
  separate environments, rotation, revocation, no model context, no logs, no
  client exposure, no Alpha Lab export, and incident-triggered invalidation;
  configuration validates that prohibited secret classes do not exist."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.11: create, verify, rotate, revoke, expire, and
  last-used metadata; overlap window for rotation where supported; full stored
  secret never displayed; dedicated secret manager or envelope encryption;
  production/collector/Alpha Lab credentials separate; compromised-credential
  response includes revoke, affected-run search, provider review, cache
  invalidation, and incident creation; no secret backup outside managed
  encrypted recovery policy; trusted artifact public keys have rotation and
  revocation; producer private keys never exist in production.

### FR-SEC-008 — Alpha Lab import gating

- **Normative text (manifest, PRD line 6489)**: "Alpha Lab imports accept only
  approved non-executable schemas and enforce signature, hash, producer trust,
  archive/path/size/complexity limits, quarantine, malware/content scanning,
  and no direct policy activation."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.14 and product ADRs 044/046: exports exclude
  production database credentials, provider secrets, admin sessions, MCP keys,
  signing private keys, and unrelated tables; imported artifacts are data-only
  — permitted formats are versioned JSON/JSONL, Parquet, and approved
  compressed containers with file-count, path, size, and decompression limits;
  pickle, executable JavaScript/WASM/native libraries, model code, shell
  scripts, macros, arbitrary SQL, dynamic modules, unsafe deserialization,
  symlinks, and path traversal are prohibited; validation verifies
  authenticated admin action with phishing-resistant step-up, asymmetric
  signature against a trusted producer public-key allowlist, content hashes
  and canonical serialization, schema version/dataset manifest/cutoff/code
  hash/deterministic seed, producer identity/key validity/expiry/revocation,
  holdout/leakage/adversarial/evaluation status, resource limits; parsing
  occurs in an isolated process with no provider/network/secret access where
  feasible; imported artifacts enter VALIDATING or SHADOW, never ACTIVE.

### FR-SEC-009 — Tenant isolation

- **Normative text (manifest, PRD line 6490)**: "Workspace/public mode enforces
  tenant isolation for rows, artifacts, cache, queues, sessions, quotas, logs,
  signed URLs, metrics, and model context with cross-tenant adversarial
  tests."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.15 (no user can use the service to enumerate
  secrets, private data, or another tenant's resources) and product ADR-057
  (workspace/public release separately authorized per surface and tenant
  model). The isolation _primitives_ and adversarial proof suite land here;
  workspace/public distribution itself remains gated by later packages.

### FR-SEC-010 — Abuse controls

- **Normative text (manifest, PRD line 6491)**: "Abuse controls cover request
  floods, expensive-query amplification, quota exhaustion, source scraping,
  alert harvesting, prompt attacks, resource enumeration, and
  market-manipulation feedback loops without weakening protected risk
  monitoring."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.15 abuse-reporting/rate-limit/denial/suspension
  posture, §37.16 adversarial suites, and INV-003: abuse responses must never
  disable protected deterministic risk monitoring, and must never create an
  automated external side effect outside deterministic notification policy.

### FR-SEC-011 — Security incident process

- **Normative text (manifest, PRD line 6492)**: "Security incidents have
  severity, owner, containment, evidence preservation, credential rotation,
  customer/owner notification policy, recovery verification, postmortem, and
  regression test."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §35.9 (audit verification failure creates a critical
  incident and blocks high-impact activation), §35.11 (compromised-credential
  response), and §34 incident discipline. The incident record model, severity
  taxonomy, state machine, and the runbooks that operationalize them land
  here; paging/notification delivery wiring lands with observability work in
  a later milestone.

### FR-SEC-012 — Threat models and automated security suite per trust boundary

- **Normative text (manifest, PRD line 6493)**: "Production release requires a
  threat model and automated security suite for every trust boundary,
  including MCP, admin, webhooks, providers, collector, model, database,
  object store, Alpha Lab, notifications, and public distribution."
- Same owner/schema/implementation refs as FR-SEC-001.
- Binding elaboration from §9.3 (the eight trust-boundary rules),
  §35.16 (mandatory adversarial security suite contents), and §37.17
  (audit-chain corruption test mandatory before corresponding activation
  states). This package delivers the threat-model register covering all
  eleven enumerated boundaries and maps each boundary to the automated suites
  it ships or consumes; boundaries whose owning subsystems arrive in later
  packages reference those packages' future suites explicitly rather than
  pretending coverage exists.

## 3. Acceptance criteria (quoted from the authoritative manifest §39)

The manifest assigns each requirement above to the twenty family-level
acceptance criteria below. Each AC has both a positive test ref and a
negative/failure-path test ref in the manifest
(`tests/acceptance/AC-*.spec.ts` + `tests/negative/AC-*.negative.spec.ts`);
both must exist as executable verification. Where full closure of an AC
depends on transports or subsystems owned by later packages, this package
delivers the security-primitive obligations listed under "scoped obligation"
and the remainder is a non-goal recorded in §6.

### 3.1 Negative-capability and secret criteria

| ID     | Normative text (§39)                                                                          | Scoped obligation in this package                                                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-050 | "No route, tool, or schema supports trading, signing, wallet creation, seed, or private key." | Fully owned here: static scan CLI over source/inventories, runtime canary over registered schemas/routes, env-schema forbidden-name scan; negative fixtures prove the scanners DETECT each prohibited category while the real tree stays clean.                               |
| AC-051 | "SSRF, prompt injection, malicious Markdown, and forged scheduler webhook tests pass."        | Fully owned at the primitive level: egress guard battery, injection-containment battery across the seven untrusted classes, Markdown/link safety validators, webhook signature/timestamp/replay validation primitives exercised against forged inputs.                        |
| AC-052 | "Secrets do not appear in model context, logs, traces, exports, or UI."                       | Fully owned at the primitive level: secret-classification scanning guards over structured context envelopes, log redaction policy, export/UI denial rules; negative tests prove classified material is refused, never silently passed through.                                |
| AC-053 | "MCP credentials are independently scoped and revocable."                                     | Fully owned at the primitive level: credential descriptor model (≥256-bit entropy generation, keyed-hash-at-rest, scope set, Origin policy binding, expiry, independent revocation); storage-backed lifecycle records prove one credential's revocation leaves others intact. |

### 3.2 MCP transport-security criteria (primitives; transport wiring belongs to the MCP-surface package)

| ID     | Normative text (§39)                                                                                                                                                                                       | Scoped obligation in this package                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-250 | "A valid allowlisted MCP Origin reaches authentication; a present invalid, punycode-confused, trailing-dot, mixed-scheme, or wrong-port Origin receives HTTP 403 before session/tool/resource processing." | Origin-validation policy module owned here: exact-match decision engine producing typed accept/refuse verdicts for every listed bypass class; the MCP-surface package wires the module's refuse verdicts to HTTP 403 before any processing.                   |
| AC-251 | "Unsupported MCP protocol version, invalid content type/method, oversized message, foreign session ID, or unauthorized resumable cursor fails deterministically without tool execution."                   | Protocol/session guard rules owned here: revision allowlist, content-type/method checks, message-size caps, session binding verification, resumable-cursor authorization check — deterministic typed refusals; transport wiring is the MCP-surface package's. |
| AC-252 | "A resource URI created by one client/tenant cannot be fetched by another client/tenant lacking the original scope and rights, including through signed-URL, range, redirect, or path-confusion attempts." | Resource-access authorization guard owned here: tenant/scope/rights-bound decisions refusing cross-tenant reads through every listed bypass vector, delivered inside the tenant-isolation package and consumed by MCP transport wiring later.                 |
| AC-253 | "OAuth tests enforce PKCE, exact redirect URI, audience/resource binding, token expiry, scope, and no upstream token passthrough before workspace/public technical readiness."                             | OAuth token-binding validators owned here: PKCE requirement, exact redirect URI matching, audience/resource indicators, expiry, scope narrowing, passthrough refusal; the OAuth server/client wiring itself lands with the MCP-surface package.               |

### 3.3 Prohibited-capability scan criteria

| ID     | Normative text (§39)                                                                                                                                                                                                                                                                                  | Scoped obligation in this package                                                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-254 | "Dependency, route, tool, environment-schema, and runtime scans find no swap/bridge/order execution, transaction build/sign/submit, private-key/seed, wallet creation/import/export/custody/management, or exchange-trading path; read-only wallet intelligence routes and schemas remain permitted." | Fully owned here: the five declared scan surfaces (dependency catalogue, route inventory, tool registry input, environment schema, runtime canary) executed green over the tree, with read-only wallet-intelligence entries explicitly allowlisted and their permission re-proven by fixture.                                 |
| AC-255 | "GMGN query fixtures pass while swap/private-key/transaction schemas, endpoints, tools, environment variables, or package imports fail build or runtime policy."                                                                                                                                      | Fully owned here: GMGN-shaped read-only query fixtures pass every gate while paired forbidden variants (swap endpoint, private-key env name, signing import, transaction schema field) fail with typed policy errors at both build-scan and runtime-validation layers.                                                        |
| AC-256 | "A deprecated Helius enhanced parser cannot be configured as the sole or authoritative economic-event decoder; supported raw transaction/history operations plus local decoding remain the normative path."                                                                                           | Decoder-authority policy validator owned here: refuses configuration that marks a deprecated parser as sole or authoritative, with a Helius enhanced-parser fixture proving refusal while raw-operation-plus-local-decoding configuration passes. The deprecation registries themselves are the provider-lifecycle package's. |
| AC-257 | "SSRF fixtures covering loopback, private/link-local/metadata IPs, redirects, DNS rebinding, IPv6, encoded hosts, userinfo, mixed schemes, oversized responses, and slow streams fail closed."                                                                                                        | Fully owned here: the complete SSRF fixture battery against the egress guard, each class failing closed with a typed reason; rebinding modeled through a controllable resolver seam resolving to a denied address between validation and connect.                                                                             |
| AC-258 | "Prompt-injection strings in token metadata, social text, provider text, notebook entries, websites, and model output cannot alter tools, scopes, URLs, budgets, policies, or side effects."                                                                                                          | Fully owned at the isolation-layer level: injected instruction strings placed in each content class are carried only as labeled data through the structured-extraction envelope; enforcement assertions prove no mutation path exists from content to tools/scopes/URLs/budgets/policies/side effects.                        |

### 3.4 Audit-integrity criteria

| ID     | Normative text (§39)                                                                                                                                                 | Scoped obligation in this package                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-259 | "Audit mutation, deletion, insertion, reordering, or chain-break fixtures are detected by continuous verification and independently checkpointed hashes/signatures." | Fully owned here: append-only hash-chained audit store (SQL-enforced immutability), periodic checkpoints written to an independently verifiable location via the object-store adapter, and a continuous verifier detecting every listed corruption class in fixtures. |

### 3.5 High-impact administration and isolation criteria

| ID     | Normative text (§39)                                                                                                                                                                                                         | Scoped obligation in this package                                                                                                                                                                                                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-274 | "High-impact admin actions fail without fresh phishing-resistant step-up, exact authorization, CSRF protection, idempotency key, reason, and audit; TOTP-only authentication is insufficient."                               | Fully owned at the gate level: `evaluateHighImpactAction` refuses each missing dimension with a typed reason over the Appendix B `admin:high:*` action class; TOTP-only proof refused by authenticator-class policy; audit emission proven. Admin UI wiring is a non-goal.                                                                                      |
| AC-275 | "Cross-tenant row, artifact, cache, queue, session, quota, log, metric, signed-URL, and model-context fixtures prove isolation before workspace/public readiness."                                                           | Fully owned at the primitive+fixture level: tenant-isolation package delivers namespacing/scoping primitives for all eleven surfaces and the adversarial cross-tenant fixture matrix proves refusal on every surface; workspace/public rollout remains gated later.                                                                                             |
| AC-276 | "Marketing/UI/API/export text containing guaranteed-profit, risk-free, universal-recall, calibrated-probability-without-calibration, or unsupported performance language fails content-policy validation."                   | Claims-policy validator fully owned here: pattern-based content-policy checker refusing each prohibited claim class across marketing/UI/API/export channels, with paired clean-text acceptance controls.                                                                                                                                                        |
| AC-277 | "Public output exposes evidence, timestamps, execution assumptions, limitations, and disclaimer but redacts protected detector thresholds and sensitive entity details capable of enabling evasion or abuse."                | Public-output envelope validator fully owned here: required-field presence (evidence, timestamps, execution assumptions, limitations, disclaimer) enforced AND redaction rule engine stripping detector thresholds/sensitive entity details; both directions fixture-tested.                                                                                    |
| AC-278 | "A failed critical security, parity, leakage, rights, capacity, recovery, calibration, adversarial, or claims gate pauses only the smallest affected scope, records the reason, and does not auto-reactivate."               | Pause-state machinery fully owned here: scoped pause records (smallest affected capability scope), durable reason capture linked to audit, machine-checked refusal of automatic reactivation; resume requires explicit audited approval. Gate evaluation engines for other families consume this machinery later.                                               |
| AC-279 | "Rollback restores a previously approved immutable configuration/artifact set, creates a new activation event, preserves all historical decisions, and re-evaluates currently actionable candidates before resuming alerts." | Rollback ledger primitives owned here: immutable approved-set snapshots, new activation-event records on restore, historical-decision preservation guarantees, and actionable-candidate re-evaluation markers emitted for later consumers. Alert-resumption orchestration itself belongs to governance/alerting packages (non-goal beyond the marker contract). |

## 4. Applicable architecture invariants (manifest §45)

The manifest lists INV-001 through INV-010 as controls for every requirement in
this package. Their normative texts:

| ID      | Text (PRD §45)                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-001 | "The system is permanently read-only with respect to financial execution, custody, signing, and transaction construction."                                                |
| INV-002 | "Agent intelligence never replaces deterministic identity, evidence, time, execution, risk, capability, rights, cost, quota, capacity, or policy controls."               |
| INV-003 | "No automated external side effect occurs directly from model output."                                                                                                    |
| INV-004 | "Every retained decision is reconstructable from frozen evidence, availability, acquisition state, configuration, code, adapter, and artifact versions."                  |
| INV-005 | "Historical replay uses only data and learned artifacts actually available to the system at the simulated time."                                                          |
| INV-006 | "Backfilled historical data is never backdated into production replay."                                                                                                   |
| INV-007 | "Evaluation includes alerts, watches, ignores, rejects, below-cutoff cases, exploration/control cases, and missed opportunities under symmetric action-time semantics."   |
| INV-008 | "Provider count is not source independence; declared lineage and empirical dependence both constrain effective confirmation."                                             |
| INV-009 | "A durable workflow or collector may retry; every state transition and external side effect remains idempotent and fenced."                                               |
| INV-010 | "The primary policy objective is conservative net shadow-portfolio utility under finite capital and hard constraints, not isolated price appreciation or alert win rate." |

Directly load-bearing for this package: INV-001 (this package EXISTS to prove
and enforce it — nothing here may introduce any prohibited capability, and the
scanners exist so no later change can either), INV-002 (step-up/CSRF/idempotency
gates are deterministic controls, never agent-negotiable), INV-003 (abuse
responses and untrusted-content isolation leave no model-output side-effect
path), INV-004 (audit chain preserves reconstructability of retained
decisions), INV-009 (idempotency keys in the high-impact gate; fenced audit
appends), and the §41.1 permanence rule (prohibited capabilities cannot be
enabled by any ADR or configuration).

## 5. Accepted product ADRs directly binding this package

Quoted/summarized from Appendix D of the authoritative PRD (all ACCEPTED there):

- **ADR-001**: PostgreSQL is authoritative for operational state; SQL migrations
  are the schema source of truth; unique constraints, transactions, locks,
  leases with fencing tokens, and appropriate isolation enforce correctness.
- **ADR-003**: S3-compatible `ObjectStoreAdapter`; objects are content-addressed,
  rights-aware, encrypted, versioned where required — the independently
  verifiable checkpoint location for the audit chain (§35.9) rides this
  existing adapter.
- **ADR-004**: Streamable HTTP over HTTPS with the official TypeScript MCP SDK,
  baseline revision `2025-11-25`, exact Origin validation, private bearer
  credentials for personal mode, OAuth 2.1/resource-bound authorization before
  workspace/public distribution; later revisions opt-in until conformance
  passes.
- **ADR-044**: Offline Alpha Lab runs in an isolated bounded runner with no
  production write/secret access; outputs are signed/hashed data artifacts with
  deterministic manifests.
- **ADR-046**: Alpha Lab imports accept only allowlisted data formats through
  sandboxed, size/decompression/path-limited parsing and asymmetric
  signature/hash/schema verification; executable formats, unsafe deserialization,
  scripts, macros, dynamic modules, and direct activation are prohibited.
- **ADR-054**: Provider operations carry expiring verification; deprecated/unknown
  operations fail closed; bundles exposing trading/signing/transaction/
  private-key/custody/execution capability are decomposed to allowlisted
  read-only adapters only.
- **ADR-055**: Validate present MCP Origin exactly before processing; enforce
  protocol/content/body/JSON-RPC limits; bind optional sessions to
  actor/profile/origin/revision; authorize every resource access; require
  resource-bound OAuth 2.1 with PKCE before public/workspace use.
- **ADR-056**: Tiered RPO/RTO with chained/signed audit checkpoints among the
  verified recovery surfaces.
- **ADR-057**: Workspace/public release is separately authorized per exact
  version, surface, tenant model, rights, jurisdiction, disclosures, claims,
  abuse response, support, and rollback evidence.
- **ADR-058**: Hash drift, orphan items, prohibited capabilities, or unresolved
  release-blocking deviations fail CI/release (why the scan gates must be
  deterministic and CI-runnable).

Accepted repository ADRs (binding implementation patterns):

- **ADR-0013** (`docs/adr/0013-runtime-schema-validation-zod.md`): Zod is the single
  approved runtime-validation library; authoritative schemas live in
  `packages/shared-schemas`.
- **ADR-0014** (`docs/adr/0014-pglite-deterministic-db-test-engine.md`): PGlite is
  the deterministic in-process PostgreSQL test engine; production remains real
  PostgreSQL per product ADR-001.

## 6. Explicit non-goals (everything else in milestone G0)

This package plans ONLY its twelve assigned requirements. The following are out
of scope and belong to other G0 packages per
`specs/implementation/current-milestone.json`; their absence here is deliberate:

- Canonical identity, immutable observations, point-in-time `available_at`
  replay, quality codes, feature parity, source lineage, backup/PITR durability
  (data-truth package — PROVEN dependency supplying the persistence, object-store,
  shared-schema, and domain substrate this package builds on; note: its restore
  verifier integrates with this package's audit-chain verification through an
  interface, but the chain itself is built here).
- Shared Tool Core registry/pipeline, cache/single-flight, license-policy
  extension points, permanent prohibited-financial enforcement hooks inside the
  pipeline (tool-core package; this package delivers the standalone scanners and
  canaries that pipeline will also invoke).
- Provider lifecycle truth, adapter auditing, quarantines, operation fingerprints
  (provider-lifecycle package; this package contributes only the AC-256
  decoder-authority policy validator and the negative-capability scan surfaces).
- Cost/quota/capacity control plane (cost-capacity package; abuse-control
  primitives here coordinate THROUGH those quotas but implement none).
- Solana collector, protocol decoders, discovery universe, cheap monitoring
  (first-party-observation package).
- MCP server transport, protocol endpoints, session store, OAuth server/client
  wiring, auth profiles, transport conformance (mcp-surface package; this package
  delivers the Origin/protocol/OAuth-binding/resource-access policy modules that
  transport wires in, per §3.2).
- Requirement-manifest tooling, release conformance, surface-map generation
  including `docs/generated/sec-surfaces.json`, telemetry ownership
  reconciliation (traceability/conformance package).
- Admin Workbench UI, browser session cookie issuance, Google OIDC login flow,
  notification/paging delivery infrastructure (control-plane/admin surfaces in
  later milestones; this package delivers the step-up, CSRF, and gate primitives
  those flows must call).
- Production infrastructure (TLS termination, WAF/network topology, secret-
  manager provisioning) — deployment concerns outside these write scopes.
- Any trading execution, custody, wallet signing, private-key handling, or
  transaction submission capability — permanently prohibited
  (READ_ONLY_NO_TRADING_CUSTODY_SIGNING); this package exists to prove such
  capability absent and must never introduce it, not even in fixture form outside
  the isolated scanner self-test corpus under `tests/fixtures/sec/`.

## 7. Package success criteria

1. All twelve assigned requirements have executable positive AND
   negative/failure-path verification at the manifest-declared test paths
   (20 acceptance + 20 negative specs), green on this branch.
2. `node scripts/scan-prohibited-capabilities/cli.mjs` exits green over the
   repository tree and red over every prohibited-category fixture under
   `tests/fixtures/sec/`.
3. Audit-chain corruption fixtures (mutation, deletion, insertion, reordering,
   chain break) are each detected by the continuous verifier; checkpoints are
   independently verifiable through the object-store adapter.
4. Migrations apply cleanly to empty databases alongside the proven
   `g0_data_*`/`g0_dr_*` sets without out-of-order or checksum conflicts;
   append-only/immutability constraints hold under adversarial tests.
5. No prohibited capability exists anywhere in delivered code, configuration,
   documentation, or fixtures outside the scanner self-test corpus; the
   perimeter modules themselves hold no secret material (references and keyed
   hashes only).
6. `pnpm verify` and `pnpm spec:verify` pass at the pushed HEAD.
7. No template placeholders remain in any scoped artifact; every task traces to
   an assigned requirement or its acceptance criteria.

## 8. Assumptions

- PGlite serves as the deterministic migration/repository test engine
  (repository ADR-0014); production remains real PostgreSQL per product
  ADR-001.
- Signature verification for import gating uses asymmetric cryptography over
  canonical bytes with injectable verifier seams; concrete key management is
  configuration, never committed material (producer public keys enter trusted
  allowlists through audited configuration, not source).
- Telemetry definitions are machine-readable declarative contracts under
  `telemetry/sec.*` mirroring the established catalog format; emitter wiring
  lands with observability work in a later milestone.
- The DNS-rebinding defense is modeled through a resolver seam (validate →
  resolve → pin → connect) so deterministic tests can force resolution changes
  without network access.
