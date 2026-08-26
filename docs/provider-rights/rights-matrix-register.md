# Rights matrix register

Implements FR-PROV-009 / §15.6. This register is the human-readable companion
to the machine truth in `prov.prov_rights_declarations`: every provider family
onboarded into Foresift carries a versioned sixteen-field rights declaration,
and every use of captured provider material is decided against THAT row —
never against prose. When this document and a declaration row disagree, the
row wins and this document must be corrected additively.

## Field semantics (the sixteen §15.6 fields)

| #   | Field                             | Semantics when `true`                                                                           |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `commercial_use_allowed`          | Derived outputs may be used in commercially exposed features.                                   |
| 2   | `personal_research_allowed`       | Material may feed personal-research surfaces (weaker commercial clearance does not imply this). |
| 3   | `cache_allowed`                   | Responses may be cached at all.                                                                 |
| 4   | `maximum_cache_duration_seconds`  | Upper bound on cache retention (≥ 0); applies whenever caching is allowed.                      |
| 5   | `raw_retention_allowed`           | Raw response bodies may be STORED beyond transient processing. Gates the STORAGE use path.      |
| 6   | `derived_features_allowed`        | Aggregates/features may be DERIVED from the material. Gates DERIVED_USE.                        |
| 7   | `model_training_allowed`          | Material or derivatives may be used for model training. Gates MODEL_TRAINING.                   |
| 8   | `redistribution_allowed`          | Material may leave the system boundary toward end consumers. Gates REDISTRIBUTION.              |
| 9   | `public_alert_derivative_allowed` | Alert derivatives may be published. Gates PUBLIC_ALERT.                                         |
| 10  | `attribution_required`            | Attribution MUST accompany permitted uses when true.                                            |
| 11  | `user_byok_required`              | Consumers must supply their own upstream credentials for direct access patterns when true.      |
| 12  | `raw_export_allowed`              | Raw material may be EXPORTED at user request. Gates the EXPORT path.                            |
| 13  | `jurisdiction_restrictions`       | Array of jurisdictions where use is restricted (expansion is a tightening).                     |
| 14  | `terms_version`                   | Vendor terms identifier this declaration interprets (`terms@N`).                                |
| 15  | `verified_at`                     | Instant the declaration was verified against the vendor's current terms.                        |
| 16  | `verification_expires_at`         | Declaration window end; STRICTLY after `verified_at`. A lapsed window fails closed.             |

## Use-path gate mapping

The seven decision paths (`RIGHTS_USE_PATHS`) resolve to declaring fields:

| Use path         | Gating field                      |
| ---------------- | --------------------------------- |
| `STORAGE`        | `raw_retention_allowed`           |
| `DERIVED_USE`    | `derived_features_allowed`        |
| `REDISTRIBUTION` | `redistribution_allowed`          |
| `CACHING`        | `cache_allowed`                   |
| `EXPORT`         | `raw_export_allowed`              |
| `MODEL_TRAINING` | `model_training_allowed`          |
| `PUBLIC_ALERT`   | `public_alert_derivative_allowed` |

A tightening is ANY true→false flip on these gates, plus a shortened cache
window, plus jurisdiction expansion, plus commercial/personal-research
revocation. Tightenings are audited (`BLOCKED_OPERATION`, kind
`RIGHTS_CHANGE`).

## Declared baseline matrices per provider family

Baseline declarations recorded at onboarding (v1). Later versions live only
in the declaration table; update this register additively when baselines
move, referencing the change ids.

| Provider family                  | Storage | Derived | Redistr. | Caching (max s) | Export | Model training | Public alert | Terms            | Window       |
| -------------------------------- | ------- | ------- | -------- | --------------- | ------ | -------------- | ------------ | ---------------- | ------------ |
| GMGN (query-only market intel)   | ✓       | ✓       | ✗        | ✓ (86 400)      | ✗      | ✗              | ✓            | `terms@gmgn-1`   | standard TTL |
| Helius (Solana RPC / data plane) | ✓       | ✓       | ✗        | ✓ (86 400)      | ✗      | ✗              | ✓            | `terms@helius-1` | standard TTL |

Conservative defaults by design: redistribution, raw export, and model
training start CLOSED for every family until the vendor's terms explicitly
clear them. BYOK is not required at baseline; attribution follows vendor terms
per family.

## Terms-version tracking

- Every declaration pins the `terms_version` it interprets. A vendor terms
  bump REQUIRES a new verified declaration version (never an in-place edit);
  declaration rows are immutable and uniquely fenced per
  `(provider, operation, rights_version)`.
- Verification windows bind to the FR-PROV-002 TTL engine: a declaration whose
  `verification_expires_at` has lapsed refuses ALL paths (fail-closed) until
  re-verified.
- Loosening a right NEVER reactivates previously quarantined or retired
  artifacts; re-capture under the loosened version is the only road back
  (`PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION` guards divergent replays).
