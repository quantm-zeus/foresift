/**
 * Accept/refuse matrices for the provider lifecycle schema family (FR-PROV-001…010
 * manifest schemaRefs).
 *
 * Every `.strict()` object must refuse unknown keys — a schema that tolerates
 * extra fields would let an unvetted capability flag or prohibited parameter
 * bypass security controls.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_QUARANTINE_DETECTION_CLASSES,
  ALL_SOURCE_FINGERPRINT_KINDS,
  ALL_VERIFICATION_KINDS,
  BatchCapabilitySchema,
  LEGAL_LIFECYCLE_TRANSITIONS,
  LifecycleTransitionEventSchema,
  LifecycleTransitionReasonClassSchema,
  MigrationExceptionSchema,
  PROHIBITED_CAPABILITY_CLASSES,
  PROV_SCHEMAS,
  PROV_SCHEMA_REGISTRY_VERSION,
  ProviderAdapterAllowlistSchema,
  ProviderArtifactRecordSchema,
  ProviderArtifactStateSchema,
  ProviderCapabilityClassSchema,
  ProviderCostClassSchema,
  ProviderDependenceStateSchema,
  ProviderDependencyConsumerKindSchema,
  ProviderGroupSchema,
  ProviderHealthStatusSchema,
  ProviderLifecycleStateSchema,
  ProviderOperationDefinitionSchema,
  ProviderOperationDependencySchema,
  ProviderReadinessReportSchema,
  ProviderReadinessVerdictSchema,
  ProviderRecordSchema,
  ProviderRightsChangeActionSchema,
  ProviderRightsChangeSchema,
  ProviderRightsDeclarationSchema,
  ProviderRightsMatrixSchema,
  QuarantineDetectionClassSchema,
  QuarantineFindingSchema,
  ReplacementPlanSchema,
  ReplacementPlanStatusSchema,
  ResponseQuarantineRecordSchema,
  RightsChangeActionTypeSchema,
  RightsUsePathSchema,
  SourceFingerprintKindSchema,
  SourceFingerprintRecordSchema,
  SupportedProgramSchema,
  VerificationKindSchema,
  VerificationOutcomeSchema,
  VerificationRecordSchema,
  VerificationSourceSchema,
  VerificationTtlConfigSchema,
  isLegalLifecycleTransition,
  isProhibitedCapabilityClass,
  parseProvSchema,
  type ProvSchemaName,
} from '../src/prov.ts';

const at = (s: string) => s;
const HASH = `sha256:${'ab'.repeat(32)}`;

// ---------------------------------------------------------------------------
// Per-schema valid fixtures
// ---------------------------------------------------------------------------

const providerRecordFixture = {
  providerId: 'prov_helius_1',
  displayName: 'Helius Solana API',
  group: 'HELIUS' as const,
  disabledByDefault: true,
  documentationUrl: 'https://docs.helius.dev',
  registeredAt: at('2026-08-01T00:00:00Z'),
  updatedAt: at('2026-08-01T00:00:00Z'),
};

const supportedProgramFixture = {
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  versions: ['v1', 'v2'],
};

const batchCapabilityFixture = {
  maxEntities: 100,
  maxBytes: 1048576,
};

const operationDefinitionFixture = {
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  version: '1.0.0',
  capabilityClass: 'READ_TRANSACTION_RAW' as const,
  supportedChains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
  supportedPrograms: [supportedProgramFixture],
  inputSchemaId: 'schema:helius:getRawTransaction:input:v1',
  rawOutputSchemaId: 'schema:helius:getRawTransaction:raw:v1',
  normalizedOutputSchemaId: 'schema:helius:getRawTransaction:normalized:v1',
  quotaModelId: 'qm_requests_per_sec',
  cachePolicyId: 'cp_immutable_slot',
  timeoutMs: 5000,
  retryPolicyId: 'rp_exponential_backoff',
  declaredIndependenceGroup: 'ind_solana_rpc',
  upstreamLineage: ['solana_validator_network'],
  licensePolicyId: 'lic_helius_standard',
  healthStatus: 'HEALTHY' as const,
  costClass: 'FREE_QUOTA' as const,
  estimatedQuotaUnits: 10,
  quotaResetPolicyId: 'qrp_monthly_first',
  batchCapability: batchCapabilityFixture,
  minimumCandidateStage: 'DISCOVERED',
  protectedReserveEligible: true,
  allowedInStrictFree: true,
  paidFallbackAllowed: false,
  deprecatedAt: at('2026-10-01T00:00:00Z'),
  sunsetAt: at('2026-12-01T00:00:00Z'),
  replacementOperationId: 'getRawTransactionV2',
  verificationExpiresAt: at('2026-09-01T00:00:00Z'),
  forbiddenOutputFields: ['secretKey', 'privateKey'],
  negativeCapabilities: ['SWAP', 'SIGN_TRANSACTION', 'BUILD_TRANSACTION'],
};

const operationDependencyFixture = {
  dependencyId: 'dep_001',
  consumerKind: 'FEATURE' as const,
  consumerKey: 'solana_raw_tx_indexer',
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  operationVersion: '1.0.0',
  active: true,
  registeredAt: at('2026-08-01T00:00:00Z'),
};

const lifecycleEventFixture = {
  eventId: 'evt_001',
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  version: '1.0.0',
  fromState: 'DISCOVERED' as const,
  toState: 'VERIFIED' as const,
  reasonClass: 'VERIFICATION_PASSED' as const,
  actor: 'system:verifier',
  occurredAt: at('2026-08-01T01:00:00Z'),
  evidenceRefs: ['ev_verif_doc_001', 'ev_verif_live_001'],
  idempotencyKey: 'idem_prov_helius_1_getRawTransaction_1_0_0_DISCOVERED_VERIFIED',
};

const verificationRecordFixture = {
  recordId: 'vr_001',
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  version: '1.0.0',
  kind: 'DOCUMENTATION' as const,
  source: 'OFFICIAL_DOC' as const,
  outcome: 'PASSED' as const,
  verifiedAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-09-01T00:00:00Z'),
  evidenceRefs: ['ev_doc_scrape_001'],
  notes: 'Verified against Helius documentation v2.1',
};

const verificationTtlConfigFixture = {
  providerId: 'prov_helius_1',
  kind: 'DOCUMENTATION' as const,
  ttlSeconds: 2592000,
  gracePeriodSeconds: 86400,
};

const replacementPlanFixture = {
  planId: 'rp_001',
  targetOperationId: 'getRawTransactionV2',
  targetProviderId: 'prov_helius_1',
  targetVersion: '2.0.0',
  milestoneTarget: 'G1',
  migrationDeadline: at('2026-11-30T00:00:00Z'),
  status: 'APPROVED' as const,
};

const migrationExceptionFixture = {
  exceptionId: 'me_001',
  providerId: 'prov_helius_1',
  operationId: 'getEnhancedTransactionsLegacy',
  version: '0.9.0',
  approvedBy: 'security-lead@foresift.dev',
  reason: 'Required as non-authoritative supporting evidence during migration',
  replacementPlan: replacementPlanFixture,
  createdAt: at('2026-08-01T00:00:00Z'),
  exceptionExpiresAt: at('2026-11-01T00:00:00Z'),
  revokedAt: null,
};

const quarantineFindingFixture = {
  findingId: 'qf_001',
  detectedClass: 'TRANSACTION_PAYLOAD' as const,
  fieldPath: 'response.data.transaction.serializedPayload',
  description: 'Detected serialized transaction bytes in provider response',
};

const responseQuarantineRecordFixture = {
  quarantineId: 'qr_001',
  providerId: 'prov_helius_1',
  operationId: 'getQuote',
  version: '1.0.0',
  detectedClasses: ['TRANSACTION_PAYLOAD' as const, 'PRIVATE_KEY_FIELD' as const],
  fieldPaths: ['response.data.txPayload', 'response.data.private_key'],
  payloadSha256: HASH,
  byteSize: 2048,
  disposition: 'REJECTED' as const,
  auditRef: 'audit:event:99281',
  modelContextExclusion: 'ENFORCED' as const,
  quarantinedAt: at('2026-08-01T02:00:00Z'),
};

const rightsMatrixFixture = {
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
  jurisdictionRestrictions: ['OFAC_SANCTIONED'],
  termsVersion: '2026.1',
  verifiedAt: at('2026-08-01T00:00:00Z'),
  verificationExpiresAt: at('2026-09-01T00:00:00Z'),
};

const rightsDeclarationFixture = {
  ...rightsMatrixFixture,
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  version: '1.0.0',
  rightsVersion: 1,
};

const rightsChangeFixture = {
  changeId: 'rc_001',
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  fromRightsVersion: 1,
  toRightsVersion: 2,
  newlyProhibitedUses: ['REDISTRIBUTION' as const, 'RAW_EXPORT' as const],
  changedAt: at('2026-08-15T00:00:00Z'),
  actor: 'compliance@foresift.dev',
  auditRef: 'audit:rights:rc_001',
};

const artifactRecordFixture = {
  artifactId: 'art_001',
  objectRef: 's3://foresift-raw/helius/tx/12345.json',
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  operationVersion: '1.0.0',
  rightsVersion: 1,
  state: 'ACTIVE' as const,
  capturedAt: at('2026-08-05T00:00:00Z'),
  updatedAt: at('2026-08-05T00:00:00Z'),
};

const rightsChangeActionFixture = {
  actionId: 'rca_001',
  changeId: 'rc_001',
  artifactId: 'art_001',
  action: 'QUARANTINE' as const,
  reason: 'Rights update tightened redistribution permission',
  executedAt: at('2026-08-15T00:01:00Z'),
  actor: 'system:rights-engine',
};

const sourceFingerprintRecordFixture = {
  fingerprintId: 'fp_001',
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  version: '1.0.0',
  kind: 'UPSTREAM_LINEAGE' as const,
  canonicalPayload: JSON.stringify({ upstream: 'solana-validator-mainnet', hopCount: 1 }),
  payloadSha256: HASH,
  estimatorInputRefs: ['est_input_001', 'est_input_002'],
  computedAt: at('2026-08-01T00:00:00Z'),
};

const readinessReportFixture = {
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  version: '1.0.0',
  verdict: 'ELIGIBLE' as const,
  reasons: [],
  evaluatedAt: at('2026-08-01T00:00:00Z'),
};

const adapterAllowlistFixture = {
  providerId: 'prov_helius_1',
  operationId: 'getRawTransaction',
  scheme: 'https' as const,
  host: 'api.helius.xyz',
  port: 443,
  pathTemplate: '/v0/transactions/{signature}',
  method: 'GET' as const,
  contentTypes: ['application/json'],
  allowedRequestFields: ['signature', 'commitment'],
  responseSchemaId: 'schema:helius:getRawTransaction:raw:v1',
  redirectPolicy: 'ERROR' as const,
  maxResponseBytes: 10485760,
  dnsIpPolicy: 'PUBLIC_ONLY',
};

// Map of all positive fixtures to their registered schema name
const positives: readonly [ProvSchemaName, unknown][] = [
  ['ProviderRecord', providerRecordFixture],
  ['SupportedProgram', supportedProgramFixture],
  ['BatchCapability', batchCapabilityFixture],
  ['ProviderOperationDefinition', operationDefinitionFixture],
  ['ProviderOperationDependency', operationDependencyFixture],
  ['LifecycleTransitionEvent', lifecycleEventFixture],
  ['VerificationRecord', verificationRecordFixture],
  ['VerificationTtlConfig', verificationTtlConfigFixture],
  ['ReplacementPlan', replacementPlanFixture],
  ['MigrationException', migrationExceptionFixture],
  ['QuarantineFinding', quarantineFindingFixture],
  ['ResponseQuarantineRecord', responseQuarantineRecordFixture],
  ['ProviderRightsMatrix', rightsMatrixFixture],
  ['ProviderRightsDeclaration', rightsDeclarationFixture],
  ['ProviderRightsChange', rightsChangeFixture],
  ['ProviderArtifactRecord', artifactRecordFixture],
  ['ProviderRightsChangeAction', rightsChangeActionFixture],
  ['SourceFingerprintRecord', sourceFingerprintRecordFixture],
  ['ProviderReadinessReport', readinessReportFixture],
  ['ProviderAdapterAllowlist', adapterAllowlistFixture],
];

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('prov schema registry', () => {
  it('is versioned and covers all FR-PROV schema families', () => {
    expect(PROV_SCHEMA_REGISTRY_VERSION).toBe(1);
    expect(Object.keys(PROV_SCHEMAS).length).toBeGreaterThanOrEqual(18);
  });

  it('parseProvSchema parses valid payloads by registered name', () => {
    for (const [name, fixture] of positives) {
      const parsed = parseProvSchema(name, fixture);
      expect(parsed).toBeDefined();
    }
  });

  it('safeParse succeeds for every valid fixture', () => {
    for (const [name, fixture] of positives) {
      const result = PROV_SCHEMAS[name].safeParse(fixture);
      if (!result.success) {
        throw new Error(
          `${name} fixture failed validation: ${JSON.stringify(result.error.issues)}`,
        );
      }
      expect(result.success).toBe(true);
    }
  });
});

describe('§15.2 Cost and capability classes', () => {
  it('accepts all valid cost classes and refuses invalid ones', () => {
    const valid = ['FREE_UNMETERED', 'FREE_QUOTA', 'PAID_EXPLICIT', 'UNKNOWN_COST', 'DISABLED'];
    for (const c of valid) {
      expect(ProviderCostClassSchema.parse(c)).toBe(c);
    }
    expect(() => ProviderCostClassSchema.parse('CUSTOM_COST')).toThrow();
  });

  it('accepts all valid capability classes and identifies prohibited classes', () => {
    expect(PROHIBITED_CAPABILITY_CLASSES).toEqual([
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ]);

    for (const p of PROHIBITED_CAPABILITY_CLASSES) {
      expect(isProhibitedCapabilityClass(p)).toBe(true);
      expect(ProviderCapabilityClassSchema.parse(p)).toBe(p);
    }

    expect(isProhibitedCapabilityClass('READ_MARKET')).toBe(false);
    expect(isProhibitedCapabilityClass('READ_SECURITY')).toBe(false);
    expect(isProhibitedCapabilityClass('QUOTE_READ_ONLY')).toBe(false);
    expect(() => ProviderCapabilityClassSchema.parse('EXECUTE_ARBITRARY_TRADE')).toThrow();
  });
});

describe('§12.11 Lifecycle states and legal transitions', () => {
  it('accepts the seven-state alphabet and refuses unknown states', () => {
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
    expect(() => ProviderLifecycleStateSchema.parse('PENDING')).toThrow();
    expect(() => ProviderLifecycleStateSchema.parse('SUSPENDED')).toThrow();
  });

  it('enforces the legal transition graph correctly', () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.DISCOVERED).toContain('VERIFIED');
    expect(isLegalLifecycleTransition('DISCOVERED', 'VERIFIED')).toBe(true);
    expect(isLegalLifecycleTransition('VERIFIED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEGRADED')).toBe(true);
    expect(isLegalLifecycleTransition('DEGRADED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEPRECATED')).toBe(true);
    expect(isLegalLifecycleTransition('DEPRECATED', 'BLOCKED')).toBe(true);
    expect(isLegalLifecycleTransition('BLOCKED', 'REMOVED')).toBe(true);

    // Self-transitions are not valid transitions
    expect(isLegalLifecycleTransition('ACTIVE', 'ACTIVE')).toBe(false);
    expect(isLegalLifecycleTransition('DISCOVERED', 'DISCOVERED')).toBe(false);

    // Terminal REMOVED state has no outgoing transitions
    expect(isLegalLifecycleTransition('REMOVED', 'ACTIVE')).toBe(false);
    expect(isLegalLifecycleTransition('REMOVED', 'DISCOVERED')).toBe(false);

    // DEPRECATED cannot directly jump back to ACTIVE
    expect(isLegalLifecycleTransition('DEPRECATED', 'ACTIVE')).toBe(false);
  });

  it('validates transition reason classes', () => {
    expect(LifecycleTransitionReasonClassSchema.parse('INITIAL_DISCOVERY')).toBe(
      'INITIAL_DISCOVERY',
    );
    expect(LifecycleTransitionReasonClassSchema.parse('VERIFICATION_PASSED')).toBe(
      'VERIFICATION_PASSED',
    );
    expect(() => LifecycleTransitionReasonClassSchema.parse('INVALID_REASON')).toThrow();
  });

  it('LifecycleTransitionEventSchema refuses illegal transitions', () => {
    const illegal = {
      ...lifecycleEventFixture,
      fromState: 'REMOVED' as const,
      toState: 'ACTIVE' as const,
    };
    expect(() => LifecycleTransitionEventSchema.parse(illegal)).toThrow(
      /illegal lifecycle transition/,
    );
  });
});

describe('§15.4 Health statuses', () => {
  it('accepts all 12 health status vocabulary values and refuses others', () => {
    const valid = [
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
    for (const h of valid) {
      expect(ProviderHealthStatusSchema.parse(h)).toBe(h);
    }
    expect(() => ProviderHealthStatusSchema.parse('UNHEALTHY')).toThrow();
    expect(() => ProviderHealthStatusSchema.parse('WARNING')).toThrow();
  });
});

describe('§15.3 Operation definitions and dependencies', () => {
  it('accepts provider records and provider groups', () => {
    expect(ProviderRecordSchema.parse(providerRecordFixture).providerId).toBe('prov_helius_1');
    expect(ProviderGroupSchema.parse('HELIUS')).toBe('HELIUS');
    expect(ProviderGroupSchema.parse('GMGN')).toBe('GMGN');
    expect(() => ProviderGroupSchema.parse('UNKNOWN_GROUP')).toThrow();
  });

  it('accepts supported program and batch capability schemas', () => {
    expect(SupportedProgramSchema.parse(supportedProgramFixture).programId).toBe(
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    );
    expect(BatchCapabilitySchema.parse(batchCapabilityFixture).maxEntities).toBe(100);
  });

  it('accepts a complete provider operation definition', () => {
    const parsed = ProviderOperationDefinitionSchema.parse(operationDefinitionFixture);
    expect(parsed.operationId).toBe('getRawTransaction');
    expect(parsed.protectedReserveEligible).toBe(true);
  });

  it('refuses operation definitions where sunsetAt is before deprecatedAt', () => {
    const invalid = {
      ...operationDefinitionFixture,
      deprecatedAt: at('2026-12-01T00:00:00Z'),
      sunsetAt: at('2026-10-01T00:00:00Z'),
    };
    expect(() => ProviderOperationDefinitionSchema.parse(invalid)).toThrow(
      /sunsetAt must be at or after deprecatedAt/,
    );
  });

  it('refuses operation definitions with non-positive timeoutMs or invalid cost class', () => {
    expect(() =>
      ProviderOperationDefinitionSchema.parse({
        ...operationDefinitionFixture,
        timeoutMs: 0,
      }),
    ).toThrow();

    expect(() =>
      ProviderOperationDefinitionSchema.parse({
        ...operationDefinitionFixture,
        costClass: 'INVALID_COST',
      }),
    ).toThrow();
  });

  it('validates affected-feature dependencies and consumer kinds', () => {
    const parsed = ProviderOperationDependencySchema.parse(operationDependencyFixture);
    expect(parsed.consumerKind).toBe('FEATURE');
    expect(ProviderDependencyConsumerKindSchema.parse('FEATURE')).toBe('FEATURE');
    expect(ProviderDependencyConsumerKindSchema.parse('TOOL')).toBe('TOOL');
    expect(() =>
      ProviderOperationDependencySchema.parse({
        ...operationDependencyFixture,
        consumerKind: 'UNKNOWN_CONSUMER',
      }),
    ).toThrow();
  });
});

describe('FR-PROV-002: Verification kinds, records, sources, and TTLs', () => {
  it('covers all nine verification kinds and outcomes', () => {
    expect(ALL_VERIFICATION_KINDS).toEqual([
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
    for (const k of ALL_VERIFICATION_KINDS) {
      expect(VerificationKindSchema.parse(k)).toBe(k);
    }
    expect(VerificationOutcomeSchema.parse('PASSED')).toBe('PASSED');
    expect(VerificationOutcomeSchema.parse('FAILED')).toBe('FAILED');
    expect(() => VerificationOutcomeSchema.parse('UNKNOWN')).toThrow();
  });

  it('accepts OFFICIAL_DOC and LIVE_CONTRACT verification sources', () => {
    expect(VerificationSourceSchema.parse('OFFICIAL_DOC')).toBe('OFFICIAL_DOC');
    expect(VerificationSourceSchema.parse('LIVE_CONTRACT')).toBe('LIVE_CONTRACT');
    expect(() => VerificationSourceSchema.parse('UNVERIFIED_BLOG')).toThrow();
  });

  it('refuses verification records where expiresAt is before verifiedAt', () => {
    const invalid = {
      ...verificationRecordFixture,
      verifiedAt: at('2026-08-01T12:00:00Z'),
      expiresAt: at('2026-08-01T11:00:00Z'),
    };
    expect(() => VerificationRecordSchema.parse(invalid)).toThrow(
      /expiresAt must be at or after verifiedAt/,
    );
  });

  it('validates TTL config schemas with positive ttlSeconds', () => {
    expect(VerificationTtlConfigSchema.parse(verificationTtlConfigFixture).ttlSeconds).toBe(
      2592000,
    );
    expect(() =>
      VerificationTtlConfigSchema.parse({
        ...verificationTtlConfigFixture,
        ttlSeconds: -1,
      }),
    ).toThrow();
  });
});

describe('FR-PROV-003: Migration exceptions and replacement plans', () => {
  it('accepts a valid migration exception with replacement plan and status', () => {
    expect(ReplacementPlanSchema.parse(replacementPlanFixture).planId).toBe('rp_001');
    expect(ReplacementPlanStatusSchema.parse('APPROVED')).toBe('APPROVED');
    const parsed = MigrationExceptionSchema.parse(migrationExceptionFixture);
    expect(parsed.replacementPlan.status).toBe('APPROVED');
    expect(parsed.exceptionId).toBe('me_001');
  });

  it('refuses migration exceptions where exceptionExpiresAt is before or equal to createdAt', () => {
    const invalid = {
      ...migrationExceptionFixture,
      createdAt: at('2026-08-01T12:00:00Z'),
      exceptionExpiresAt: at('2026-08-01T12:00:00Z'),
    };
    expect(() => MigrationExceptionSchema.parse(invalid)).toThrow(
      /exceptionExpiresAt must be after createdAt/,
    );
  });
});

describe('FR-PROV-008: Response quarantine (AC-271)', () => {
  it('enumerates all five malicious-response detection classes and parses findings', () => {
    expect(ALL_QUARANTINE_DETECTION_CLASSES).toEqual([
      'TRANSACTION_PAYLOAD',
      'SIGNING_REQUEST',
      'EXECUTABLE_INSTRUCTION',
      'PRIVATE_KEY_FIELD',
      'UNEXPECTED_WRITE_CAPABILITY',
    ]);
    for (const c of ALL_QUARANTINE_DETECTION_CLASSES) {
      expect(QuarantineDetectionClassSchema.parse(c)).toBe(c);
    }
    expect(QuarantineFindingSchema.parse(quarantineFindingFixture).detectedClass).toBe(
      'TRANSACTION_PAYLOAD',
    );
  });

  it('ResponseQuarantineRecordSchema enforces REJECTED disposition and ENFORCED model exclusion', () => {
    const parsed = ResponseQuarantineRecordSchema.parse(responseQuarantineRecordFixture);
    expect(parsed.disposition).toBe('REJECTED');
    expect(parsed.modelContextExclusion).toBe('ENFORCED');

    expect(() =>
      ResponseQuarantineRecordSchema.parse({
        ...responseQuarantineRecordFixture,
        disposition: 'ALLOWED',
      }),
    ).toThrow();

    expect(() =>
      ResponseQuarantineRecordSchema.parse({
        ...responseQuarantineRecordFixture,
        modelContextExclusion: 'DISABLED',
      }),
    ).toThrow();
  });

  it('ResponseQuarantineRecordSchema requires valid keyed sha256 hash', () => {
    expect(() =>
      ResponseQuarantineRecordSchema.parse({
        ...responseQuarantineRecordFixture,
        payloadSha256: 'not-a-valid-sha256-hash',
      }),
    ).toThrow();
  });
});

describe('FR-PROV-009: Sixteen-field rights matrices and changes (AC-273)', () => {
  it('accepts all sixteen fields of the rights matrix and declarations', () => {
    const parsed = ProviderRightsMatrixSchema.parse(rightsMatrixFixture);
    expect(parsed.commercialUseAllowed).toBe(true);
    expect(parsed.personalResearchAllowed).toBe(true);
    expect(parsed.cacheAllowed).toBe(true);
    expect(parsed.maximumCacheDurationSeconds).toBe(86400);
    expect(parsed.rawRetentionAllowed).toBe(true);
    expect(parsed.derivedFeaturesAllowed).toBe(true);
    expect(parsed.modelTrainingAllowed).toBe(false);
    expect(parsed.redistributionAllowed).toBe(false);
    expect(parsed.publicAlertDerivativeAllowed).toBe(true);
    expect(parsed.attributionRequired).toBe(true);
    expect(parsed.userByokRequired).toBe(false);
    expect(parsed.rawExportAllowed).toBe(false);
    expect(parsed.jurisdictionRestrictions).toEqual(['OFAC_SANCTIONED']);
    expect(parsed.termsVersion).toBe('2026.1');
    expect(parsed.verifiedAt).toBe(at('2026-08-01T00:00:00Z'));
    expect(parsed.verificationExpiresAt).toBe(at('2026-09-01T00:00:00Z'));

    expect(ProviderRightsDeclarationSchema.parse(rightsDeclarationFixture).rightsVersion).toBe(1);
    expect(RightsUsePathSchema.parse('COMMERCIAL_USE')).toBe('COMMERCIAL_USE');
    expect(RightsUsePathSchema.parse('REDISTRIBUTION')).toBe('REDISTRIBUTION');
  });

  it('refuses rights matrix when verificationExpiresAt is before verifiedAt', () => {
    const invalid = {
      ...rightsMatrixFixture,
      verifiedAt: at('2026-08-01T12:00:00Z'),
      verificationExpiresAt: at('2026-08-01T11:00:00Z'),
    };
    expect(() => ProviderRightsMatrixSchema.parse(invalid)).toThrow(
      /verificationExpiresAt must be at or after verifiedAt/,
    );
  });

  it('refuses rights matrix when cacheAllowed is false but maximumCacheDurationSeconds is set', () => {
    const invalid = {
      ...rightsMatrixFixture,
      cacheAllowed: false,
      maximumCacheDurationSeconds: 3600,
    };
    expect(() => ProviderRightsMatrixSchema.parse(invalid)).toThrow(
      /maximumCacheDurationSeconds must be null when cacheAllowed is false/,
    );
  });

  it('accepts rights matrix when cacheAllowed is false and maximumCacheDurationSeconds is null', () => {
    const valid = {
      ...rightsMatrixFixture,
      cacheAllowed: false,
      maximumCacheDurationSeconds: null,
    };
    expect(ProviderRightsMatrixSchema.parse(valid).cacheAllowed).toBe(false);
  });

  it('validates rights changes, requiring toRightsVersion > fromRightsVersion', () => {
    expect(ProviderRightsChangeSchema.parse(rightsChangeFixture).toRightsVersion).toBe(2);
    const invalid = {
      ...rightsChangeFixture,
      fromRightsVersion: 2,
      toRightsVersion: 1,
    };
    expect(() => ProviderRightsChangeSchema.parse(invalid)).toThrow(
      /toRightsVersion must be greater than fromRightsVersion/,
    );
  });

  it('validates artifact records, artifact states, and rights change action types', () => {
    expect(ProviderArtifactStateSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(ProviderArtifactStateSchema.parse('QUARANTINED')).toBe('QUARANTINED');
    expect(ProviderArtifactStateSchema.parse('RETIRED')).toBe('RETIRED');
    expect(RightsChangeActionTypeSchema.parse('QUARANTINE')).toBe('QUARANTINE');
    expect(RightsChangeActionTypeSchema.parse('RETIRE')).toBe('RETIRE');
    expect(ProviderArtifactRecordSchema.parse(artifactRecordFixture).state).toBe('ACTIVE');
    expect(ProviderRightsChangeActionSchema.parse(rightsChangeActionFixture).action).toBe(
      'QUARANTINE',
    );
  });
});

describe('FR-PROV-010: Source fingerprints and empirical dependence', () => {
  it('enumerates all six source fingerprint kinds', () => {
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

  it('accepts all five empirical dependence states', () => {
    const states = [
      'INDEPENDENT_WITHIN_TESTED_SCOPE',
      'PARTIALLY_DEPENDENT',
      'HIGHLY_DEPENDENT',
      'UNKNOWN_DEPENDENCE',
      'SAME_UPSTREAM',
    ];
    for (const s of states) {
      expect(ProviderDependenceStateSchema.parse(s)).toBe(s);
    }
    expect(() => ProviderDependenceStateSchema.parse('FULLY_INDEPENDENT')).toThrow();
  });

  it('validates source fingerprint records', () => {
    const parsed = SourceFingerprintRecordSchema.parse(sourceFingerprintRecordFixture);
    expect(parsed.kind).toBe('UPSTREAM_LINEAGE');
    expect(parsed.payloadSha256).toBe(HASH);
  });
});

describe('FR-PROV-005 & AC-272: Readiness reports and adapter allowlists', () => {
  it('validates readiness reports and verdicts for ELIGIBLE and BLOCKED verdicts', () => {
    expect(ProviderReadinessVerdictSchema.parse('ELIGIBLE')).toBe('ELIGIBLE');
    expect(ProviderReadinessVerdictSchema.parse('BLOCKED')).toBe('BLOCKED');
    expect(ProviderReadinessReportSchema.parse(readinessReportFixture).verdict).toBe('ELIGIBLE');
    expect(
      ProviderReadinessReportSchema.parse({
        ...readinessReportFixture,
        verdict: 'BLOCKED',
        reasons: ['VERIFICATION_EXPIRED'],
      }).verdict,
    ).toBe('BLOCKED');
  });

  it('validates adapter allowlist descriptors', () => {
    const parsed = ProviderAdapterAllowlistSchema.parse(adapterAllowlistFixture);
    expect(parsed.method).toBe('GET');
    expect(parsed.scheme).toBe('https');
  });
});

describe('Table-driven .strict() unknown-key refusal across all registered schemas', () => {
  for (const [name, fixture] of positives) {
    it(`${name} refuses unvetted/unknown keys`, () => {
      const schema = PROV_SCHEMAS[name];
      if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) return;
      const contaminated = {
        ...(fixture as Record<string, unknown>),
        __prohibited_or_unvetted_extra_field__: 'MALICIOUS_INJECTION',
      };
      expect(() => schema.parse(contaminated), `${name} did not refuse unknown key`).toThrow();
    });
  }
});
