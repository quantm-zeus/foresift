# Threat-model register

Living register of ALL eleven product trust boundaries (PRD §9.3). For each
boundary: assets, trust assumptions, top threats, controls delivered by
`g0-security-perimeter`, and mapped automated suites. A conformance test
(`packages/security/test/threat-model-register.spec.ts`) asserts this
register keeps every boundary enumerated and every mapped suite path either
existing on disk or explicitly marked `[deferred: <package>]`.

Legend: suite paths in backticks are CI-enforced today unless marked
**[deferred: package]** — meaning a LATER package owns landing that suite
when the subsystem arrives. The read-only product boundary (INV-001: no
trading execution, custody, wallet signing, private-key handling,
transaction submission) applies across ALL boundaries and is proven by the
prohibited-capability scanner + canary suites listed under "Product-wide".

---

### 1. MCP clients

**Assets**: MCP session state, credential hashes, tool/resource profiles,
request cursors, per-tenant quotas.

**Trust assumptions (§9.3)**: MCP clients are untrusted and scoped per
credential, Origin, protocol revision, resource, tool profile, and quota.

**Top threats**: origin spoofing/trailing-dot/punycode lookalikes; protocol-
revision downgrade; cross-session request smuggling; oversized message
DoS; cursor enumeration; CSRF on state-changing admin-flavored calls;
stale or TOTP-only step-up for high-impact actions.

**Controls (this package)**: origin gate (allowlist tuple, hygiene order),
protocol guard (revision/content-type/method/size/session-binding/cursor),
double-submit CSRF + origin binding, high-impact action gate with
phishing-resistant step-up policy, MCP credential lifecycle (keyed hash
storage, revocation, expiry, IP/origin/scope constraints).

**Automated suites**:

- `packages/security/test/mcp-origin-protocol.spec.ts`
- `packages/security/test/action-gate.spec.ts`
- `packages/security/test/oauth-credentials.spec.ts`
- `tests/acceptance/AC-250.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-251.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-250.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-251.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- HTTP transport wiring suites **[deferred: mcp-surface]**

### 2. Admin surface

**Assets**: high-impact action approvals, step-up proofs, idempotency keys,
reason entries, capability pause/resume authority.

**Trust assumptions (§9.3)**: browser/admin clients are untrusted until
authenticated AND authorized; only deterministic policy services authorize
configuration changes or lifecycle transitions.

**Top threats**: replayed approvals, scope mismatch (acting outside
`admin:high:*` class), missing reason/idempotency dimensions, reactivation
of critical-gate pauses without human resume, silent activation-ledger gaps.

**Controls (this package)**: `evaluateHighImpactAction` collecting ALL typed
refusal dimensions; step-up freshness via injected clock; pause ledger with
machine-refused auto-reactivation and audited explicit resume; append-only
activation events with immutable approved-set snapshots.

**Automated suites**:

- `packages/security/test/action-gate.spec.ts`
- `packages/security/test/gate-pause.spec.ts`
- `tests/acceptance/AC-274.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-274.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-278.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-279.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 3. Webhooks & scheduler/collector callbacks

**Assets**: callback integrity, replay cache, endpoint configuration.

**Trust assumptions (§9.3)**: scheduler and collector callbacks are untrusted
until signature, origin/source, replay, and payload validation pass.

**Top threats**: signature forgery, timestamp-stale replay, duplicate
delivery replay, attacker-configured endpoints replacing configured ones.

**Controls (this package)**: HMAC-SHA256 verifier over exact received bytes,
timestamp freshness window, event-id+payload-hash replay LRU, endpoint
pinned to configuration source (`SEC_WEBHOOK_ENDPOINT_SOURCE_REFUSED`).

**Automated suites**:

