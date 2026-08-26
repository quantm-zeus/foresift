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
// Modules are exported here as they land; the scaffold shipped empty by
// design so the milestone verification command runs from day one.
export * from './errors.ts';
export * from './vocabulary.ts';
export * from './lifecycle-states.ts';
export * from './operation-registry.ts';
export * from './audit-bridges.ts';
export * from './lifecycle-machine.ts';
export * from './verification-ttl.ts';
export * from './deprecation-rules.ts';
export * from './migration-exceptions.ts';
export * from './response-quarantine.ts';
export * from './rights-matrix.ts';
export * from './artifact-registry.ts';
export * from './source-fingerprints.ts';
export * from './readiness.ts';
export {
  prov,
  provProviders,
  provOperations,
  provOperationDependencies,
  provLifecycleEvents,
  provVerificationTtlConfigs,
  provVerificationRecords,
  provMigrationExceptions,
  provResponseQuarantine,
  provRightsDeclarations,
  provRightsChanges,
  provProviderArtifacts,
  provRightsChangeActions,
  provSourceFingerprints,
} from './generated/schema.ts';
