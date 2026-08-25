# Adapter onboarding and verification checklist

The full definition → verification → activation path with every fail-closed
gate. Traces: FR-PROV-002 (verification TTLs), FR-PROV-004/FR-PROV-005
(registration + exact allowlists), FR-PROV-001 (lifecycle), AC-270/AC-272.
An adapter is consumable only when every gate below is green AT THE CURRENT
INSTANT — gates re-evaluate continuously; passing once is never durable.

## Stage 1 — Definition (registration-time refusals)

1. **No wholesale bundles.** `AdapterRegistrar.registerAdapter` refuses
   `WHOLESALE_BUNDLE` exposure outright
   (`PROV_ADAPTER_WHOLESALE_BUNDLE_REFUSED`). Individual operations only.
2. **Every operation carries an exact allowlist descriptor** — egress host,
   method GET, path template, query allowlist, response content types,
   response Zod schema, byte cap, redirect policy
   (`PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING` otherwise).
3. **Capability class from the §15.2 vocabulary, never PROHIBITED_\*.**
   `PROHIBITED_TRANSACTION_BUILD | _SIGN | _SUBMIT | _CUSTODY` refuse at
   registration (`PROV_CAPABILITY_CLASS_PROHIBITED`) and nothing persists.
4. **Mandatory §15.3 fields complete** (schemas, quota model, cache policy,
   timeout, independence group, lineage, cost class…). Invalid definitions
   refuse (`PROV_DEFINITION_INVALID`) before any row exists.
5. **Negative-capability floor merged in**: no-trading, no-custody,
   no-signing, no-private-key-handling, no-transaction-submission are
   registered with EVERY operation regardless of caller input.

## Stage 2 — Exact allowlist enforcement (per request, per response)

6. Requests match method/host/port/path-template EXACTLY; query params ⊆
   declared set (`PROV_ALLOWLIST_*` codes); egress IPs resolve inside the
   pinned public ranges (EgressGuard denies loopback/private/link-local,
   unsafe ports, punycode/percent-encoded hosts).
7. Responses: redirects NEVER followed; status 2xx; declared content type;
   byte cap enforced; body parses; Zod schema validates
   (`PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED` otherwise).

## Stage 3 — Verification evidence (fresh at use time)

8. Configure an explicit TTL per `(provider, kind)`
   (`VerificationTtlService.configureTtl`). Unconfigured kinds refuse —
   there is NO default TTL anywhere
   (`PROV_VERIFICATION_TTL_UNCONFIGURED`).
9. Record SUCCEEDED outcomes with non-empty evidence refs; expiry derives
   from the configured TTL at record time.
10. STRICT_FREE consumption additionally demands plan proof:
    COST_DISABLED / flag-ineligible operations refuse before any verifier
    lookup (`NOT_ELIGIBLE`, `PAID_ONLY`, `PLAN_UNPROVEN`).
11. Deprecated operations refuse NEW USE without a valid migration
    exception (`PROV_DEPRECATED_NEW_USE_BLOCKED`); the exception is checked
    AT USE TIME — lapsing re-blocks instantly. Sole-critical-source and
    sunset-incident rules evaluate against the same injected clock.
12. Decoder authority (transaction paths): raw/local decoding is the
    authority; deprecated parsers may hold FALLBACK authority only under
    acknowledged deprecation with local decoding enabled
    (`validateDecoderAuthority`).

## Stage 4 — Activation readiness (AC-272 aggregate)

13. `ReadinessEvaluator.evaluate` must return ELIGIBLE, which requires ALL of:
    - lifecycle state not DISCOVERED/BLOCKED/REMOVED;
    - DEPRECATED state covered by a currently valid exception;
    - rights declaration present with a window open at now;
    - every configured verification kind fresh for this exact version;
    - zero quarantined malicious-response rows for the operation.

## Stage 5 — In-service surveillance

14. `sweepExpiries()` walks ACTIVE operations × configured kinds; a lapsed
    kind exits ACTIVE through the lifecycle machine with `*_EXPIRED` reason
    classes and maps to PLAN_UNVERIFIED / RIGHTS_UNVERIFIED / DEGRADED.
15. Re-arm after lapse requires BOTH an OFFICIAL_DOC and a LIVE_CONTRACT
    success of the lapsed kind within TTL (the refresh-pair rule) — one
    source alone never re-arms.
16. Every malicious-response quarantine is audited (`BLOCKED_OPERATION`)
    and blocks readiness until cleared; quarantined bytes are structurally
    unpersistable and excluded from model context.

## Gate-to-code map

| Gate | Code | Error code |
|------|------|------------|
| Wholesale bundle refusal | AdapterRegistrar | `PROV_ADAPTER_WHOLESALE_BUNDLE_REFUSED` |
| Missing allowlist descriptor | AdapterRegistrar | `PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING` |
| Prohibited capability class | OperationRegistry/Registrar | `PROV_CAPABILITY_CLASS_PROHIBITED` |
| Request outside exact allowlist | AdapterContract | `PROV_ALLOWLIST_{METHOD,PATH,CONTENT_TYPE,REQUEST_FIELD}_REFUSED` |
| Egress policy denial | EgressGuard | `ADDRESS_DENIED` / `RESOLUTION_REFUSED` |
| Response schema/bytes/status | AdapterContract | `PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED` |
| Unconfigured TTL | VerificationTtlService | `PROV_VERIFICATION_TTL_UNCONFIGURED` |
| Expired/lapsed verification | VerificationTtlService | `PROV_VERIFICATION_EXPIRED` |
| Deprecated new use | DeprecationRules | `PROV_DEPRECATED_NEW_USE_BLOCKED` |
| Rights loosening w/o reverification | RightsMatrixService | `PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION` |
| Malicious response | ResponseQuarantineService | `PROV_MALICIOUS_RESPONSE_REJECTED` / `PROV_QUARANTINE_WRITE_THROUGH_REFUSED` |
| Readiness block | ReadinessEvaluator | typed reasons, verdict BLOCKED |