- `packages/security/test/webhook-abuse.spec.ts`
- `tests/acceptance/AC-051.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-051.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 4. Providers (external data APIs)

**Assets**: egress reputation, provider credentials, response pipelines.

**Trust assumptions (§9.3)**: provider payloads are untrusted; provider SDKs/
MCP/skills containing trading capability are OUTSIDE the trust boundary until
reduced to allowlisted read-only adapters with negative tests passing.

**Top threats**: SSRF (DNS rebinding, IPv6/IPv4 range evasion, percent-encoded
hosts, punycode, userinfo confusion), redirect-based escape, decompression
bombs, slow-loris streams, secret leakage into payload archives.

**Controls (this package)**: deny-by-default EgressGuard (per-plane
allowlists, raw-string host checks, unsafe-port table, resolution pinning +
rebinding detection, redirect approval chain, byte/time/decompression-ratio
response caps); OAuth binding guard (PKCE-required, exact redirect URIs,
audience/resource-indicator equality, no upstream token passthrough);
secrets policy keeping classified material out of archives.

**Automated suites**:

- `packages/security/test/egress.spec.ts`
- `tests/acceptance/AC-051.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-051.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-257.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-257.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 5. Collector (chain events, social text, websites, token metadata)

**Assets**: untrusted-content pipeline, extraction envelopes, render safety.

**Trust assumptions (§9.3)**: chain event messages, social text, websites,
and token metadata are untrusted end-to-end.

**Top threats**: prompt injection through fetched content, protected-role
insertion, malicious-Markdown (script tags, event handlers, dangerous URL
schemes, remote-image tracking, noopener-stripping links), label stripping
to launder provenance.

**Controls (this package)**: untrusted-content envelope with mandatory
provenance labels, structured-extraction envelope, protected-role refusal,
render-safety report (script/event-handler/URL-scheme/image/link policies),
domain-separated memory-isolation keys.

**Automated suites**:

- `packages/security/test/untrusted-content.spec.ts`
- `tests/acceptance/AC-258.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-258.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 6. Model boundary

**Assets**: model context partitions, prompt/response channels, claims of
public outputs.

**Trust assumptions (§9.3)**: model output is untrusted; secrets never enter
model context; marketing/public claims are policy-bound.

**Top threats**: secret material entering prompts, cross-tenant context
bleed, prohibited claims (guaranteed profit, risk-free, universal recall,
uncalibrated probability, unsupported performance) reaching public bodies,
detector-threshold and sensitive-entity leakage into publications.

**Controls (this package)**: `refuseSecretTowardModelContext` +
material-shape detectors; opaque tenant model-context partitions;
claims-policy evaluation across MARKETING/UI/API/EXPORT; public-output
envelope requiring evidence/timestamps/assumptions/limitations/disclaimer
with threshold+entity redaction before distribution.

**Automated suites**:

- `packages/security/test/secrets-claims.spec.ts`
- `tests/acceptance/AC-276.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-277.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-276.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-277.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 7. Database

**Assets**: `sec.*` tables, audit hash chain, quarantine state machines,
incident/pause ledgers.

**Trust assumptions (§9.3)**: only deterministic policy services authorize
lifecycle transitions; direct SQL tampering is out-of-trust and must be
detectable.

**Top threats**: row-level cross-tenant reads, audit mutation/deletion/
reordering, quarantine state fabrication (ACTIVE state), checkpoint/store
drift.

**Controls (this package)**: SQL immutability triggers + CHECK-constrained
state machines (no ACTIVE state exists); monotone typed transitions;
hash-chained audit with batch checkpoints mirrored to object store and an
independent verifier; fail-closed RowScope predicates + ownership
assertions; §35.9 AUDIT_HEALTH_BLOCKED coupling.

**Automated suites**:

- `packages/security/test/audit-chain.spec.ts`
- `packages/security/test/schema-parity.spec.ts`
- `packages/tenant-isolation/test/tenant-isolation.spec.ts`
- `tests/acceptance/AC-259.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-259.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 8. Object store (artifacts)

**Assets**: stored artifacts, signed URLs, checkpoint mirrors, imported
containers.

**Trust assumptions (§9.3)**: stored/imported artifacts are untrusted until
validated; production accepts only validated data artifacts.

**Top threats**: cross-tenant artifact fetch, signed-URL replay across
audiences/tenants, ranged-read exfiltration, redirect hops into foreign
tenants, path confusion (encoded slashes/dot segments/backslashes).

**Controls (this package)**: tenant-bound audience-bound expiring signed
URLs (HMAC over canonical claims); ResourceAccessGuard refusing
signed-URL/range/redirect/path-confusion bypass vectors without original
scope+rights; import-gate member-path traversal refusals BEFORE rows exist.

**Automated suites**:

- `packages/tenant-isolation/test/tenant-isolation.spec.ts`
- `packages/security/test/import-gating.spec.ts`
- `tests/acceptance/AC-252.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-252.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 9. Alpha Lab

