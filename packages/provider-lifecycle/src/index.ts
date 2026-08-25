// Package entrypoint — provider operation lifecycle truth (FR-PROV-001…010).
// The truth and policy engine: versioned operation registry, seven-state
// lifecycle machine over an append-only transition ledger, verification-TTL
// enforcement that fails closed, deprecation/migration-exception rules,
// response quarantine, rights-change handling, source fingerprints, and
// activation-readiness evaluation. No transport code and no vendor knowledge
// live here — concrete adapters belong to @foresift/providers.
export * from './errors.ts';
export * from './schemas.ts';
export * from './lifecycle-states.ts';
export * from './audit-bridges.ts';
export * from './lifecycle-machine.ts';
export * from './operation-registry.ts';
export * from './verification-ttl.ts';
export * from './deprecation-rules.ts';
export * from './migration-exceptions.ts';
export * from './response-quarantine.ts';
export * from './rights-matrix.ts';
export * from './artifact-registry.ts';
export * from './source-fingerprints.ts';
export * from './readiness.ts';
