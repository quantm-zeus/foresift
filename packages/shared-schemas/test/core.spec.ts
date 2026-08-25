/**
 * Accept/refuse matrices for the Shared Tool Core schema family
 * (FR-CORE-001…008 manifest schemaRefs). Every `.strict()` object must
 * refuse unknown keys; vocabularies are asserted IDENTICAL to the
 * `@foresift/domain` §16 constants (mirror-by-construction); the prohibited
 * financial refusal is structural here as well as behavioral in tool-core.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_ACTION_CLASSES,
  ALL_BACKPRESSURE_ACTIONS,
  ALL_CACHE_OUTCOMES,
  ALL_HOLDER_MODES,
  ALL_PIPELINE_STAGES,
  ALL_QUOTA_MODELS,
  ALL_RESERVATION_STATES,
  ALL_TOOL_PROFILE_IDS,
  ALL_WORKLOAD_CLASSES,
} from '@foresift/domain';
import {
  ActionClassSchema,
  BackpressureActionSchema,
  BlockedStatePayloadSchema,
  CORE_SCHEMAS,
  CacheKeyComponentsSchema,
  CacheOutcomeSchema,
  ExactCacheEntryRecordSchema,
  HolderModeSchema,
  LicenseVerdictSchema,
  PipelineStageSchema,
  ProviderConflictRefSchema,
  QuotaModelSchema,
  QuotaReservationRecordSchema,
  QuotaUsageSummarySchema,
  ReservationStateSchema,
  SingleFlightLeaseRecordSchema,
  ToolDefinitionMetadataSchema,
  ToolProfileIdSchema,
  ToolRegistryEntrySchema,
  ToolResultEnvelopeSchema,
  WorkloadClassSchema,
  parseCoreSchema,
  type CoreSchemaName,
} from '../src/core.ts';

const at = (s: string) => s;
const HASH = `sha256:${'ab'.repeat(32)}`;

const toolMeta = {
  name: 'get_asset_identity',
  version: '1.0.0',
  title: 'Get asset identity',
  description: 'Resolve canonical identity for a candidate asset.',
  actionClass: 'EXTERNAL_READ',
  profiles: ['discovery', 'market-research'],
  requiredScopes: ['assets:read'],
  cachePolicyId: 'exact-default',
  quotaPolicyId: 'strict-free-default',
  licensePolicyId: 'rights-verified-only',
  estimatedCost: { declaredBy: 'fixture' },
  inputSchemaJson: { type: 'object' },
  outputSchemaJson: { type: 'object' },
};

const meta = {
  toolName: 'get_asset_identity',
  toolVersion: '1.0.0',
  evidenceIds: ['ev1'],
  fetchedAt: at('2026-08-01T00:00:10Z'),
  cache: 'MISS',
  qualityCodes: [],
  conflicts: [],
  quota: {
    quotaModel: 'REQUESTS_PER_PERIOD',
    reservationState: 'COMMITTED',
    estimatedUnits: 1,
    actualUnits: 1,
  },
  partial: false,
};

describe('vocabulary mirrors equal the domain §16 constants by construction', () => {
  const parity = [
    { schema: ActionClassSchema, all: ALL_ACTION_CLASSES },
    { schema: WorkloadClassSchema, all: ALL_WORKLOAD_CLASSES },
    { schema: CacheOutcomeSchema, all: ALL_CACHE_OUTCOMES },
    { schema: QuotaModelSchema, all: ALL_QUOTA_MODELS },
    { schema: ReservationStateSchema, all: ALL_RESERVATION_STATES },
    { schema: BackpressureActionSchema, all: ALL_BACKPRESSURE_ACTIONS },
    { schema: HolderModeSchema, all: ALL_HOLDER_MODES },
    { schema: ToolProfileIdSchema, all: ALL_TOOL_PROFILE_IDS },
    { schema: PipelineStageSchema, all: ALL_PIPELINE_STAGES },
  ] as const;

  it.each(parity)('$schema.description accepts exactly the domain set', ({ schema, all }) => {
    expect(schema.options).toEqual(all);
  });
});

describe('accept matrices (round-trip stability)', () => {
  it.each([
    ['ToolDefinitionMetadata', ToolDefinitionMetadataSchema, toolMeta],
    [
      'ToolRegistryEntry',
      ToolRegistryEntrySchema,
      {
        toolName: 'get_asset_identity',
        toolVersion: '1.0.0',
        definitionHash: HASH,
        actionClass: 'EXTERNAL_READ',
        profiles: ['discovery'],
        requiredScopes: ['assets:read'],
        cachePolicyId: 'exact-default',
        quotaPolicyId: 'strict-free-default',
        licensePolicyId: 'rights-verified-only',
        registeredAt: at('2026-08-01T00:00:00Z'),
        retiredAt: null,
      },
    ],
    [
      'ToolResultEnvelope',
      ToolResultEnvelopeSchema,
      {
        data: { identity: 'resolved' },
        meta: {
          ...meta,
          provider: 'gmgn',
          operation: 'token_security',
          observedAt: at('2026-08-01T00:00:05Z'),
          availableAt: at('2026-08-01T00:00:05Z'),
          freshnessSeconds: 30,
        },
      },
    ],
    [
      'ProviderConflictRef',
      ProviderConflictRefSchema,
      {
        conflictId: 'cf1',
        providers: ['gmgn', 'helius'],
        fieldPath: 'holderCount',
        evidenceIds: ['ev1', 'ev2'],
      },
    ],
    [
      'CacheKeyComponents',
      CacheKeyComponentsSchema,
      {
        provider: 'gmgn',
        operation: 'token_security',
        operationVersion: '2',
        chain: 'solana',
        canonicalEntityIdentity: 'solana:So11111111111111111111111111111111111111112',
        normalizedArguments: { window: '24h' },
        fieldProjection: ['price', 'liquidity'],
        asOf: at('2026-08-01T00:00:00Z'),
        licensePolicyVersion: 'rights-1',
      },
    ],
    [
      'SingleFlightLeaseRecord',
      SingleFlightLeaseRecordSchema,
      {
        resourceKeyHash: HASH,
        fencingToken: 3,
        holderMode: 'MCP_MANUAL',
        holderId: 'client-7',
        acquiredAt: at('2026-08-01T00:00:00Z'),
        expiresAt: at('2026-08-01T00:01:00Z'),
        releasedAt: null,
      },
    ],
    [
      'ExactCacheEntryRecord',
      ExactCacheEntryRecordSchema,
      {
        cacheKeyHash: HASH,
        payloadRef: 'artifact://cache/abc',
        storedAt: at('2026-08-01T00:00:00Z'),
        freshUntil: at('2026-08-01T00:00:30Z'),
        staleUntil: at('2026-08-01T00:02:00Z'),
        licensePolicyVersion: 'rights-1',
        rightsPermitted: true,
      },
    ],
    [
      'QuotaReservationRecord',
      QuotaReservationRecordSchema,
      {
        reservationId: 'rsv1',
        pipelineRunId: 'run1',
        stage: 'ATOMICALLY_RESERVE_QUOTA',
        actorId: 'actor-9',
        provider: 'gmgn',
        operation: 'token_security',
        workloadClass: 'INTERACTIVE_HIGH',
        estimatedUnits: 2,
        actualUnits: null,
        state: 'RESERVED',
        createdAt: at('2026-08-01T00:00:00Z'),
        reservedAt: at('2026-08-01T00:00:01Z'),
        settledAt: null,
      },
    ],
    [
      'LicenseVerdict',
      LicenseVerdictSchema,
      { allowed: true, policyVersion: 'rights-1', reason: 'rights verified' },
    ],
    [
      'BlockedStatePayload',
      BlockedStatePayloadSchema,
      {
        acquisitionState: 'QUOTA_BLOCKED',
        machineReason: 'protected reserve exhausted for provider gmgn',
        toolName: 'get_market_evidence_pack',
        toolVersion: '1.0.0',
        pipelineRunId: 'run1',
        at: at('2026-08-01T00:00:00Z'),
      },
    ],
  ] as const)('%s accepts its fixture and round-trips byte-stable', (_name, schema, fixture) => {
    const parsed = schema.parse(fixture);
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});

describe('refuse matrix', () => {
  it('refuses PROHIBITED_FINANCIAL definitions structurally', () => {
    expect(() =>
      ToolDefinitionMetadataSchema.parse({ ...toolMeta, actionClass: 'PROHIBITED_FINANCIAL' }),
    ).toThrow();
  });

  it('refuses every strict object gaining an unknown key', () => {
    expect(() => ToolDefinitionMetadataSchema.parse({ ...toolMeta, execute: 'fn' })).toThrow();
    expect(() => ToolResultEnvelopeSchema.parse({ data: 1, meta, surprise: true })).toThrow();
  });

  it('refuses envelope meta missing any mandated §16.3 field', () => {
    for (const key of [
      'toolName',
      'toolVersion',
      'evidenceIds',
      'fetchedAt',
      'cache',
      'qualityCodes',
      'conflicts',
      'quota',
      'partial',
    ] as const) {
      const broken: Record<string, unknown> = { ...meta };
      delete broken[key];
      expect(() => ToolResultEnvelopeSchema.parse({ data: 1, meta: broken })).toThrow(key);
    }
  });

  it('refuses cache keys missing one of the nine mandated components', () => {
    const key: Record<string, unknown> = {
      provider: 'p',
      operation: 'o',
      operationVersion: '1',
      chain: 'c',
      canonicalEntityIdentity: 'e',
      normalizedArguments: {},
      fieldProjection: [],
      asOf: at('2026-08-01T00:00:00Z'),
      licensePolicyVersion: 'l',
    };
    for (const component of Object.keys(key)) {
      const broken: Record<string, unknown> = { ...key };
      delete broken[component];
      expect(() => CacheKeyComponentsSchema.parse(broken)).toThrow(component);
    }
  });

  it('refuses non-sha256 hashes and zero fencing tokens', () => {
    expect(() =>
      SingleFlightLeaseRecordSchema.parse({
        resourceKeyHash: 'deadbeef',
        fencingToken: 1,
        holderMode: 'AUTOMATION',
        holderId: 'x',
        acquiredAt: at('2026-08-01T00:00:00Z'),
        expiresAt: at('2026-08-01T00:01:00Z'),
        releasedAt: null,
      }),
    ).toThrow();
    expect(() =>
      SingleFlightLeaseRecordSchema.parse({
        resourceKeyHash: HASH,
        fencingToken: 0,
        holderMode: 'AUTOMATION',
        holderId: 'x',
        acquiredAt: at('2026-08-01T00:00:00Z'),
        expiresAt: at('2026-08-01T00:01:00Z'),
        releasedAt: null,
      }),
    ).toThrow();
  });

  it('refuses blocked-state payloads carrying retrieval-success states', () => {
    expect(() =>
      BlockedStatePayloadSchema.parse({
        acquisitionState: 'RETURNED',
        machineReason: 'x',
        toolName: 't',
        toolVersion: '1.0.0',
        pipelineRunId: 'r',
        at: at('2026-08-01T00:00:00Z'),
      }),
    ).toThrow();
    // REQUESTED is a pre-execution persistence state, not a blocked exit.
    expect(() =>
      BlockedStatePayloadSchema.parse({
        acquisitionState: 'REQUESTED',
        machineReason: 'x',
        toolName: 't',
        toolVersion: '1.0.0',
        pipelineRunId: 'r',
        at: at('2026-08-01T00:00:00Z'),
      }),
    ).toThrow();
  });
});

describe('registry map + parse-by-name', () => {
  it('exposes every core schema under a stable name', () => {
    expect(Object.keys(CORE_SCHEMAS).sort()).toEqual(
      [
        'BlockedStatePayload',
        'CacheKeyComponents',
        'ExactCacheEntryRecord',
        'LicenseVerdict',
        'ProviderConflictRef',
        'QuotaReservationRecord',
        'QuotaUsageSummary',
        'SingleFlightLeaseRecord',
        'ToolDefinitionMetadata',
        'ToolRegistryEntry',
        'ToolResultEnvelope',
        'ToolResultMeta',
      ].sort(),
    );
  });

  it('parses by name through the generic boundary entrypoint', () => {
    expect(
      parseCoreSchema('LicenseVerdict' as CoreSchemaName, {
        allowed: false,
        policyVersion: 'rights-1',
        reason: 'unverifiable rights refuse fail-closed',
      }).allowed,
    ).toBe(false);
    expect(() => parseCoreSchema('LicenseVerdict' as CoreSchemaName, {})).toThrow();
  });
});