**Assets**: read-only exports, imported research artifacts, producer trust
anchors.

**Trust assumptions (§9.3)**: Alpha Lab has read-only exports and NO
production credentials; production accepts only validated artifacts.

**Top threats**: export of raw credential classes, quarantine escape,
zip-bomb/decompression attacks, malicious scan verdicts ignored, validation
finalization without step-up, in-process parsing of hostile bytes.

**Controls (this package)**: import gating (format allowlist, count/size/
ratio limits, path hygiene), trusted-producer signature verification with
hash pinning, MALICIOUS auto-reject, monotone never-ACTIVE quarantine,
step-up-coupled finalization, isolated-parsing boundary contract,
secret-class export prohibition toward ALPHA_LAB.

**Automated suites**:

- `packages/security/test/import-gating.spec.ts`
- `packages/security/test/secrets-claims.spec.ts`
- `tests/acceptance/AC-052.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-052.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

### 10. Notifications

**Assets**: notification policy authority, recipient lists, delivery side
effects.

**Trust assumptions (§9.3)**: only deterministic policy services authorize
notifications; abuse responses must never disable protected deterministic
risk monitoring nor create automated external side effects outside policy
(INV-003).

**Top threats**: alert harvesting, flood-driven notification storms,
suspension of protected risk monitoring under abuse pressure, feedback
loops from market-manipulation content.

**Controls (this package)**: abuse controller with sliding-window flood
limits, expensive-query amplification caps, enumeration suspicion,
protected-subject set (risk-monitoring/audit-health/incident-response)
that can be DEGRADED but never suspended
(`SEC_ABUSE_PROTECTED_SUSPENSION_REFUSED`).

**Automated suites**:

- `packages/security/test/webhook-abuse.spec.ts`
- Notification delivery wiring suites **[deferred: notifications-package]**

### 11. Public distribution boundary

**Assets**: published analyses, redacted outputs, evidence envelopes.

**Trust assumptions (§9.3)**: public surfaces see ONLY validated,
policy-screened output; workspace/public rollout is separately authorized
per surface (ADR-057).

**Top threats**: prohibited claims shipping publicly, disclosure-duty omissions
(no evidence/timestamps/limitations/disclaimer), threshold/entity leakage,
cross-tenant reads through PUBLIC-mode rollout gaps, unscoped queries.

**Controls (this package)**: public-output envelope + redaction boundary
(REFUSED on missing duties, SENSITIVE_DETAIL_PRESENT on claim hits);
tenant-isolation primitives enforcing namespacing for all eleven surfaces
with isolation active except explicit PUBLIC; RowScope refusing unscoped
queries while isolation is active.

**Automated suites**:

- `packages/security/test/secrets-claims.spec.ts`
- `packages/tenant-isolation/test/tenant-isolation.spec.ts`
- `tests/acceptance/AC-275.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-275.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**

---

## Product-wide (applies to EVERY boundary)

**Controls (this package)**: prohibited-capability scanner CLI + runtime
canary over ONE shared declarative catalog (8 categories, read-only wallet
intelligence allowlist, inventory verbs, env-name forbidden lists);
decoder-authority validator; supply-chain pinning/lifecycle/SBOM/build-hash
policy; incident/pause/audit-health integration; typed fail-closed error
vocabulary (`SecErrorCode`).

**Automated suites**:

- `scripts/scan-prohibited-capabilities/cli.mjs` (CI gate)
- `packages/security/test/negative-capability.spec.ts`
- `tests/acceptance/AC-050.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-254.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-255.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/acceptance/AC-256.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-050.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-254.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-255.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
- `tests/negative/AC-256.negative.spec.ts` **[deferred: g0-security-perimeter Phase H]**
