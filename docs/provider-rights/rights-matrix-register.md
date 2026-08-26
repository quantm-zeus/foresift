# Provider rights-matrix register (FR-PROV-009; §15.6)

Status: **authoritative register** for the G0 provider-rights matrix. The
executable truth lives in the `prov.prov_rights_declarations` /
`prov.prov_rights_changes` tables and is enforced by
`@foresift/provider-lifecycle`'s `RightsMatrix`; this document is the
human-auditable index of what has been declared, why, and how it maps to
enforcement. Where this document and the database disagree, the database wins
and this document must be corrected in the same change.

## Scope

Every provider operation that stores, caches, exports, redistributes, or
derives features from provider responses MUST have a current rights
declaration before any use path touches stored material. Absence of a
declaration is fail-closed: `decideUse` refuses with
`PROV_RIGHTS_VERSION_UNKNOWN`, and activation readiness blocks with the same
reason code.

## The sixteen declaration fields

| # | Field | Enforcement |
|---|-------|-------------|
| 1 | `commercialUseAllowed` | recorded; gates commercial feature surfaces upstream |
| 2 | `personalResearchAllowed` | recorded |
| 3 | `cacheAllowed` | CACHE use path; when true, `maximumCacheDuration` MUST parse as a duration |
| 4 | `maximumCacheDuration` | required iff `cacheAllowed` (SQL CHECK); returned on allowed CACHE decisions |
| 5 | `rawRetentionAllowed` | RAW_RETENTION + STORAGE use paths |
| 6 | `derivedFeaturesAllowed` | DERIVED_FEATURES use path |
| 7 | `modelTrainingAllowed` | MODEL_USE use path — permanently false for providers that forbid it; never loosened silently |
| 8 | `redistributionAllowed` | REDISTRIBUTION use path |
| 9 | `publicAlertDerivativeAllowed` | recorded; alert-surface gating |
| 10 | `attributionRequired` | recorded; surfaced wherever outputs are presented |
| 11 | `userByokRequired` | recorded; BYOK enforcement upstream |
| 12 | `rawExportAllowed` | EXPORT use path |
| 13 | `jurisdictionRestrictions` | array; forwarded to deployment policy |
| 14 | `termsVersion` | human-auditable terms reference |
| 15 | `verifiedAt` | start of the verification window; window must be non-inverted |
| 16 | `verificationExpiresAt` | expiry; live decisions past expiry refuse with `PROV_RIGHTS_VERIFICATION_EXPIRED` |

### Use-path mapping

| Use path | Decided by field(s) |
|----------|---------------------|
| `CACHE` | `cacheAllowed` (+ maximum duration) |
| `RAW_RETENTION` | `rawRetentionAllowed` |
| `STORAGE` | `rawRetentionAllowed` |
| `EXPORT` | `rawExportAllowed` |
| `REDISTRIBUTION` | `redistributionAllowed` |
| `MODEL_USE` | `modelTrainingAllowed` |
| `DERIVED_FEATURES` | `derivedFeaturesAllowed` |

## Captured-material semantics (material decision, G0)

Stored material is bound to the rights version captured at collection time:

1. Live decisions evaluate against the CURRENT declaration and fail closed on
   absence or expiry.
2. Decisions over STORED artifacts evaluate against the artifact's
   `rightsVersionAtCapture`. Any tightening recorded AFTER capture keeps a
   use path refused for that material forever, even if a later version
   loosens the field again.
3. The ONLY way to restore a bound artifact is explicit registry reactivation:
   fresh verification evidence plus a current RIGHTS PASS for the operation
   (`PROV_RIGHTS_REACTIVATION_REVERIFICATION_REQUIRED` otherwise).
4. New captures under a looser later version proceed normally.

## G0 reference declarations

| Provider | Operation(s) | Rights version | Notable fields |
|----------|--------------|----------------|----------------|
| gmgn | all query-only operations (`get-token-price`, `get-token-overview`, `get-trending-pools`, `get-address-activity`) | `gmgn-terms-2026-06-v1` | cache 300 s; raw retention false; export false; model training false; attribution required |
| helius | raw/history reads (`get-raw-transaction`, `get-transaction-history`, `get-address-balances`) | `helius-terms-2026-03-v2` | cache 60 s; raw retention true (internal analysis only); export false; redistribution false; model training false |
| helius | enhanced-parser surface (`get-parsed-transactions`) | `helius-terms-2026-03-v2` | vendor-derived material: derived features false; everything else mirrors the raw-read row |

These rows are seeded by the acceptance suites (AC-273) from fixture data;
production declarations are recorded through the same `RightsMatrix.declare`
path, never by direct SQL.

## Change protocol

Rights changes are material events. See
[rights-change-runbook.md](./rights-change-runbook.md) for the operator
procedure; onboarding of new providers, including the verification evidence
each declaration requires, lives in
[adapter-onboarding-and-verification.md](./adapter-onboarding-and-verification.md).
