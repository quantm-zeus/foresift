# Adapter onboarding and verification (FR-PROV-004…007)

How a new provider adapter enters the system. The boundary is
`registerAdapter` in `@foresift/providers`; anything that cannot pass it
cannot exist in the product.

## 1. Write the descriptor

An adapter is a declarative `ProviderAdapterDescriptor`: no methods, no I/O.
Per operation you MUST declare:

- exactly ONE capability class (any attempt to claim additional classes is a
  wholesale bundle and is refused with `PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED`);
  prohibited §15.2 classes are unrepresentable;
- the exact egress dimensions — https host(s) + port(s) on the COLLECTOR
  plane. An operation without this allowlist descriptor is refused
  (`PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING`);
- the declared query-parameter names (deny-by-default: an undeclared
  parameter refuses the request before any egress);
- expected response content types and a byte ceiling;
- the full §15.3 definition fields (schemas, quota model, independence group,
  license policy, verification horizon).

## 2. Transport rules (non-negotiable)

All reads move through `EgressFetchPort`, which composes the security
`EgressGuard` per hop:

1. `authorize(url, plane)` — exact allowlist match, DNS resolution pinned,
   denied ranges refused (`PROV_DNS_POLICY_REFUSED` /
   `PROV_ALLOWLIST_DIMENSION_UNDECLARED`);
2. `verifyPin(url, pinnedAddresses)` — re-verified immediately before the
   transport call;
3. redirects are re-decided through `authorizeRedirect`; the default approval
   policy never leaves the origin host, and refusals surface as
   `PROV_REDIRECT_POLICY_REFUSED`;
4. responses are checked against the declared content types and byte ceiling.

The port is GET-only BY CONSTRUCTION — there is no method field and no body.
Adapters never see sockets; tests inject stub transports.

## 3. Decoding authority

If a provider ships its own parser/decoder (the Helius case), the LOCAL
decoder over raw-operation payloads is the authoritative path. A vendor
parser may run only as a DEPRECATED FALLBACK with:

- `rawOperationLocalDecodingEnabled: true`;
- an explicit entry in `acknowledgedDeprecations`.

The configuration is proven against `validateDecoderAuthority` in both
directions (see `packages/providers/test/helius-decoding.spec.ts`). Any test
or config that promotes a deprecated parser to SOLE/PRIMARY authority must
fail.

## 4. Verification evidence (per operation)

Before an operation may serve ACTIVE decisions, record refresh PAIRS for
every decision-critical verification kind (see `DECISION_CRITICAL_VERIFICATION_KINDS`
in `@foresift/provider-lifecycle`) inside the configured TTLs:

| Kind class | Evidence |
|------------|----------|
| Schema/raw-output conformance | recorded raw-response fixture + schema id match |
| Rights declaration | signed terms snapshot + `RightsMatrix.declare` row |
| Quota/cost model | provider quota documentation snapshot |
| Plan availability | plan matrix snapshot (plan-gated ops are STRICT_FREE-disabled) |

Expiry is not advisory: the TTL sweep exits operations to the mapped health
statuses and readiness blocks activation until pairs are refreshed.

## 5. Registration checklist

```ts
const result = await registerAdapter(registry, descriptor);
// → registers provider + every operation, each carrying negativeCapabilities
//   covering all four PROHIBITED_* classes.
```

Then, in order:

1. configure verification TTLs (`configureTtl`) per kind;
2. declare rights (`RightsMatrix.declare`) and update
   `rights-matrix-register.md`;
3. prove readiness (`ReadinessEvaluator.evaluate` → ELIGIBLE) before
   transitioning DISCOVERED → VERIFIED → ACTIVE on the lifecycle machine.

## 6. Prohibited-content posture

Provider responses are scanned by the quarantine detector before any use.
Fixtures used in tests live under `tests/fixtures/prov/` and are inert by
construction — see that directory's README for the corpus contract.
