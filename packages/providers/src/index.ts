// Package entrypoint — audited read-only provider adapters (FR-PROV-004…007).
// Injectable transport seam, exact per-adapter allowlist descriptors enforced
// by composing the security EgressGuard with an adapter-level request/response
// validation layer, adapter registration refusing prohibited capability
// classes and wholesale bundle exposure, and the reference operation catalogs:
// GMGN strictly query-only (FR-PROV-006) and Helius raw/history operations
// with LOCAL supported-program decoding (FR-PROV-007).
export * from './errors.ts';
export * from './fetch-port.ts';
export * from './adapter-contract.ts';
export * from './registration.ts';
export * from './helius-decoding.ts';
export * from './operation-catalogs/gmgn.catalog.ts';
export * from './operation-catalogs/helius.catalog.ts';
export * from './adapters/gmgn-adapter.ts';
export * from './adapters/helius-adapter.ts';
