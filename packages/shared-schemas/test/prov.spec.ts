/**
 * Accept/refuse matrices for the provider lifecycle schema family (FR-PROV-001…010
 * manifest schemaRefs). Every `.strict()` object must refuse unknown keys —
 * fail-closed extends to record shape. Table-driven where the rule is uniform.
 */
import { describe, expect, it } from 'vitest';
import {
  LEGAL_LIFECYCLE_TRANSITIONS,
  MigrationExceptionSchema,
  PROHIBITED_CAPABILITY_CLASSES,
  PROV_SCHEMAS,
  PROV_SCHEMA_REGISTRY_VERSION,
  ProviderAdapterDescriptorSchema,
  ProviderArtifactRecordSchema,
  ProviderArtifactStateSchema,
  ProviderCapabilityClassSchema,
  ProviderCostClassSchema,
  ProviderDependencyConsumerKindSchema,
  ProviderFingerprintKindSchema,
  ProviderHealthRecordSchema,
  ProviderHealthStatusSchema,
  ProviderLifecycleStateSchema,
  ProviderLifecycleTransitionEventSchema,
  ProviderOperationDefinitionSchema,
  ProviderOperationDependencySchema,
  ProviderOperationRecordSchema,
  ProviderReadinessEvaluationSchema,
  ProviderReadinessStatusSchema,
  ProviderRightsMatrixSchema,
  ProviderVerificationKindSchema,
  ProviderVerificationRecordSchema,
  ProviderVerificationTtlConfigSchema,
  QuarantineClassSchema,
  ReplacementPlanSchema,
  ReplacementPlanStatusSchema,
  ResponseQuarantineRecordSchema,
  RightsActionKindSchema,
  RightsChangeActionRecordSchema,
  RightsChangeRecordSchema,
  RightsUsePathSchema,
  SourceFingerprintRecordSchema,
  SupportedProgramEntrySchema,
  VerificationOutcomeSchema,
  VerificationSourceSchema,
  isLegalLifecycleTransition,
  isProhibitedCapabilityClass,
  parseProvSchema,
  type ProvSchemaName,
} from '../src/prov.ts';

const at = (s: string) => s;
const HASH = `sha256:${'ab'.repeat(32)}`;
const HASH2 = `sha256:${'cd'.repeat(32)}`;

// --- Per-schema valid fixtures ---------------------------------------------

const operationDefFixture = {
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  version: '1.0.0',
  capabilityClass: 'READ_TRANSACTION_RAW',
  supportedChains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  supportedPrograms: [
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', versions: ['1.0.0'] },
  ],
  inputSchemaId: 'schema://prov/helius/raw-tx/in@1',
  rawOutputSchemaId: 'schema://prov/helius/raw-tx/raw-out@1',
  normalizedOutputSchemaId: 'schema://prov/helius/raw-tx/norm-out@1',
  quotaModelId: 'quota://helius/credits-per-call@1',
  cachePolicyId: 'cache://immutable-finalized-tx@1',
  timeoutMs: 5000,
  retryPolicyId: 'retry://standard-idempotent@1',
  declaredIndependenceGroup: 'group:helius-direct',
  upstreamLineage: ['lineage://solana-validator-rpc'],
  licensePolicyId: 'license://standard-commercial@1',
  healthStatus: 'HEALTHY',
  costClass: 'FREE_QUOTA',
  estimatedQuotaUnits: 10,
  quotaResetPolicyId: 'reset://monthly-rolling@1',
  batchCapability: { maxEntities: 100, maxBytes: 1048576 },
  minimumCandidateStage: 'STAGE_1_DISCOVERY',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  paidFallbackAllowed: false,
  deprecatedAt: at('2026-12-31T00:00:00Z'),
  sunsetAt: at('2027-06-30T00:00:00Z'),
  replacementOperationId: 'get_transaction_v2',
  verificationExpiresAt: at('2026-09-01T00:00:00Z'),
  forbiddenOutputFields: ['privateKey', 'signTransaction'],
  negativeCapabilities: ['NO_TRANSACTION_SIGNING', 'NO_PRIVATE_KEY_EXPORT'],
};

const operationRecordFixture = {
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  version: '1.0.0',
  currentState: 'ACTIVE',
  healthStatus: 'HEALTHY',
  lastDocumentationVerificationAt: at('2026-08-01T00:00:00Z'),
  lastLiveProbeAt: at('2026-08-25T12:00:00Z'),
  replacementOperationId: null,
  sunsetAt: null,
  deprecatedAt: null,
  affectedFeatures: ['feature:wallet_history', 'feature:token_transfers'],
};

