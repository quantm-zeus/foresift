# Adapter onboarding and verification checklist

The definition → verification → activation path for a provider adapter, with
EVERY fail-closed gate on the way. Machine truth: `OperationRegistry`,
`LifecycleMachine`, `VerificationTtlEngine`, `DeprecationRules`,
`MigrationExceptions` (FR-PROV-001…004), `AdapterRegistrar` + exact
allowlists (FR-PROV-005), `ReadinessEvaluator` (AC-272). A gate that cannot
be satisfied STOPS onboarding — no waivers, no grace windows.

## Stage 1 — Definition (registration-time gates)

1. **Provider row** — register the provider (`provider_id`, display name,
   group). Duplicate ids refuse with `PROV_PROVIDER_ALREADY_REGISTERED`.
2. **Capability class** — must be in the ALLOWED vocabulary
   (`READ_MARKET`, `READ_SECURITY`, …). Prohibited classes (signing, submit,
   custody, transaction build) refuse with `PROV_CAPABILITY_CLASS_PROHIBITED`;
   unknown classes refuse with `PROV_CAPABILITY_CLASS_UNKNOWN`. The read-only
   product boundary is PERMANENT — there is no registration path for write
   capability.
3. **Negative capabilities** — mandatory metadata; the registry completes the
   prohibited alphabet on every row automatically.
4. **Definition schema** — full §15.3 definition validates strictly; failures
   refuse with `PROV_DEFINITION_SCHEMA_INVALID`. Unverified registrations
   carry an honest elapsed verification window (fail-closed by default).
5. **Dependencies** — NEW dependencies on DEPRECATED operations refuse
   (§15.4 rule 1) unless a valid migration exception exists;
   `PROV_DEPRECATED_DEPENDENCY_BLOCKED`.
6. **Adapter manifest** — every exposed operation carries an exact allowlist
   descriptor (host/port/scheme/path/method/content-types/query/request
   fields/redirect policy/max bytes/response schema id); missing descriptors
   refuse (`PROV_ADAPTER_ALLOWLIST_REQUIRED`). Wholesale multi-operation
   bundle exposure refuses. Registration derives one egress allowlist entry
   per descriptor pinned to the collector plane.

## Stage 2 — Verification (FR-PROV-002 / AC-270)

7. **TTL configuration** — configure per-kind TTLs BEFORE first use; an
   unconfigured kind refuses fail-closed
   (`PROV_VERIFICATION_TTL_UNCONFIGURED`). Per-provider overrides win over
   global defaults.
8. **Refresh pair rule** — active DECISION USE of a kind requires BOTH
   `OFFICIAL_DOC` AND `LIVE_CONTRACT` verification records fresh. One fresh
   source is not enough (`PROV_VERIFICATION_REFRESH_INCOMPLETE`).
9. **Expiry sweep** — the TTL engine sweeps lapsed ACTIVE operations to
   `DEGRADED` with §15.4 health mapping, effective at the LAPSED instant so
   repeated sweeps dedupe. Ledger evidence is never mutated by expiry.
10. **Rights declaration** — record the sixteen-field rights matrix v1
    (see `rights-matrix-register.md`) before activation; a lapsed or missing
    declaration fails closed.

## Stage 3 — Activation

11. **Lifecycle walk** — DISCOVERED → VERIFIED → ACTIVE through guarded
    transitions only (seven-state graph; illegal edges refuse). Every append
    emits an audit entry; BLOCKED exits use `BLOCKED_OPERATION`.
12. **Readiness evaluation (AC-272)** — before workspace/public gating,
    require `ELIGIBLE` from `ReadinessEvaluator`: lifecycle ACTIVE, complete
    negative-capability exposure, AC-270 pair freshness per configured kind,
    admissible current rights declaration, and (if DEPRECATED) a valid
    migration exception. ANY failure yields typed BLOCKED reasons — the
    evaluator aggregates instead of throwing, so a partial failure never
    hides behind another.
13. **Deprecation handling** — deprecation notices exit to terminal states
    with affected-feature blast radius from registry dependencies; running
    deprecated decoders requires acknowledged deprecations + local raw
    decoding (decoder-authority rules); migration exceptions are time-boxed
    and expire WITHOUT grace (`PROV_MIGRATION_EXCEPTION_EXPIRED`).

## Standing constraints (all stages)

- Responses pass malicious-content scanning; hazardous material is rejected,
  quarantined, audited metadata-only, and HARD-EXCLUDED from model context
  (AC-271) before any envelope can carry it.
- Source fingerprints accumulate per operation version as behavioral
  provenance (FR-PROV-010); drift appends evidence, it never overwrites.
- The product remains read-only FOREVER: trading execution, custody, wallet
  signing, private-key handling, and transaction submission are prohibited at
  registration, at egress, at response scanning, and at readiness — no stage
  can grant them back.
