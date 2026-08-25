// Package entrypoint — provider operation lifecycle truth (FR-PROV-001…010).
// The truth and policy engine: versioned operation registry, seven-state
// lifecycle machine over an append-only transition ledger, verification-TTL
// enforcement that fails closed, deprecation/migration-exception rules,
// response quarantine, rights-matrix change engine with fail-closed use
// decisions, source fingerprints, and the AC-272 readiness evaluator.
// This package holds NO transport code and NO vendor knowledge; adapters live
// in @foresift/providers, which composes these decisions with the security
// perimeter.
//
// Modules are exported here as they land (T105+); the scaffold ships empty
// by design so the milestone verification command runs from day one.
export {};