const operationDependencyFixture = {
  dependencyId: 'dep-101',
  consumerKind: 'FEATURE',
  consumerKey: 'feature:wallet_history',
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  operationVersion: '1.0.0',
  active: true,
  registeredAt: at('2026-08-01T00:00:00Z'),
};

const lifecycleEventFixture = {
  eventId: 'evt-1',
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  version: '1.0.0',
  fromState: 'DISCOVERED',
  toState: 'VERIFIED',
  reasonClass: 'DOCUMENTATION_AND_SMOKE_PASSED',
  actor: 'system:verification-runner',
  occurredAt: at('2026-08-01T00:00:00Z'),
  evidenceRefs: ['evidence://verification/doc-1', 'evidence://verification/probe-1'],
  idempotencyKey: 'idem:evt-1',
};

const healthRecordFixture = {
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  version: '1.0.0',
  status: 'HEALTHY',
  endpointRegion: 'us-east-1',
  chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  programId: null,
  checkedAt: at('2026-08-25T12:00:00Z'),
  reason: 'smoke test passed within 120ms',
  evidenceRef: 'evidence://probe/run-99',
};

const verificationRecordFixture = {
  verificationId: 'ver-1',
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  operationVersion: '1.0.0',
  kind: 'DOCUMENTATION',
  source: 'OFFICIAL_DOC',
  outcome: 'PASSED',
  verifiedAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-09-01T00:00:00Z'),
  evidenceRefs: ['evidence://doc/helius-docs-v1'],
  notes: 'all fields matched official spec',
};

const verificationTtlConfigFixture = {
  configId: 'ttl-doc-default',
  providerId: null,
  kind: 'DOCUMENTATION',
  ttlSeconds: 2592000,
  updatedAt: at('2026-08-01T00:00:00Z'),
};

const replacementPlanFixture = {
  planId: 'plan-1',
  targetProviderId: 'helius',
  targetOperationId: 'get_transaction_v2',
  targetVersion: '2.0.0',
  plannedMigrationDeadline: at('2026-11-01T00:00:00Z'),
  milestones: ['adapter implementation', 'shadow validation', 'traffic cutover'],
  status: 'APPROVED',
};

const migrationExceptionFixture = {
  exceptionId: 'exc-1',
  providerId: 'helius',
  operationId: 'get_transaction_enhanced_deprecated',
  operationVersion: '0.9.0',
  approver: 'sec-admin@example.com',
  reason: 'legacy consumer migration in progress',
  replacementPlanId: 'plan-1',
  replacementPlan: replacementPlanFixture,
  createdAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-10-01T00:00:00Z'),
  revokedAt: null,
};

const quarantineRecordFixture = {
  quarantineId: 'quar-1',
  providerId: 'untrusted-vendor',
  operationId: 'quote_with_tx',
  operationVersion: '1.0.0',
  detectedClasses: ['TRANSACTION_PAYLOAD', 'PRIVATE_KEY_FIELD'],
  fieldPaths: ['response.body.transactionPayload', 'response.body.secretKey'],
  payloadSha256: HASH,
  byteSize: 1024,
  disposition: 'REJECTED',
  modelContextExclusion: 'ENFORCED',
  auditChainRef: 'audit://event/seq-5521',
  quarantinedAt: at('2026-08-25T12:00:00Z'),
  details: 'Transaction payload detected in read-only adapter response',
};

const rightsMatrixFixture = {
  providerId: 'gmgn',
  operationId: 'get_token_metrics',
  rightsVersion: 1,
  commercialUseAllowed: true,
  personalResearchAllowed: true,
  cacheAllowed: true,
  maximumCacheDurationSeconds: 86400,
  rawRetentionAllowed: true,
  derivedFeaturesAllowed: true,
  modelTrainingAllowed: false,
  redistributionAllowed: false,
  publicAlertDerivativeAllowed: true,
  attributionRequired: true,
  userByokRequired: false,
  rawExportAllowed: false,
  jurisdictionRestrictions: ['OFAC_SANCTIONED_COUNTRIES'],
  termsVersion: '2026-05-v1',
  verifiedAt: at('2026-08-01T00:00:00Z'),
  verificationExpiresAt: at('2026-09-01T00:00:00Z'),
};

