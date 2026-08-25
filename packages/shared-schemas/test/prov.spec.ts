import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CLASSES,
  COST_CLASSES,
  PROVIDER_HEALTH_STATUSES,
  PROVIDER_LIFECYCLE_STATES,
  PROVIDER_LIFECYCLE_TRANSITIONS,
  PROV_ARTIFACT_STATES,
  PROV_CONSUMER_KINDS,
  PROV_FINGERPRINT_KINDS,
  PROV_QUARANTINE_CLASSES,
  PROV_RIGHTS_ACTION_KINDS,
  PROV_SCHEMA_REGISTRY_VERSION,
  PROV_SCHEMAS,
  PROV_USE_PATH_KINDS,
  RIGHTS_MATRIX_FIELDS,
  TERMINAL_PROVIDER_LIFECYCLE_STATES,
  VERIFICATION_KINDS,
  isLegalLifecycleTransition,
  parseProvSchema,
  type ProvSchemaName,
} from '../src/prov.ts';

const T0 = '2026-05-01T00:00:00Z';
const T1 = '2026-05-01T06:00:00Z';
const T2 = '2026-06-01T00:00:00Z';

const providerFixture = {
  providerId: 'helius',
  providerGroup: 'RPC_INDEXER',
  disabledByDefault: false,
};

const operationFixture = {
  providerId: 'helius',
  operationId: 'getTransaction',
  version: 'v2',
  capabilityClass: 'READ_TRANSACTION_RAW',
  supportedChains: ['solana:mainnet'],
  inputSchemaId: 'schema/helius-getTransaction-input@1',
  rawOutputSchemaId: 'schema/helius-getTransaction-raw@1',
  normalizedOutputSchemaId: 'schema/normalized-transaction@1',
  quotaModelId: 'quota/helius-dcu@1',
  cachePolicyId: 'cache/std-raw@1',
  timeoutMs: 8000,
  retryPolicyId: 'retry/std-idempotent@1',
  declaredIndependenceGroup: 'indep/helius@1',
  upstreamLineage: ['lineage/solana-rpc@1'],
  licensePolicyId: 'license/helius-terms@3',
  healthStatus: 'HEALTHY',
  costClass: 'PAID_EXPLICIT',
  estimatedQuotaUnits: 2.5,
  quotaResetPolicyId: 'quota-reset/monthly@1',
  batchCapability: { maxEntities: 100 },
  protectedReserveEligible: false,
  allowedInStrictFree: false,
  paidFallbackAllowed: true,
  verificationExpiresAt: T2,
  forbiddenOutputFields: ['transaction.message.accountKeys[*].privateKey'],
  negativeCapabilities: ['PROHIBITED_SIGN', 'PROHIBITED_SUBMIT'],
};

const dependencyFixture = {
  dependencyId: 'dep-1',
  consumerKind: 'FEATURE',
  consumerKey: 'feature/liquidity-depth@2',
  providerId: 'helius',
  operationId: 'getTransaction',
  operationVersion: 'v2',
  active: true,
  registeredAt: T0,
};

const lifecycleEventFixture = {
  eventId: 'evt-1',
  providerId: 'helius',
  operationId: 'getTransaction',
  operationVersion: 'v2',
  fromState: 'DISCOVERED',
  toState: 'VERIFIED',
  reasonClass: 'CONTRACT_TESTS_PASSED',
  actor: 'registry-bootstrap',
  occurredAt: T1,
  evidenceRefs: ['verification/ver-1'],
  idempotencyKey: 'idem/helius/getTransaction/v2/DISCOVERED->VERIFIED/1',
};

const verificationRecordFixture = {
  verificationId: 'ver-1',
  providerId: 'helius',
  operationId: 'getTransaction',
  operationVersion: 'v2',
  kind: 'SCHEMA',
  source: 'LIVE_CONTRACT',
  outcome: 'PASSED',
  verifiedAt: T0,
  expiresAt: T2,
  evidenceRefs: ['evidence/contract-run-41'],
};

const ttlConfigFixture = {
  configId: 'ttl-default-schema',
  providerId: null,
  kind: 'SCHEMA',
  ttlSeconds: 604800,
};

const migrationExceptionFixture = {
  exceptionId: 'exc-1',
  providerId: 'helius',
  operationId: 'enhancedParse',
  operationVersion: 'v1',
  approver: 'approver/security-council',
  replacementPlanRef: 'plan/helius-enhanced-parser-retirement@1',
  replacementOperationId: 'getTransaction',
  grantedAt: T0,
  expiresAt: T2,
  revokedAt: null,
};

