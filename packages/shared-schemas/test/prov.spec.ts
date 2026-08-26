/**
 * Accept/refuse matrices for the provider lifecycle schema family (FR-PROV-001…010
 * manifest schemaRefs). Every `.strict()` object must refuse unknown keys —
 * fail-closed extends to record shape.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_PROVIDER_HEALTH_STATUSES,
  ALL_PROVIDER_LIFECYCLE_STATES,
  ALL_PROVIDER_VERIFICATION_KINDS,
  ALL_RESPONSE_QUARANTINE_CLASSES,
  ALL_RIGHTS_USE_KINDS,
  ALL_SOURCE_FINGERPRINT_KINDS,
  BatchCapabilitySchema,
  isLegalLifecycleTransition,
  isProhibitedCapabilityClass,
  LEGAL_LIFECYCLE_TRANSITIONS,
  OperationConsumerKindSchema,
  parseProvSchema,
  PROHIBITED_PROVIDER_CAPABILITY_CLASSES,
  PROV_SCHEMAS,
  ProviderArtifactRecordSchema,
  ProviderArtifactStateSchema,
  ProviderCapabilityClassSchema,
  ProviderCostClassSchema,
  ProviderDependenceStateSchema,
  ProviderHealthStatusSchema,
  ProviderLifecycleEventSchema,
  ProviderLifecycleReasonClassSchema,
  ProviderLifecycleStateSchema,
  ProviderMigrationExceptionSchema,
  ProviderOperationDefinitionSchema,
  ProviderOperationDependencySchema,
  ProviderOperationRecordSchema,
  ProviderReadinessDecisionSchema,
  ProviderReadinessStatusSchema,
  ProviderRightsChangeActionSchema,
  ProviderRightsChangeSchema,
  ProviderRightsMatrixSchema,
  ProviderTtlConfigSchema,
  ProviderVerificationKindSchema,
  ProviderVerificationRecordSchema,
  ResponseQuarantineClassSchema,
  ResponseQuarantineFindingSchema,
  RightsChangeActionTypeSchema,
  RightsUseKindSchema,
  SourceFingerprintKindSchema,
  SourceFingerprintRecordSchema,
  SupportedProgramSchema,
  VerificationOutcomeSchema,
  VerificationSourceSchema,
  type ProvSchemaName,
} from '../src/prov.ts';

const HASH = `sha256:${'ab'.repeat(32)}`;
const at = (s: string) => s;

// --- Sample Fixtures for Every Schema ---------------------------------------

const lifecycleEventFixture = {
  eventId: 'evt-1',
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  operationVersion: 'v1',
  fromState: 'DISCOVERED' as const,
  toState: 'VERIFIED' as const,
  reasonClass: 'VERIFICATION_PASSED' as const,
  reasonDetail: 'Official documentation and smoke test verified',
  actor: 'system:verification-worker',
  occurredAt: at('2026-08-01T00:00:00Z'),
  evidenceRefs: ['evidence:doc:helius-v1', 'evidence:probe:helius-v1'],
  idempotencyKey: 'idem:helius:v1:discovered-verified',
};

const operationDefinitionFixture = {
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  version: 'v1',
  capabilityClass: 'READ_TRANSACTION_RAW' as const,
  supportedChains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  supportedPrograms: [
    { programId: 'Vote111111111111111111111111111111111111111', versions: ['v1'] },
  ],
  inputSchemaId: 'schema:input:helius:get-raw-transaction:v1',
  rawOutputSchemaId: 'schema:raw:helius:get-raw-transaction:v1',
  normalizedOutputSchemaId: 'schema:norm:helius:get-raw-transaction:v1',
  quotaModelId: 'quota:helius:credits',
  cachePolicyId: 'cache:short:30s',
  timeoutMs: 5000,
  retryPolicyId: 'retry:standard',
  declaredIndependenceGroup: 'helius-direct',
  upstreamLineage: ['solana-validator-rpc'],
  licensePolicyId: 'license:helius:developer',
  healthStatus: 'HEALTHY' as const,
  costClass: 'FREE_QUOTA' as const,
  estimatedQuotaUnits: 1,
  quotaResetPolicyId: 'reset:monthly:utc',
  batchCapability: { maxEntities: 100, maxBytes: 1048576 },
  minimumCandidateStage: 'DISCOVERY',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  paidFallbackAllowed: false,
  deprecatedAt: null,
  sunsetAt: null,
  replacementOperationId: null,
  verificationExpiresAt: at('2026-09-01T00:00:00Z'),
  forbiddenOutputFields: ['transactionPayload', 'signingRequest'],
  negativeCapabilities: ['NO_TRADING', 'NO_SIGNING', 'NO_WALLET'],
};

const operationRecordFixture = {
  ...operationDefinitionFixture,
  currentState: 'ACTIVE' as const,
  lastDocumentationVerifiedAt: at('2026-08-01T00:00:00Z'),
  lastLiveProbeAt: at('2026-08-01T00:00:00Z'),
  createdAt: at('2026-07-01T00:00:00Z'),
  updatedAt: at('2026-08-01T00:00:00Z'),
};

const operationDependencyFixture = {
  dependencyId: 'dep-1',
  consumerKind: 'FEATURE' as const,
  consumerKey: 'feature:token-transfers',
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  operationVersion: 'v1',
  active: true,
  registeredAt: at('2026-08-01T00:00:00Z'),
};

const verificationRecordFixture = {
  recordId: 'vr-1',
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  operationVersion: 'v1',
  kind: 'DOCUMENTATION' as const,
  source: 'OFFICIAL_DOC' as const,
  outcome: 'PASSED' as const,
  verifiedAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-08-15T00:00:00Z'),
  evidenceRefs: ['doc:helius:dev-portal:2026-08-01'],
  details: 'Documentation endpoint schemas match live payload',
};

const ttlConfigFixture = {
  configId: 'ttl-1',
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  kind: 'DOCUMENTATION' as const,
  ttlSeconds: 86400 * 14,
  configuredAt: at('2026-08-01T00:00:00Z'),
  updatedAt: null,
};

const migrationExceptionFixture = {
  exceptionId: 'me-1',
  providerId: 'helius',
  operationId: 'enhanced-parser-v0',
  operationVersion: 'v0',
  approver: 'lead-architect@foresift.io',
  replacementPlanRef: 'plan:helius-raw-migration-2026',
  replacementOperationId: 'get-raw-transaction',
  reason: 'Transitional non-authoritative supporting evidence during migration',
  createdAt: at('2026-08-01T00:00:00Z'),
  exceptionExpiresAt: at('2026-09-01T00:00:00Z'),
  revokedAt: null,
};

const quarantineFindingFixture = {
  findingId: 'qf-1',
  providerId: 'untrusted-source',
  operationId: 'custom-quote',
  operationVersion: 'v1',
  detectedClasses: ['TRANSACTION_PAYLOAD' as const, 'SIGNING_REQUEST' as const],
  fieldPaths: ['response.result.transaction', 'response.result.signData'],
  payloadSha256: HASH,
  byteSize: 2048,
  disposition: 'REJECTED' as const,
  auditReference: 'audit:event:quarantine:qf-1',
  modelContextExclusion: 'ENFORCED' as const,
  quarantinedAt: at('2026-08-01T00:00:00Z'),
  details: 'Payload contained binary transaction bytes and signing request structure',
};

const rightsMatrixFixture = {
  matrixId: 'rm-1',
  providerId: 'gmgn',
  operationId: 'query-token-info',
  rightsVersion: 'v1',
  commercialUseAllowed: true,
  personalResearchAllowed: true,
  cacheAllowed: true,
  maximumCacheDurationSeconds: 3600,
  rawRetentionAllowed: true,
  derivedFeaturesAllowed: true,
  modelTrainingAllowed: false,
  redistributionAllowed: false,
  publicAlertDerivativeAllowed: true,
  attributionRequired: true,
  userByokRequired: false,
  rawExportAllowed: false,
  jurisdictionRestrictions: ['OFAC_SANCTIONED'],
  termsVersion: 'gmgn-terms-2026-01',
  verifiedAt: at('2026-08-01T00:00:00Z'),
  verificationExpiresAt: at('2026-11-01T00:00:00Z'),
};

const rightsChangeFixture = {
  changeId: 'rc-1',
  providerId: 'gmgn',
  operationId: 'query-token-info',
  fromRightsVersion: 'v1',
  toRightsVersion: 'v2',
  newlyProhibitedUses: ['REDISTRIBUTION' as const, 'MODEL_TRAINING' as const],
  changedAt: at('2026-08-05T00:00:00Z'),
  reason: 'Upstream terms update revoked redistribution and training licenses',
};

const artifactRecordFixture = {
  artifactId: 'art-1',
  objectRef: 'obj://provider-artifacts/gmgn/query-token-info/art-1.json',
  providerId: 'gmgn',
  operationId: 'query-token-info',
  operationVersion: 'v1',
  rightsVersion: 'v1',
  state: 'ACTIVE' as const,
  capturedAt: at('2026-08-02T00:00:00Z'),
  updatedAt: at('2026-08-02T00:00:00Z'),
};

const rightsChangeActionFixture = {
  actionId: 'rca-1',
  changeId: 'rc-1',
  artifactId: 'art-1',
  actionType: 'QUARANTINE' as const,
  executedAt: at('2026-08-05T00:01:00Z'),
  details: 'Quarantined due to revocation of redistribution rights in version v2',
};

const sourceFingerprintFixture = {
  fingerprintId: 'fp-1',
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  operationVersion: 'v1',
  fingerprintKind: 'UPSTREAM_LINEAGE' as const,
  fingerprintPayload: {
    originNode: 'solana-validator',
    sharedUpstreamKeys: ['validator-mainnet-beta'],
    lagMs: 120,
  },
  payloadSha256: HASH,
  computedAt: at('2026-08-01T00:00:00Z'),
  estimatorInputRefs: ['obs:timing:1', 'obs:timing:2'],
};

const readinessStatusFixture = {
  readiness: 'ELIGIBLE' as const,
  providerId: 'helius',
  operationId: 'get-raw-transaction',
  operationVersion: 'v1',
  evaluatedAt: at('2026-08-01T00:00:00Z'),
  blockers: [],
  reason: 'All rights, verifications, and capabilities pass',
};

const FIXTURE_MAP: Record<ProvSchemaName, Record<string, unknown>> = {
  ProviderLifecycleEvent: lifecycleEventFixture,
  ProviderOperationDefinition: operationDefinitionFixture,
  ProviderOperationRecord: operationRecordFixture,
  ProviderOperationDependency: operationDependencyFixture,
  ProviderVerificationRecord: verificationRecordFixture,
  ProviderTtlConfig: ttlConfigFixture,
  ProviderMigrationException: migrationExceptionFixture,
  ResponseQuarantineFinding: quarantineFindingFixture,
  ProviderRightsMatrix: rightsMatrixFixture,
  ProviderRightsChange: rightsChangeFixture,
  ProviderArtifactRecord: artifactRecordFixture,
  ProviderRightsChangeAction: rightsChangeActionFixture,
  SourceFingerprintRecord: sourceFingerprintFixture,
  ProviderReadinessStatus: readinessStatusFixture,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PROV schema family — registry and entrypoints', () => {
  it('exposes every declared provider schema by name in PROV_SCHEMAS', () => {
    const names = Object.keys(PROV_SCHEMAS);
    expect(names.length).toBeGreaterThanOrEqual(14);
    expect(names).toContain('ProviderLifecycleEvent');
    expect(names).toContain('ProviderOperationDefinition');
    expect(names).toContain('ProviderOperationRecord');
    expect(names).toContain('ProviderOperationDependency');
    expect(names).toContain('ProviderVerificationRecord');
    expect(names).toContain('ProviderTtlConfig');
    expect(names).toContain('ProviderMigrationException');
    expect(names).toContain('ResponseQuarantineFinding');
    expect(names).toContain('ProviderRightsMatrix');
    expect(names).toContain('ProviderRightsChange');
    expect(names).toContain('ProviderArtifactRecord');
    expect(names).toContain('ProviderRightsChangeAction');
    expect(names).toContain('SourceFingerprintRecord');
    expect(names).toContain('ProviderReadinessStatus');
  });

  it.each(Object.keys(PROV_SCHEMAS) as ProvSchemaName[])(
    'parseProvSchema(%s) parses valid fixture successfully',
    (name) => {
      const fixture = FIXTURE_MAP[name];
      expect(parseProvSchema(name, fixture)).toBeDefined();
    },
  );

  it.each(Object.keys(PROV_SCHEMAS) as ProvSchemaName[])(
    'parseProvSchema(%s) throws on garbage payload',
    (name) => {
      expect(() => parseProvSchema(name, { obviously: 'invalid' })).toThrow();
    },
  );

  it.each(Object.keys(PROV_SCHEMAS) as ProvSchemaName[])(
    '%s enforces .strict() by refusing unknown keys',
    (name) => {
      const fixture = FIXTURE_MAP[name];
      const withExtra = { ...fixture, _unvettedExtraKey: 'malicious-data' };
      expect(() => parseProvSchema(name, withExtra)).toThrow();
    },
  );
});

describe('§12.11 & FR-PROV-001: Lifecycle states and legal transition graph', () => {
  it('accepts all seven normative lifecycle states', () => {
    expect(ALL_PROVIDER_LIFECYCLE_STATES).toEqual([
      'DISCOVERED',
      'VERIFIED',
      'ACTIVE',
      'DEGRADED',
      'DEPRECATED',
      'BLOCKED',
      'REMOVED',
    ]);
    for (const state of ALL_PROVIDER_LIFECYCLE_STATES) {
      expect(ProviderLifecycleStateSchema.parse(state)).toBe(state);
    }
  });

  it('refuses invalid lifecycle states', () => {
    expect(() => ProviderLifecycleStateSchema.parse('PENDING')).toThrow();
    expect(() => ProviderLifecycleStateSchema.parse('UNKNOWN')).toThrow();
  });

  it('verifies LEGAL_LIFECYCLE_TRANSITIONS table completeness', () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.DISCOVERED).toEqual(['VERIFIED', 'BLOCKED', 'REMOVED']);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.REMOVED).toEqual([]);
  });

  it('correctly distinguishes legal vs illegal lifecycle transitions', () => {
    // Legal transitions:
    expect(isLegalLifecycleTransition('DISCOVERED', 'VERIFIED')).toBe(true);
    expect(isLegalLifecycleTransition('VERIFIED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEGRADED')).toBe(true);
    expect(isLegalLifecycleTransition('DEGRADED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEPRECATED')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'BLOCKED')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'REMOVED')).toBe(true);
    expect(isLegalLifecycleTransition('BLOCKED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('BLOCKED', 'VERIFIED')).toBe(true);
    expect(isLegalLifecycleTransition('BLOCKED', 'REMOVED')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'ACTIVE')).toBe(true); // self-transition

    // Illegal transitions:
    expect(isLegalLifecycleTransition('DISCOVERED', 'ACTIVE')).toBe(false); // cannot skip VERIFIED
    expect(isLegalLifecycleTransition('DEPRECATED', 'ACTIVE')).toBe(false); // deprecated cannot reactivate directly
    expect(isLegalLifecycleTransition('REMOVED', 'ACTIVE')).toBe(false); // REMOVED is terminal
    expect(isLegalLifecycleTransition('REMOVED', 'DISCOVERED')).toBe(false);
  });

  it('ProviderLifecycleEventSchema accepts legal transition and refuses illegal transition', () => {
    expect(ProviderLifecycleEventSchema.parse(lifecycleEventFixture)).toMatchObject({
      fromState: 'DISCOVERED',
      toState: 'VERIFIED',
    });

    expect(() =>
      ProviderLifecycleEventSchema.parse({
        ...lifecycleEventFixture,
        fromState: 'DISCOVERED',
        toState: 'ACTIVE',
      }),
    ).toThrow(/illegal lifecycle state transition/);

    expect(() =>
      ProviderLifecycleEventSchema.parse({
        ...lifecycleEventFixture,
        fromState: 'REMOVED',
        toState: 'ACTIVE',
      }),
    ).toThrow(/illegal lifecycle state transition/);
  });

  it('accepts all lifecycle reason classes', () => {
    expect(ProviderLifecycleReasonClassSchema.parse('INITIAL_DISCOVERY')).toBe('INITIAL_DISCOVERY');
    expect(ProviderLifecycleReasonClassSchema.parse('TTL_EXPIRED')).toBe('TTL_EXPIRED');
    expect(ProviderLifecycleReasonClassSchema.parse('SECURITY_QUARANTINE')).toBe(
      'SECURITY_QUARANTINE',
    );
  });
});

describe('§15.4 & FR-PROV-001: Health statuses', () => {
  it('accepts all twelve normative health statuses', () => {
    expect(ALL_PROVIDER_HEALTH_STATUSES).toHaveLength(12);
    for (const status of ALL_PROVIDER_HEALTH_STATUSES) {
      expect(ProviderHealthStatusSchema.parse(status)).toBe(status);
    }
  });

  it('refuses invalid health statuses', () => {
    expect(() => ProviderHealthStatusSchema.parse('HEALTH_UNKNOWN')).toThrow();
  });
});

describe('§15.2: Capability and Cost classes', () => {
  it('identifies prohibited provider capabilities', () => {
    expect(PROHIBITED_PROVIDER_CAPABILITY_CLASSES).toEqual([
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ]);
    for (const cap of PROHIBITED_PROVIDER_CAPABILITY_CLASSES) {
      expect(isProhibitedCapabilityClass(cap)).toBe(true);
      expect(ProviderCapabilityClassSchema.parse(cap)).toBe(cap);
    }
    expect(isProhibitedCapabilityClass('READ_MARKET')).toBe(false);
    expect(isProhibitedCapabilityClass('READ_SECURITY')).toBe(false);
    expect(isProhibitedCapabilityClass('QUOTE_READ_ONLY')).toBe(false);
  });

  it('accepts all cost classes', () => {
    const costClasses = [
      'FREE_UNMETERED',
      'FREE_QUOTA',
      'PAID_EXPLICIT',
      'UNKNOWN_COST',
      'DISABLED',
    ] as const;
    for (const c of costClasses) {
      expect(ProviderCostClassSchema.parse(c)).toBe(c);
    }
  });
});

describe('§15.3 & FR-PROV-001: Operation definitions', () => {
  it('accepts well-formed provider operation definitions and records', () => {
    const parsed = ProviderOperationDefinitionSchema.parse(operationDefinitionFixture);
    expect(parsed.providerId).toBe('helius');
    expect(parsed.costClass).toBe('FREE_QUOTA');
    expect(parsed.batchCapability?.maxEntities).toBe(100);

    const parsedRecord = ProviderOperationRecordSchema.parse(operationRecordFixture);
    expect(parsedRecord.currentState).toBe('ACTIVE');
  });

  it('refuses definition with invalid timestamps or missing fields', () => {
    expect(() =>
      ProviderOperationDefinitionSchema.parse({
        ...operationDefinitionFixture,
        verificationExpiresAt: 'not-a-utc-timestamp',
      }),
    ).toThrow();

    expect(() =>
      ProviderOperationDefinitionSchema.parse({
        ...operationDefinitionFixture,
        timeoutMs: -50, // must be positive
      }),
    ).toThrow();
  });

  it('validates batch capability and supported program schemas', () => {
    expect(BatchCapabilitySchema.parse({ maxEntities: 10, maxBytes: 1024 })).toBeDefined();
    expect(() => BatchCapabilitySchema.parse({ maxEntities: 0 })).toThrow();
    expect(
      SupportedProgramSchema.parse({ programId: 'prog-1', versions: ['v1', 'v2'] }),
    ).toBeDefined();
  });

  it('validates provider operation dependency registration', () => {
    expect(OperationConsumerKindSchema.parse('FEATURE')).toBe('FEATURE');
    expect(OperationConsumerKindSchema.parse('TOOL')).toBe('TOOL');
    expect(ProviderOperationDependencySchema.parse(operationDependencyFixture)).toMatchObject({
      consumerKind: 'FEATURE',
      active: true,
    });
    expect(() =>
      ProviderOperationDependencySchema.parse({
        ...operationDependencyFixture,
        consumerKind: 'INVALID_KIND',
      }),
    ).toThrow();
  });
});

describe('FR-PROV-002: Verification kinds, records, and TTL configs', () => {
  it('accepts all 9 verification kinds', () => {
    expect(ALL_PROVIDER_VERIFICATION_KINDS).toEqual([
      'DOCUMENTATION',
      'PRICING_PLAN',
      'QUOTA',
      'RIGHTS',
      'SCHEMA',
      'ENDPOINT',
      'AUTHENTICATION',
      'DEPRECATION',
      'LIVE_PROBE',
    ]);
    for (const kind of ALL_PROVIDER_VERIFICATION_KINDS) {
      expect(ProviderVerificationKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('accepts verification sources and outcomes', () => {
    expect(VerificationSourceSchema.parse('OFFICIAL_DOC')).toBe('OFFICIAL_DOC');
    expect(VerificationSourceSchema.parse('LIVE_CONTRACT')).toBe('LIVE_CONTRACT');
    expect(VerificationOutcomeSchema.parse('PASSED')).toBe('PASSED');
    expect(VerificationOutcomeSchema.parse('FAILED')).toBe('FAILED');
  });

  it('enforces expiresAt >= verifiedAt refinement on verification records', () => {
    expect(ProviderVerificationRecordSchema.parse(verificationRecordFixture)).toBeDefined();

    expect(() =>
      ProviderVerificationRecordSchema.parse({
        ...verificationRecordFixture,
        verifiedAt: at('2026-08-10T00:00:00Z'),
        expiresAt: at('2026-08-01T00:00:00Z'), // expires before verified
      }),
    ).toThrow(/expiresAt must not be earlier than verifiedAt/);
  });

  it('validates TTL config schema', () => {
    expect(ProviderTtlConfigSchema.parse(ttlConfigFixture)).toMatchObject({
      ttlSeconds: 86400 * 14,
    });
    expect(() =>
      ProviderTtlConfigSchema.parse({
        ...ttlConfigFixture,
        ttlSeconds: -100, // must be positive
      }),
    ).toThrow();
  });
});

describe('FR-PROV-003: Time-bounded migration exceptions', () => {
  it('accepts valid time-bounded migration exception', () => {
    expect(ProviderMigrationExceptionSchema.parse(migrationExceptionFixture)).toMatchObject({
      exceptionId: 'me-1',
    });
  });

  it('refuses migration exception with expiration <= creation instant', () => {
    expect(() =>
      ProviderMigrationExceptionSchema.parse({
        ...migrationExceptionFixture,
        createdAt: at('2026-08-10T00:00:00Z'),
        exceptionExpiresAt: at('2026-08-10T00:00:00Z'), // equal is refused (must be strictly greater)
      }),
    ).toThrow(/exceptionExpiresAt must be strictly greater than createdAt/);

    expect(() =>
      ProviderMigrationExceptionSchema.parse({
        ...migrationExceptionFixture,
        createdAt: at('2026-08-10T00:00:00Z'),
        exceptionExpiresAt: at('2026-08-05T00:00:00Z'), // before creation
      }),
    ).toThrow(/exceptionExpiresAt must be strictly greater than createdAt/);
  });
});

describe('FR-PROV-008: Quarantine classes and findings', () => {
  it('accepts all 5 malicious response quarantine classes', () => {
    expect(ALL_RESPONSE_QUARANTINE_CLASSES).toEqual([
      'TRANSACTION_PAYLOAD',
      'SIGNING_REQUEST',
      'EXECUTABLE_INSTRUCTION',
      'PRIVATE_KEY_FIELD',
      'UNEXPECTED_WRITE_CAPABILITY',
    ]);
    for (const c of ALL_RESPONSE_QUARANTINE_CLASSES) {
      expect(ResponseQuarantineClassSchema.parse(c)).toBe(c);
    }
  });

  it('validates metadata-only quarantine finding with ENFORCED exclusion and REJECTED disposition', () => {
    const finding = ResponseQuarantineFindingSchema.parse(quarantineFindingFixture);
    expect(finding.disposition).toBe('REJECTED');
    expect(finding.modelContextExclusion).toBe('ENFORCED');
    expect(finding.payloadSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses quarantine findings with invalid disposition or modelContextExclusion', () => {
    expect(() =>
      ResponseQuarantineFindingSchema.parse({
        ...quarantineFindingFixture,
        disposition: 'ACCEPTED',
      }),
    ).toThrow();

    expect(() =>
      ResponseQuarantineFindingSchema.parse({
        ...quarantineFindingFixture,
        modelContextExclusion: 'PERMITTED',
      }),
    ).toThrow();

    expect(() =>
      ResponseQuarantineFindingSchema.parse({
        ...quarantineFindingFixture,
        detectedClasses: [], // minimum 1 required
      }),
    ).toThrow();
  });
});

describe('FR-PROV-009: Sixteen-field rights matrices, changes, artifacts, and actions', () => {
  it('validates 16-field rights matrix with verificationExpiresAt >= verifiedAt refinement', () => {
    expect(ProviderRightsMatrixSchema.parse(rightsMatrixFixture)).toMatchObject({
      commercialUseAllowed: true,
      cacheAllowed: true,
      maximumCacheDurationSeconds: 3600,
    });

    expect(() =>
      ProviderRightsMatrixSchema.parse({
        ...rightsMatrixFixture,
        verifiedAt: at('2026-08-10T00:00:00Z'),
        verificationExpiresAt: at('2026-08-01T00:00:00Z'),
      }),
    ).toThrow(/verificationExpiresAt must not be earlier than verifiedAt/);
  });

  it('validates all rights use kinds', () => {
    expect(ALL_RIGHTS_USE_KINDS).toEqual([
      'COMMERCIAL_USE',
      'PERSONAL_RESEARCH',
      'CACHE',
      'RAW_RETENTION',
      'DERIVED_FEATURES',
      'MODEL_TRAINING',
      'REDISTRIBUTION',
      'PUBLIC_ALERT_DERIVATIVE',
      'RAW_EXPORT',
    ]);
    for (const k of ALL_RIGHTS_USE_KINDS) {
      expect(RightsUseKindSchema.parse(k)).toBe(k);
    }
  });

  it('validates rights change records', () => {
    expect(ProviderRightsChangeSchema.parse(rightsChangeFixture)).toMatchObject({
      fromRightsVersion: 'v1',
      toRightsVersion: 'v2',
      newlyProhibitedUses: ['REDISTRIBUTION', 'MODEL_TRAINING'],
    });
  });

  it('validates provider artifact records and states', () => {
    expect(ProviderArtifactStateSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(ProviderArtifactStateSchema.parse('QUARANTINED')).toBe('QUARANTINED');
    expect(ProviderArtifactStateSchema.parse('RETIRED')).toBe('RETIRED');
    expect(() => ProviderArtifactStateSchema.parse('DELETED')).toThrow();

    expect(ProviderArtifactRecordSchema.parse(artifactRecordFixture)).toMatchObject({
      state: 'ACTIVE',
    });
  });

  it('validates rights change action records', () => {
    expect(RightsChangeActionTypeSchema.parse('QUARANTINE')).toBe('QUARANTINE');
    expect(RightsChangeActionTypeSchema.parse('RETIRE')).toBe('RETIRE');
    expect(ProviderRightsChangeActionSchema.parse(rightsChangeActionFixture)).toMatchObject({
      actionType: 'QUARANTINE',
    });
  });
});

describe('FR-PROV-010: Six fingerprint kinds and dependence states', () => {
  it('accepts all six source fingerprint kinds', () => {
    expect(ALL_SOURCE_FINGERPRINT_KINDS).toEqual([
      'UPSTREAM_LINEAGE',
      'VALUE_CORRELATION',
      'TIMING_BEHAVIOR',
      'OUTAGE_CORRELATION',
      'SCHEMA_CHARACTERISTICS',
      'FIRST_SEEN_BEHAVIOR',
    ]);
    for (const k of ALL_SOURCE_FINGERPRINT_KINDS) {
      expect(SourceFingerprintKindSchema.parse(k)).toBe(k);
    }
  });

  it('accepts all provider dependence states', () => {
    const states = [
      'INDEPENDENT_WITHIN_TESTED_SCOPE',
      'PARTIALLY_DEPENDENT',
      'HIGHLY_DEPENDENT',
      'UNKNOWN_DEPENDENCE',
      'SAME_UPSTREAM',
    ] as const;
    for (const s of states) {
      expect(ProviderDependenceStateSchema.parse(s)).toBe(s);
    }
  });

  it('validates source fingerprint records', () => {
    expect(SourceFingerprintRecordSchema.parse(sourceFingerprintFixture)).toMatchObject({
      fingerprintKind: 'UPSTREAM_LINEAGE',
    });
  });
});

describe('AC-272: Provider activation readiness status', () => {
  it('validates readiness status decisions', () => {
    expect(ProviderReadinessDecisionSchema.parse('ELIGIBLE')).toBe('ELIGIBLE');
    expect(ProviderReadinessDecisionSchema.parse('BLOCKED')).toBe('BLOCKED');
    expect(ProviderReadinessStatusSchema.parse(readinessStatusFixture)).toMatchObject({
      readiness: 'ELIGIBLE',
      blockers: [],
    });
    expect(
      ProviderReadinessStatusSchema.parse({
        ...readinessStatusFixture,
        readiness: 'BLOCKED',
        blockers: ['RIGHTS_UNVERIFIED', 'PROHIBITED_CAPABILITY_EXPOSED'],
      }),
    ).toMatchObject({
      readiness: 'BLOCKED',
      blockers: ['RIGHTS_UNVERIFIED', 'PROHIBITED_CAPABILITY_EXPOSED'],
    });
  });
});
