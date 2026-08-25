// Package entrypoint — audited read-only provider adapters (FR-PROV-004…008).
// Injectable transport seam, exact per-adapter allowlist descriptors enforced
// by composing the security EgressGuard with an adapter-level request/response
// validation layer, adapter registration refusing prohibited capability
// classes and wholesale bundle exposure, and the reference operation catalogs:
// GMGN strictly query-only (FR-PROV-006) and Helius raw/history operations
// with LOCAL supported-program decoding (FR-PROV-007).
//
// Modules are exported here as they land (T114+); the scaffold ships empty
// by design so the milestone verification command runs from day one.
export {};