const quarantineFixture = {
  quarantineId: 'qtn-1',
  providerId: 'gmgn',
  operationId: 'tokenTrending',
  detectedClasses: ['SIGNING_REQUEST'],
  findings: [{ detectedClass: 'SIGNING_REQUEST', fieldPath: 'data.sign_message_url' }],
  payloadSha256: 'sha256:' + 'ab'.repeat(32),
  byteSize: 4096,
  disposition: 'REJECTED',
  auditChainRef: 'audit/entry-9182',
  modelContextExclusion: 'ENFORCED',
  detectedAt: T1,
};

const rightsDeclarationFixture = {
  declarationId: 'rights-1',
  providerId: 'helius',
  operationId: 'getTransaction',
  rightsVersion: 3,
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
  jurisdictionRestrictions: [],
  termsVersion: 'terms/helius@3',
  verifiedAt: T0,
  verificationExpiresAt: T2,
};

const rightsChangeFixture = {
  changeId: 'chg-1',
  providerId: 'helius',
  operationId: 'getTransaction',
  fromRightsVersion: 3,
  toRightsVersion: 4,
  newlyProhibitedUses: ['RAW_RETENTION', 'MODEL_USE'],
  termsVersion: 'terms/helius@4',
  changedAt: T1,
  evidenceRef: 'evidence/terms-update-notice-77',
};

const artifactFixture = {
  artifactId: 'art-1',
  objectRef: 'store://raw-observations/obs-8812',
  providerId: 'helius',
  operationId: 'getTransaction',
  operationVersion: 'v2',
  rightsVersionAtCapture: 3,
  capturedAt: T0,
  state: 'ACTIVE',
};

const rightsActionFixture = {
  actionId: 'act-1',
  changeId: 'chg-1',
  artifactId: 'art-1',
  actionKind: 'QUARANTINE',
  executedAt: T1,
};

const fingerprintFixture = {
  fingerprintId: 'fp-1',
  providerId: 'helius',
  operationId: 'getTransaction',
  operationVersion: 'v2',
  kind: 'TIMING_BEHAVIOR',
  fingerprintVersion: 1,
  payload: { medianLagMs: 420, p95LagMs: 1800, sampleSize: 512 },
  computedAt: T1,
  estimatorInputRefs: ['dependence/obs-input-2231'],
};

