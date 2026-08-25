# Rights-matrix register

Scope: declared §15.6 rights matrices per provider family, the semantics of
each field, and terms-version tracking rules. Governing requirement:
FR-PROV-009; acceptance: AC-273. The machine truth lives in
`prov.prov_rights_declarations`; this document is the human-facing register
of what is DECLARED, not a substitute for it.

## Field semantics (all sixteen are mandatory per version)

| # | Field | Governs | Fail-closed reading when `false` |
|---|-------|---------|----------------------------------|
| 1 | `commercialUseAllowed` | COMMERCIAL_USE | No commercial product surface may consume this operation's output. |
| 2 | `personalResearchAllowed` | PERSONAL_RESEARCH | Personal/research consumption is prohibited. |
| 3 | `cacheAllowed` | CACHE | No caching layer may retain responses; `maximumCacheDurationSeconds` MUST be NULL when false. |
| 4 | `maximumCacheDurationSeconds` | (bound on CACHE) | NULL with `cacheAllowed=true` is unrepresentable (DB CHECK). |
| 5 | `rawRetentionAllowed` | RAW_RETENTION_STORAGE | Raw response bytes may not be retained beyond processing. |
| 6 | `derivedFeaturesAllowed` | DERIVED_FEATURES | Features derived from this source may not feed downstream products. |
| 7 | `modelTrainingAllowed` | MODEL_TRAINING_USE | Output may never train any model. |
| 8 | `redistributionAllowed` | REDISTRIBUTION | Republishing raw or lightly-wrapped output is prohibited. |
| 9 | `publicAlertDerivativeAllowed` | PUBLIC_ALERT_DERIVATIVE | Public alert products may not derive from this source. |
| 10 | `attributionRequired` | (obligation) | When true, every derivative must carry the declared attribution string. |
| 11 | `userByokRequired` | (obligation) | When true, consumers must supply their own provider key; gateway keys are never shared. |
| 12 | `rawExportAllowed` | RAW_EXPORT | Bulk/raw export paths are prohibited. |
| 13 | `jurisdictionRestrictions` | (list) | Named jurisdictions must be excluded from consumption surfaces. |
| 14 | `termsVersion` | (provenance) | The exact provider-terms revision this declaration was verified against. |
| 15 | `verifiedAt` | (evidence) | When rights verification was performed. |
| 16 | `verificationExpiresAt` | (freshness) | Use-time decisions refuse once this instant passes, even when booleans are true. |

## Declared matrices per provider family

| Provider family | Family default posture | Terms tracked at | Notes |
|-----------------|------------------------|------------------|-------|
| Market-data aggregators (GMGN family) | Internal analytics only: caching short-TTL, no redistribution, no model training, no raw export | Per published ToS revision | Tightened historically around redistribution; see change ledger. |
| RPC/indexer providers (Helius family) | BYOK required; raw retention permitted for cache only; no model training | Per plan tier terms | Plan-tier changes trigger re-declaration (new rights version). |
| Social/news aggregators | Attribution required; public-alert derivatives allowed; no raw export | Per API terms | Jurisdiction restrictions commonly non-empty. |

New families declare an initial version before first ingestion; artifacts
capture that version AT INGESTION and keep it as their decision basis.

## Versioning and change tracking

- Versions advance monotonically per `(provider_id, operation_id)`; a new
  declaration NEVER edits history.
- Each version change records a durable row in `prov.prov_rights_changes`
  with the computed `newly_prohibited_uses` set (the tightening delta).
- Loosening — flipping a previously-prohibited path back to permitted —
  requires the NEW declaration to carry a verification window still open at
  the current instant (`PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION`
  otherwise). Terms-version changes alone never loosen.
- Every change is attested in the security audit chain as `RIGHTS_CHANGE`.

## Terms-version tracking rules

1. A declaration without an exact `termsVersion` string is invalid.
2. Re-verification against the SAME terms version refreshes the window but
   does not create a new version unless any boolean changed.
3. A provider-terms revision observed upstream triggers re-declaration even
   if all sixteen fields evaluate identically — the terms provenance must
   stay exact.
4. Expired windows block readiness (AC-272 `RIGHTS_UNVERIFIED`) and use-time
   decisions (`VERIFICATION_EXPIRED`) regardless of boolean values.
