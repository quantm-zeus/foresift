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