describe('prov schema registry', () => {
  it('is versioned and covers the FR-PROV schema family', () => {
    expect(PROV_SCHEMA_REGISTRY_VERSION).toBe(1);
    expect(Object.keys(PROV_SCHEMAS).sort()).toEqual(
      [
        'Provider',
        'OperationDefinition',
        'OperationDependency',
        'LifecycleEvent',
        'VerificationRecord',
        'VerificationTtlConfig',
        'MigrationException',
        'ResponseQuarantine',
        'RightsDeclaration',
        'RightsChange',
        'ProviderArtifact',
        'RightsChangeAction',
        'SourceFingerprint',
      ].sort(),
    );
  });

  it('mirrors the closed PRD vocabularies exactly', () => {
    // §12.11 — seven lifecycle states.
    expect(PROVIDER_LIFECYCLE_STATES).toHaveLength(7);
    // §15.4 — twelve health statuses.
    expect(PROVIDER_HEALTH_STATUSES).toHaveLength(12);
    // §15.2 — five cost classes, thirteen capability classes.
    expect(COST_CLASSES).toHaveLength(5);
    expect(CAPABILITY_CLASSES).toHaveLength(13);
    // Nine verification kinds, five FR-PROV-008 quarantine classes,
    // six FR-PROV-010 fingerprint kinds, seven affected use paths.
    expect(VERIFICATION_KINDS).toHaveLength(9);
    expect(PROV_QUARANTINE_CLASSES).toHaveLength(5);
    expect(PROV_FINGERPRINT_KINDS).toHaveLength(6);
    expect(PROV_USE_PATH_KINDS).toHaveLength(7);
    expect(PROV_ARTIFACT_STATES).toEqual(['ACTIVE', 'QUARANTINED', 'RETIRED']);
    expect(PROV_RIGHTS_ACTION_KINDS).toEqual(['QUARANTINE', 'RETIRE']);
    expect(PROV_CONSUMER_KINDS).toEqual(['FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE']);
  });

  it('encodes the §12.11 legal-transition graph', () => {
    expect(isLegalLifecycleTransition('DISCOVERED', 'VERIFIED')).toBe(true);
    expect(isLegalLifecycleTransition('VERIFIED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEGRADED')).toBe(true);
    expect(isLegalLifecycleTransition('DEGRADED', 'ACTIVE')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'DEPRECATED')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'BLOCKED')).toBe(true);
    expect(isLegalLifecycleTransition('ACTIVE', 'REMOVED')).toBe(true);
    // Everything else is illegal — including skipping steps and reversing
    // terminal decisions.
    expect(isLegalLifecycleTransition('DISCOVERED', 'ACTIVE')).toBe(false);
    expect(isLegalLifecycleTransition('ACTIVE', 'VERIFIED')).toBe(false);
    expect(isLegalLifecycleTransition('DEGRADED', 'REMOVED')).toBe(false);
    expect(TERMINAL_PROVIDER_LIFECYCLE_STATES.every((s) => isLegalLifecycleTransition(s, s))).toBe(
      false,
    );
    // The graph is total over the alphabet and terminals have no exits.
    for (const state of PROVIDER_LIFECYCLE_STATES) {
      expect(PROVIDER_LIFECYCLE_TRANSITIONS[state]).toBeDefined();
    }
    for (const terminal of TERMINAL_PROVIDER_LIFECYCLE_STATES) {
      expect(PROVIDER_LIFECYCLE_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

describe('round-trip: valid provider records parse against their mirrors', () => {
  const positives: readonly [ProvSchemaName, unknown][] = [
    ['Provider', providerFixture],
    ['OperationDefinition', operationFixture],
    ['OperationDependency', dependencyFixture],
    ['LifecycleEvent', lifecycleEventFixture],
    ['VerificationRecord', verificationRecordFixture],
    ['VerificationTtlConfig', ttlConfigFixture],
    ['MigrationException', migrationExceptionFixture],
    ['ResponseQuarantine', quarantineFixture],
    ['RightsDeclaration', rightsDeclarationFixture],
    ['RightsChange', rightsChangeFixture],
    ['ProviderArtifact', artifactFixture],
    ['RightsChangeAction', rightsActionFixture],
    ['SourceFingerprint', fingerprintFixture],
  ];

  it('every fixture parses against its named schema', () => {
    for (const [name, fixture] of positives) {
      const result = PROV_SCHEMAS[name].safeParse(fixture);
      if (!result.success) {
        throw new Error(
          `${name} fixture failed round-trip validation: ${JSON.stringify(result.error.issues)}`,
        );
      }
      expect(result.success).toBe(true);
    }
  });

  it('exposes the parse-by-name entrypoint', () => {
    expect(parseProvSchema('Provider', providerFixture)).toMatchObject({
      providerId: 'helius',
    });
  });

  it('rejects unknown keys on every registered schema (.strict() fail-closed policy)', () => {
    // One rogue key injected into each round-trip fixture must be refused —
    // a tolerated extra key would be a hole in the fail-closed boundary.
    for (const [name, fixture] of positives) {
      const rogue = { ...(fixture as Record<string, unknown>), __rogue_injected__: 1 };
      const result = PROV_SCHEMAS[name].safeParse(rogue);
      expect(result.success, `${name}: unknown key must be rejected`).toBe(false);
    }
  });
});

describe('operation definitions refuse prohibited capabilities (FR-PROV-001/§15.2)', () => {
  const mustFail = (payload: unknown, why: string): void => {
    const result = PROV_SCHEMAS.OperationDefinition.safeParse(payload);
    expect(result.success, `OperationDefinition: expected failure — ${why}`).toBe(false);
  };

  it('refuses every prohibited capability class outright', () => {
    for (const prohibited of [
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ]) {
      mustFail({ ...operationFixture, capabilityClass: prohibited }, `${prohibited} registered`);
    }
  });

  it('accepts every read/stream capability class', () => {
    for (const permitted of [
      'READ_MARKET',
      'READ_SECURITY',
      'READ_IDENTITY',
      'READ_ACCOUNT_STATE',
      'READ_SOCIAL_AGGREGATE',
      'STREAM_PROGRAM_EVENT',
      'QUOTE_READ_ONLY',
    ]) {
      expect(
        PROV_SCHEMAS.OperationDefinition.safeParse({
          ...operationFixture,
          capabilityClass: permitted,
        }).success,
        `${permitted} must remain registrable`,
      ).toBe(true);
    }
  });

  it('refuses unknown vocabularies and malformed bounds without defaults', () => {
    mustFail({ ...operationFixture, capabilityClass: 'READ_WEATHER' }, 'unknown capability');
    mustFail({ ...operationFixture, costClass: 'FREE_FOREVER' }, 'unknown cost class');
    mustFail({ ...operationFixture, healthStatus: 'MOSTLY_FINE' }, 'unknown health status');
    mustFail({ ...operationFixture, timeoutMs: 0 }, 'nonpositive timeout');
    mustFail({ ...operationFixture, estimatedQuotaUnits: -1 }, 'negative quota estimate');
    mustFail({ ...operationFixture, supportedChains: [] }, 'operation serving no chains');
    mustFail({ ...operationFixture, batchCapability: { maxEntities: 0 } }, 'empty batches');
    mustFail(
      { ...operationFixture, verificationExpiresAt: undefined },
      'missing verification deadline',
    );
  });

  it('accepts deprecation fields only as optional timestamps', () => {
    const deprecated = {
      ...operationFixture,
      deprecatedAt: T0,
      sunsetAt: T2,
      replacementOperationId: 'getSignaturesForAddress',
    };
    expect(PROV_SCHEMAS.OperationDefinition.safeParse(deprecated).success).toBe(true);
    mustFail({ ...deprecated, deprecatedAt: '2026-05-01 (noon)' }, 'non-ISO deprecation instant');
  });
});

describe('lifecycle ledger accepts only legal transitions (FR-PROV-001)', () => {
  const mustFail = (patch: Record<string, unknown>, why: string): void => {
    const result = PROV_SCHEMAS.LifecycleEvent.safeParse({
      ...lifecycleEventFixture,
      idempotencyKey: 'idem/retry-probe',
      ...patch,
    });
    expect(result.success, `LifecycleEvent: expected failure — ${why}`).toBe(false);
  };

  it('refuses skipped, reversed, terminal-exit and self transitions', () => {
    mustFail({ fromState: 'DISCOVERED', toState: 'ACTIVE' }, 'discovery skips verification');
    mustFail({ fromState: 'VERIFIED', toState: 'DISCOVERED' }, 'reverse transition');
    mustFail({ fromState: 'ACTIVE', toState: 'ACTIVE' }, 'self-transition is not an event');
    mustFail({ fromState: 'DEGRADED', toState: 'BLOCKED' }, 'degraded bypasses active');
    mustFail({ fromState: 'REMOVED', toState: 'DISCOVERED' }, 'removal is final');
    mustFail({ fromState: 'DEPRECATED', toState: 'ACTIVE' }, 'deprecation is final');
    mustFail({ fromState: 'BLOCKED', toState: 'ACTIVE' }, 'blocking is final');
  });

  it('refuses free-text reason classes and requires idempotency keys', () => {
    mustFail({ reasonClass: 'because docs expired' }, 'lower-case prose reason');
    mustFail({ idempotencyKey: '' }, 'empty idempotency key');
  });
});

describe('verification records and TTL configs (FR-PROV-002)', () => {
  const mustFail = (patch: Record<string, unknown>, why: string): void => {
    const result = PROV_SCHEMAS.VerificationRecord.safeParse({
      ...verificationRecordFixture,
      ...patch,
    });
    expect(result.success, `VerificationRecord: expected failure — ${why}`).toBe(false);
  };

  it('refuses unknown verification kinds, sources and outcomes', () => {
    mustFail({ kind: 'PRICING' }, 'abbreviated kind');
    mustFail({ source: 'BLOG_POST' }, 'unofficial source');
    mustFail({ outcome: 'ASSUMED_OK' }, 'made-up outcome');
  });

  it('couples expiry windows to outcomes (fail-closed)', () => {
    mustFail({ outcome: 'PASSED', expiresAt: null }, 'pass without TTL deadline');
    mustFail({ outcome: 'FAILED', expiresAt: T2 }, 'failed verification granting freshness');
    mustFail({ outcome: 'PASSED', expiresAt: T0 }, 'expiry before verification instant');
  });

  it('requires positive TTLs and allows platform-default scope', () => {
    expect(PROV_SCHEMAS.VerificationTtlConfig.safeParse(ttlConfigFixture).success).toBe(true);
    expect(
      PROV_SCHEMAS.VerificationTtlConfig.safeParse({
        ...ttlConfigFixture,
        configId: 'ttl-helius-rights',
        providerId: 'helius',
        kind: 'RIGHTS',
        ttlSeconds: 86400,
      }).success,
    ).toBe(true);
    const result = PROV_SCHEMAS.VerificationTtlConfig.safeParse({
      ...ttlConfigFixture,
      ttlSeconds: 0,
    });
    expect(result.success, 'zero TTL would disable expiry').toBe(false);
  });
});

describe('migration exceptions are strictly time-bounded (FR-PROV-003)', () => {
  const mustFail = (patch: Record<string, unknown>, why: string): void => {
    const result = PROV_SCHEMAS.MigrationException.safeParse({
      ...migrationExceptionFixture,
      ...patch,
    });
    expect(result.success, `MigrationException: expected failure — ${why}`).toBe(false);
  };

  it('refuses unbounded or inverted exception windows', () => {
    mustFail({ expiresAt: T0 }, 'expiresAt equal to grant instant');
    mustFail({ expiresAt: '2026-04-30T00:00:00Z' }, 'expiresAt before the grant');
  });

  it('refuses backdated revocations and missing replacement plans', () => {
    mustFail({ revokedAt: '2026-04-30T23:59:59Z' }, 'revocation before the grant');
    mustFail({ replacementPlanRef: '' }, 'exception without a replacement plan');
    mustFail({ approver: '' }, 'exception without an approver');
  });

  it('keeps lapsed exceptions representable but never re-bounded', () => {
    // A revoked exception stays in the ledger with its revocation instant.
    expect(
      PROV_SCHEMAS.MigrationException.safeParse({
        ...migrationExceptionFixture,
        revokedAt: T1,
      }).success,
    ).toBe(true);
  });
});

describe('quarantine is metadata-only (FR-PROV-008)', () => {
  const mustFail = (patch: Record<string, unknown>, why: string): void => {
    const result = PROV_SCHEMAS.ResponseQuarantine.safeParse({ ...quarantineFixture, ...patch });
    expect(result.success, `ResponseQuarantine: expected failure — ${why}`).toBe(false);
  };

  it('pins rejection and enforced model-context exclusion', () => {
    mustFail({ disposition: 'STORED_FOR_REVIEW' }, 'quarantined material kept around');
    mustFail({ modelContextExclusion: 'PENDING' }, 'context exclusion left unenforced');
  });

  it('refuses mismatched class declarations vs findings', () => {
    mustFail(
      {
        detectedClasses: ['SIGNING_REQUEST', 'PRIVATE_KEY_FIELD'],
      },
      'declared class without a corresponding finding',
    );
    mustFail(
      {
        detectedClasses: ['PRIVATE_KEY_FIELD'],
        findings: [
          { detectedClass: 'PRIVATE_KEY_FIELD', fieldPath: 'a' },
          { detectedClass: 'EXECUTABLE_INSTRUCTION', fieldPath: 'b' },
        ],
      },
      'finding outside the declared class set',
    );
    mustFail({ findings: [] }, 'quarantine without findings');
  });

  it('never persists payload material — only keyed hash, size and paths', () => {
    mustFail({ payloadSha256: 'deadbeef' }, 'unkeyed/raw hash shape');
    mustFail({ byteSize: 0 }, 'zero-byte response cannot be quarantined');
    // The critical structural guarantee: there is no body column to fill.
    mustFail({ payloadBody: '{"instructions":[...]}' }, 'smuggled payload-body column');
    mustFail({ rawResponse: '...' }, 'smuggled raw-response column');
  });

  it('accepts multi-class detections with exact per-finding coverage', () => {
    expect(
      PROV_SCHEMAS.ResponseQuarantine.safeParse({
        ...quarantineFixture,
        detectedClasses: ['TRANSACTION_PAYLOAD', 'UNEXPECTED_WRITE_CAPABILITY'],
        findings: [
          { detectedClass: 'TRANSACTION_PAYLOAD', fieldPath: 'result.transaction' },
          { detectedClass: 'UNEXPECTED_WRITE_CAPABILITY', fieldPath: 'result.write_method' },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('sixteen-field rights matrices, changes, artifacts, actions (FR-PROV-009)', () => {
  const mustFail = (
    schema: ProvSchemaName,
    patch: Record<string, unknown>,
    why: string,
  ): void => {
    const result = PROV_SCHEMAS[schema].safeParse(patch);
    expect(result.success, `${schema}: expected failure — ${why}`).toBe(false);
  };

  it('carries exactly the sixteen §15.6 matrix fields plus identity', () => {
    const parsed = PROV_SCHEMAS.RightsDeclaration.parse(rightsDeclarationFixture);
    const matrixKeys = Object.keys(parsed)
      .filter((k) => !['declarationId', 'providerId', 'operationId', 'rightsVersion'].includes(k))
      .sort();
    expect(matrixKeys).toEqual([...RIGHTS_MATRIX_FIELDS].sort());
    expect(matrixKeys).toHaveLength(16);
  });

  it('binds cache duration to the cache right in both directions', () => {
    mustFail(
      'RightsDeclaration',
      { ...rightsDeclarationFixture, maximumCacheDurationSeconds: null },
      'allowed cache without a maximum duration',
    );
    mustFail(
      'RightsDeclaration',
      { ...rightsDeclarationFixture, cacheAllowed: false },
      'prohibited cache still declaring a duration',
    );
  });

  it('refuses expired-at-declaration rights verifications', () => {
    mustFail(
      'RightsDeclaration',
      { ...rightsDeclarationFixture, verificationExpiresAt: T0 },
      'rights expiry preceding its verification',
    );
  });

  it('moves rights versions forward and uses the closed use-path alphabet', () => {
    mustFail(
      'RightsChange',
      { ...rightsChangeFixture, toRightsVersion: 3 },
      'version unchanged',
    );
    mustFail(
      'RightsChange',
      { ...rightsChangeFixture, fromRightsVersion: 5 },
      'version moved backwards',
    );
    mustFail(
      'RightsChange',
      { ...rightsChangeFixture, newlyProhibitedUses: ['TELLING_PEOPLE'] },
      'unknown use path',
    );
    mustFail('RightsChange', { ...rightsChangeFixture, evidenceRef: '' }, 'change without evidence');
  });

  it('allows loosening changes with no newly prohibited paths', () => {
    expect(
      PROV_SCHEMAS.RightsChange.safeParse({
        ...rightsChangeFixture,
        newlyProhibitedUses: [],
      }).success,
      'loosening is a legal recorded change (reactivation still needs reverification)',
    ).toBe(true);
  });

  it('restricts artifacts to ACTIVE|QUARANTINED|RETIRED and actions to QUARANTINE|RETIRE', () => {
    mustFail('ProviderArtifact', { ...artifactFixture, state: 'DELETED' }, 'unknown artifact state');
    mustFail(
      'RightsChangeAction',
      { ...rightsActionFixture, actionKind: 'DESTROY' },
      'unknown action kind',
    );
    // Pending (unexecuted) enumeration stays representable:
    expect(
      PROV_SCHEMAS.RightsChangeAction.safeParse({ ...rightsActionFixture, executedAt: null })
        .success,
    ).toBe(true);
  });
});

describe('source fingerprints cover the six kinds (FR-PROV-010)', () => {
  it('accepts captures of every fingerprint kind', () => {
    for (const kind of PROV_FINGERPRINT_KINDS) {
      const result = PROV_SCHEMAS.SourceFingerprint.safeParse({
        ...fingerprintFixture,
        kind,
        fingerprintId: `fp-${kind}`,
      });
      expect(result.success, `${kind} capture must parse`).toBe(true);
    }
  });

  it('refuses unknown kinds and version regressions', () => {
    expect(
      PROV_SCHEMAS.SourceFingerprint.safeParse({ ...fingerprintFixture, kind: 'VIBE_SIMILARITY' })
        .success,
    ).toBe(false);
    expect(
      PROV_SCHEMAS.SourceFingerprint.safeParse({
        ...fingerprintFixture,
        fingerprintVersion: 0,
      }).success,
    ).toBe(false);
  });

  it('keeps payloads canonical JSON objects with estimator references', () => {
    const parsed = PROV_SCHEMAS.SourceFingerprint.parse(fingerprintFixture);
    expect(Object.keys(parsed.payload)).toContain('medianLagMs');
    expect(parsed.estimatorInputRefs.length).toBeGreaterThan(0);
  });
});