const rightsChangeFixture = {
  changeId: 'rc-1',
  providerId: 'gmgn',
  operationId: 'get_token_metrics',
  fromRightsVersion: 1,
  toRightsVersion: 2,
  newlyProhibitedUses: ['EXPORT', 'REDISTRIBUTION'],
  tightened: true,
  changedAt: at('2026-08-20T00:00:00Z'),
  actor: 'compliance@example.com',
  auditRef: 'audit://event/seq-6012',
};

const providerArtifactFixture = {
  artifactId: 'art-1',
  objectRef: 'obj://artifacts/gmgn/tokens/sol-123',
  providerId: 'gmgn',
  operationId: 'get_token_metrics',
  operationVersion: '1.0.0',
  rightsVersion: 1,
  state: 'ACTIVE',
  capturedAt: at('2026-08-15T00:00:00Z'),
  updatedAt: at('2026-08-15T00:00:00Z'),
};

const rightsChangeActionFixture = {
  actionId: 'act-1',
  changeId: 'rc-1',
  artifactId: 'art-1',
  action: 'QUARANTINE',
  executedAt: at('2026-08-20T00:05:00Z'),
  details: 'Artifact quarantined following rights version 2 tightening',
};

const sourceFingerprintFixture = {
  fingerprintId: 'fp-1',
  providerId: 'dexscreener',
  operationId: 'get_pair_info',
  operationVersion: '1.0.0',
  kind: 'TIMING_BEHAVIOR',
  fingerprintPayloadCanonical: '{"p50LagMs":250,"p95LagMs":1200}',
  fingerprintSha256: HASH2,
  computedAt: at('2026-08-25T00:00:00Z'),
  estimatorInputRefs: ['dep-input://dexscreener/timing@2026-08-25'],
};

const readinessEvaluationFixture = {
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  version: '1.0.0',
  status: 'ELIGIBLE',
  blockingReasons: [],
  evaluatedAt: at('2026-08-25T12:00:00Z'),
  rightsVerified: true,
  lifecycleHealthy: true,
  verificationFresh: true,
  prohibitedExposuresAbsent: true,
};

const adapterDescriptorFixture = {
  adapterId: 'adapter:helius:get-raw-tx',
  providerId: 'helius',
  operationId: 'get_transaction_raw',
  pathTemplate: '/v0/transactions/{signature}',
  httpMethod: 'GET',
  acceptedContentTypes: ['application/json'],
  allowedRequestFields: ['signature', 'encoding', 'commitment'],
  responseSchemaId: 'schema://prov/helius/raw-tx/raw-out@1',
};

const FIXTURES: Record<ProvSchemaName, unknown> = {
  ProviderOperationDefinition: operationDefFixture,
  ProviderOperationRecord: operationRecordFixture,
  ProviderOperationDependency: operationDependencyFixture,
  ProviderLifecycleTransitionEvent: lifecycleEventFixture,
  ProviderHealthRecord: healthRecordFixture,
  ProviderVerificationRecord: verificationRecordFixture,
  ProviderVerificationTtlConfig: verificationTtlConfigFixture,
  ReplacementPlan: replacementPlanFixture,
  MigrationException: migrationExceptionFixture,
  ResponseQuarantineRecord: quarantineRecordFixture,
  ProviderRightsMatrix: rightsMatrixFixture,
  RightsChangeRecord: rightsChangeFixture,
  ProviderArtifactRecord: providerArtifactFixture,
  RightsChangeActionRecord: rightsChangeActionFixture,
  SourceFingerprintRecord: sourceFingerprintFixture,
  ProviderReadinessEvaluation: readinessEvaluationFixture,
  ProviderAdapterDescriptor: adapterDescriptorFixture,
};

// --- Tests -----------------------------------------------------------------

describe('PROV schema family — registry', () => {
  it('exposes registry version and every declared provider schema by name', () => {
    expect(PROV_SCHEMA_REGISTRY_VERSION).toBe(1);
    const names = Object.keys(PROV_SCHEMAS) as ProvSchemaName[];
    expect(names.length).toBe(17);
    expect(names).toContain('ProviderOperationDefinition');
    expect(names).toContain('ProviderLifecycleTransitionEvent');
    expect(names).toContain('ProviderHealthRecord');
    expect(names).toContain('ProviderVerificationRecord');
    expect(names).toContain('ResponseQuarantineRecord');
    expect(names).toContain('ProviderRightsMatrix');
    expect(names).toContain('SourceFingerprintRecord');
    expect(names).toContain('ProviderReadinessEvaluation');
  });

  it.each(Object.keys(PROV_SCHEMAS) as ProvSchemaName[])(
    'parseProvSchema(%s) round-trips valid fixture and throws on invalid inputs',
    (name) => {
      const fixture = FIXTURES[name];
      expect(parseProvSchema(name, fixture)).toBeDefined();
      expect(() => parseProvSchema(name, { obviously: 'wrong' })).toThrow();
    },
  );

  it.each(Object.keys(PROV_SCHEMAS) as ProvSchemaName[])(
    '%s strictly refuses unknown keys (fail-closed shape enforcement)',
    (name) => {
      const fixture = FIXTURES[name] as Record<string, unknown>;
      const poisoned = { ...fixture, unvetted_extra_property: 'hazardous_payload' };
      expect(() => PROV_SCHEMAS[name].parse(poisoned)).toThrow();
    },
  );
});

describe('§15.2 Cost and capability classes', () => {
  it('accepts all valid cost classes and refuses invalid ones', () => {
    const valid = ['FREE_UNMETERED', 'FREE_QUOTA', 'PAID_EXPLICIT', 'UNKNOWN_COST', 'DISABLED'];
    for (const c of valid) {
      expect(ProviderCostClassSchema.parse(c)).toBe(c);
    }
    expect(() => ProviderCostClassSchema.parse('UNLIMITED_PAID')).toThrow();
    expect(() => ProviderCostClassSchema.parse('')).toThrow();
  });

  it('accepts all valid capability classes and correctly identifies prohibited classes', () => {
    const valid = [
      'READ_MARKET',
      'READ_SECURITY',
      'READ_IDENTITY',
      'READ_TRANSACTION_RAW',
      'READ_TRANSACTION_HISTORY',
      'READ_ACCOUNT_STATE',
      'READ_SOCIAL_AGGREGATE',
      'STREAM_PROGRAM_EVENT',
      'QUOTE_READ_ONLY',
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ];
    for (const cap of valid) {
      expect(ProviderCapabilityClassSchema.parse(cap)).toBe(cap);
    }
    expect(PROHIBITED_CAPABILITY_CLASSES).toHaveLength(4);
    expect(isProhibitedCapabilityClass('PROHIBITED_SIGN')).toBe(true);
    expect(isProhibitedCapabilityClass('PROHIBITED_CUSTODY')).toBe(true);
    expect(isProhibitedCapabilityClass('READ_MARKET')).toBe(false);
  });
});

describe('§12.11 Lifecycle states and transitions (FR-PROV-001)', () => {
  it('accepts all 7 lifecycle states', () => {
    const states = [
      'DISCOVERED',
      'VERIFIED',
      'ACTIVE',
      'DEGRADED',
      'DEPRECATED',
      'BLOCKED',
      'REMOVED',
    ];
    for (const s of states) {
      expect(ProviderLifecycleStateSchema.parse(s)).toBe(s);
    }
    expect(() => ProviderLifecycleStateSchema.parse('SHADOW')).toThrow();
  });

  it('validates legal lifecycle transitions according to the §12.11 graph', () => {
    expect(isLegalLifecycleTransition('DISCOVERED', 'VERIFIED')).toBe(true);
    expect(isLegalLifecycleTransition('DISCOVERED', 'BLOCKED')).toBe(true);
    expect(isLegalLifecycleTransition('DISCOVERED', 'REMOVED')).toBe(true);
    expect(isLegalLifecycleTransition('DISCOVERED', 'ACTIVE')).toBe(false);

    expect(isLegalLifecycleTransition('VERIFIED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('VERIFIED', 'DEGRADED')).toBe(true);
    expect(isLegalLifecycleTransition('VERIFIED', 'DEPRECATED')).toBe(true);

    expect(isLegalLifecycleTransition('ACTIVE', 'DEGRADED')).toBe(true);
    expect(isLegalLifecycleTransition('DEGRADED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEPRECATED')).toBe(true);

    expect(isLegalLifecycleTransition('DEPRECATED', 'BLOCKED')).toBe(true);
    expect(isLegalLifecycleTransition('DEPRECATED', 'ACTIVE')).toBe(false);

    expect(isLegalLifecycleTransition('BLOCKED', 'VERIFIED')).toBe(true);
    expect(isLegalLifecycleTransition('BLOCKED', 'DEGRADED')).toBe(true);

    expect(isLegalLifecycleTransition('REMOVED', 'ACTIVE')).toBe(false);
    expect(isLegalLifecycleTransition('REMOVED', 'DISCOVERED')).toBe(false);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.REMOVED).toEqual([]);
  });

  it('accepts valid lifecycle transition event and refuses illegal state jump', () => {
    expect(ProviderLifecycleTransitionEventSchema.parse(lifecycleEventFixture)).toBeDefined();

    const illegalJump = {
      ...lifecycleEventFixture,
      fromState: 'DISCOVERED',
      toState: 'ACTIVE',
    };
    expect(() => ProviderLifecycleTransitionEventSchema.parse(illegalJump)).toThrow(
      /illegal lifecycle state transition/,
    );
  });
});

describe('§15.4 Health statuses', () => {
  it('accepts all 12 provider health statuses', () => {
    const statuses = [
      'HEALTHY',
      'DEGRADED',
      'SCHEMA_DRIFT',
      'PLAN_UNVERIFIED',
      'RIGHTS_UNVERIFIED',
      'DEPRECATED',
      'SUNSET_PENDING',
      'QUOTA_LOW',
      'QUOTA_EXHAUSTED',
      'AUTH_FAILED',
      'UNSUPPORTED',
      'DISABLED',
    ];
    for (const h of statuses) {
      expect(ProviderHealthStatusSchema.parse(h)).toBe(h);
    }
    expect(() => ProviderHealthStatusSchema.parse('ONLINE')).toThrow();
  });

  it('validates ProviderHealthRecordSchema', () => {
    expect(ProviderHealthRecordSchema.parse(healthRecordFixture)).toBeDefined();
    expect(() =>
      ProviderHealthRecordSchema.parse({ ...healthRecordFixture, checkedAt: 'not-a-date' }),
    ).toThrow();
  });
});

describe('§15.3 Operation definitions and metadata (FR-PROV-001)', () => {
  it('accepts complete valid operation definition', () => {
    const parsed = ProviderOperationDefinitionSchema.parse(operationDefFixture);
    expect(parsed.providerId).toBe('helius');
    expect(parsed.costClass).toBe('FREE_QUOTA');
    expect(parsed.batchCapability?.maxEntities).toBe(100);
  });

  it('refuses operation definition with negative timeout or quota', () => {
    expect(() =>
      ProviderOperationDefinitionSchema.parse({
        ...operationDefFixture,
        timeoutMs: -500,
      }),
    ).toThrow();

    expect(() =>
      ProviderOperationDefinitionSchema.parse({
        ...operationDefFixture,
        estimatedQuotaUnits: -1,
      }),
    ).toThrow();
  });

  it('validates SupportedProgramEntry and ProviderOperationDependency schemas', () => {
    expect(
      SupportedProgramEntrySchema.parse({
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        versions: ['1.0.0'],
      }),
    ).toBeDefined();

    expect(ProviderOperationDependencySchema.parse(operationDependencyFixture)).toBeDefined();

    const validKinds = ['FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE'];
    for (const k of validKinds) {
      expect(ProviderDependencyConsumerKindSchema.parse(k)).toBe(k);
    }
  });

  it('validates ProviderOperationRecordSchema', () => {
    expect(ProviderOperationRecordSchema.parse(operationRecordFixture)).toBeDefined();
    expect(() =>
      ProviderOperationRecordSchema.parse({
        ...operationRecordFixture,
        currentState: 'INVALID_STATE',
      }),
    ).toThrow();
  });
});

describe('FR-PROV-002: Verification kinds, records, TTL configs', () => {
  it('accepts all 9 verification kinds', () => {
    const kinds = [
      'DOCUMENTATION',
      'PRICING_PLAN',
      'QUOTA',
      'RIGHTS',
      'SCHEMA',
      'ENDPOINT',
      'AUTHENTICATION',
      'DEPRECATION',
      'LIVE_PROBE',
    ];
    for (const k of kinds) {
      expect(ProviderVerificationKindSchema.parse(k)).toBe(k);
    }
  });

  it('accepts valid verification sources and outcomes', () => {
    expect(VerificationSourceSchema.parse('OFFICIAL_DOC')).toBe('OFFICIAL_DOC');
    expect(VerificationSourceSchema.parse('LIVE_CONTRACT')).toBe('LIVE_CONTRACT');
    expect(VerificationOutcomeSchema.parse('PASSED')).toBe('PASSED');
    expect(VerificationOutcomeSchema.parse('FAILED')).toBe('FAILED');
    expect(VerificationOutcomeSchema.parse('INCONCLUSIVE')).toBe('INCONCLUSIVE');
  });

  it('refuses verification records where expiresAt <= verifiedAt', () => {
    expect(ProviderVerificationRecordSchema.parse(verificationRecordFixture)).toBeDefined();
    const expiredEarly = {
      ...verificationRecordFixture,
      verifiedAt: at('2026-08-01T00:00:00Z'),
      expiresAt: at('2026-07-01T00:00:00Z'),
    };
    expect(() => ProviderVerificationRecordSchema.parse(expiredEarly)).toThrow(
      /expiresAt must be after verifiedAt/,
    );
  });

  it('validates ProviderVerificationTtlConfigSchema', () => {
    expect(ProviderVerificationTtlConfigSchema.parse(verificationTtlConfigFixture)).toBeDefined();
    expect(() =>
      ProviderVerificationTtlConfigSchema.parse({
        ...verificationTtlConfigFixture,
        ttlSeconds: 0,
      }),
    ).toThrow();
  });
});

describe('FR-PROV-003: Migration exceptions and replacement plans', () => {
  it('accepts valid replacement plan and replacement plan statuses', () => {
    expect(ReplacementPlanSchema.parse(replacementPlanFixture)).toBeDefined();
    const statuses = ['DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED'];
    for (const s of statuses) {
      expect(ReplacementPlanStatusSchema.parse(s)).toBe(s);
    }
  });

  it('accepts migration exception and refuses inverted time window', () => {
    expect(MigrationExceptionSchema.parse(migrationExceptionFixture)).toBeDefined();

    const inverted = {
      ...migrationExceptionFixture,
      createdAt: at('2026-08-01T00:00:00Z'),
      expiresAt: at('2026-07-01T00:00:00Z'),
    };
    expect(() => MigrationExceptionSchema.parse(inverted)).toThrow(
      /expiresAt must be after createdAt/,
    );
  });
});

describe('FR-PROV-008: Quarantine classes and response records', () => {
  it('accepts all 5 quarantine classes', () => {
    const classes = [
      'TRANSACTION_PAYLOAD',
      'SIGNING_REQUEST',
      'EXECUTABLE_INSTRUCTION',
      'PRIVATE_KEY_FIELD',
      'UNEXPECTED_WRITE_CAPABILITY',
    ];
    for (const c of classes) {
      expect(QuarantineClassSchema.parse(c)).toBe(c);
    }
  });

  it('validates ResponseQuarantineRecord and enforces sha256 hash pattern and rejection disposition', () => {
    expect(ResponseQuarantineRecordSchema.parse(quarantineRecordFixture)).toBeDefined();

    const invalidHash = {
      ...quarantineRecordFixture,
      payloadSha256: 'not-a-hash',
    };
    expect(() => ResponseQuarantineRecordSchema.parse(invalidHash)).toThrow(
      /must be a sha256:<hex> keyed hash/,
    );

    const badDisposition = {
      ...quarantineRecordFixture,
      disposition: 'ACCEPTED',
    };
    expect(() => ResponseQuarantineRecordSchema.parse(badDisposition)).toThrow();
  });
});

describe('FR-PROV-009 & §15.6: Sixteen-field rights matrices and actions', () => {
  it('accepts 16-field rights matrix and enforces expiresAt > verifiedAt', () => {
    expect(ProviderRightsMatrixSchema.parse(rightsMatrixFixture)).toBeDefined();

    const staleExpiry = {
      ...rightsMatrixFixture,
      verifiedAt: at('2026-08-01T00:00:00Z'),
      verificationExpiresAt: at('2026-08-01T00:00:00Z'),
    };
    expect(() => ProviderRightsMatrixSchema.parse(staleExpiry)).toThrow(
      /verificationExpiresAt must be after verifiedAt/,
    );
  });

  it('accepts all RightsUsePath values', () => {
    const paths = [
      'STORAGE',
      'DERIVED_USE',
      'REDISTRIBUTION',
      'CACHING',
      'EXPORT',
      'MODEL_TRAINING',
      'PUBLIC_ALERT',
    ];
    for (const p of paths) {
      expect(RightsUsePathSchema.parse(p)).toBe(p);
    }
  });

  it('validates RightsChangeRecord, ProviderArtifactRecord, and RightsChangeActionRecord', () => {
    expect(RightsChangeRecordSchema.parse(rightsChangeFixture)).toBeDefined();
    expect(ProviderArtifactRecordSchema.parse(providerArtifactFixture)).toBeDefined();
    expect(RightsChangeActionRecordSchema.parse(rightsChangeActionFixture)).toBeDefined();

    const validArtifactStates = ['ACTIVE', 'QUARANTINED', 'RETIRED'];
    for (const s of validArtifactStates) {
      expect(ProviderArtifactStateSchema.parse(s)).toBe(s);
    }

    const validActionKinds = ['QUARANTINE', 'RETIRE'];
    for (const a of validActionKinds) {
      expect(RightsActionKindSchema.parse(a)).toBe(a);
    }
  });
});

describe('FR-PROV-010: Six provider source fingerprint kinds', () => {
  it('accepts all 6 fingerprint kinds', () => {
    const kinds = [
      'UPSTREAM_LINEAGE',
      'VALUE_CORRELATION',
      'TIMING_BEHAVIOR',
      'OUTAGE_CORRELATION',
      'SCHEMA_CHARACTERISTICS',
      'FIRST_SEEN_BEHAVIOR',
    ];
    for (const k of kinds) {
      expect(ProviderFingerprintKindSchema.parse(k)).toBe(k);
    }
  });

  it('validates SourceFingerprintRecordSchema and checks hash', () => {
    expect(SourceFingerprintRecordSchema.parse(sourceFingerprintFixture)).toBeDefined();

    expect(() =>
      SourceFingerprintRecordSchema.parse({
        ...sourceFingerprintFixture,
        fingerprintSha256: 'md5:1234',
      }),
    ).toThrow();
  });
});

describe('FR-PROV-005: Adapter allowlist descriptors', () => {
  it('validates ProviderAdapterDescriptorSchema with HTTP methods and content types', () => {
    expect(ProviderAdapterDescriptorSchema.parse(adapterDescriptorFixture)).toBeDefined();

    expect(() =>
      ProviderAdapterDescriptorSchema.parse({
        ...adapterDescriptorFixture,
        httpMethod: 'INVALID_VERB',
      }),
    ).toThrow();

    expect(() =>
      ProviderAdapterDescriptorSchema.parse({
        ...adapterDescriptorFixture,
        acceptedContentTypes: [],
      }),
    ).toThrow();
  });
});

describe('AC-272: Provider readiness evaluation', () => {
  it('validates ELIGIBLE with zero blocking reasons', () => {
    expect(ProviderReadinessEvaluationSchema.parse(readinessEvaluationFixture)).toBeDefined();
    expect(ProviderReadinessStatusSchema.parse('ELIGIBLE')).toBe('ELIGIBLE');
    expect(ProviderReadinessStatusSchema.parse('BLOCKED')).toBe('BLOCKED');
  });

  it('validates BLOCKED with non-empty blocking reasons', () => {
    const blocked = {
      ...readinessEvaluationFixture,
      status: 'BLOCKED',
      blockingReasons: ['RIGHTS_UNVERIFIED', 'DEPRECATED_WITHOUT_EXCEPTION'],
      rightsVerified: false,
    };
    expect(ProviderReadinessEvaluationSchema.parse(blocked)).toBeDefined();
  });

  it('refuses inconsistent readiness status and blocking reasons combinations', () => {
    const illegalEligible = {
      ...readinessEvaluationFixture,
      status: 'ELIGIBLE',
      blockingReasons: ['SOMETHING_IS_WRONG'],
    };
    expect(() => ProviderReadinessEvaluationSchema.parse(illegalEligible)).toThrow(
      /ELIGIBLE status must have zero blocking reasons/,
    );

    const illegalBlocked = {
      ...readinessEvaluationFixture,
      status: 'BLOCKED',
      blockingReasons: [],
    };
    expect(() => ProviderReadinessEvaluationSchema.parse(illegalBlocked)).toThrow(
      /BLOCKED status must have at least one blocking reason/,
    );
  });
});
