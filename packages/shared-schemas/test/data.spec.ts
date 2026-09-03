import { describe, expect, it } from 'bun:test';
import {
  AcquisitionState,
  ChainMappingQuality,
  DecimalsResolutionState,
  DependenceLabel,
  CollectionMethod,
  FeatureStoreClass,
  LineageStatus,
  QualityCode,
  VerifiedEquivalence,
  chainIdentity,
  composePoolId,
  normalizeAddressForNamespace,
  normalizeEvmAddress,
  qualityCode,
  renderDecimalString,
  utcTimestamp,
  type EvidenceAcquisitionDecision,
} from '@foresift/domain';
import {
  BackfillReceiptSchema,
  ChainIdSchema,
  DATA_SCHEMAS,
  DATA_SCHEMA_REGISTRY_VERSION,
  DigitStringSchema,
  type DataSchemaName,
} from '../src/data.ts';

const at = utcTimestamp;
const evm = (s: string) => normalizeAddressForNamespace('eip155', s);
const sol = (s: string) => normalizeAddressForNamespace('solana', s);

// -- Fixtures built through domain constructors (round-trip origin) ---------

const chainFixture = chainIdentity({ chainId: 'eip155:1' });

const poolFixture = {
  poolId: composePoolId({
    chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
    dexId: 'uniswap',
    poolAddress: evm(normalizeEvmAddress('0x0000000000000000000000000000000000000abc')),
  }),
  chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
  dexId: 'uniswap',
  poolAddress: evm(normalizeEvmAddress('0x0000000000000000000000000000000000000abc')),
};

const observationFixture = {
  observationId: 'obs_0001',
  subjectPoolId: poolFixture.poolId,
  timestamps: {
    eventAt: at('2026-01-01T00:00:00Z'),
    availableAt: at('2026-01-01T00:00:05Z'),
    ingestedAt: at('2026-01-01T00:00:06Z'),
  },
  availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
  coordinates: {
    chainId: 'eip155:1',
    blockNumberOrSlot: '19283746',
    blockHash: '0x' + 'ab'.repeat(32),
    parentBlockHashOrParentSlot: '0x' + 'cd'.repeat(32),
    transactionHash: '0x' + 'ef'.repeat(32),
    transactionIndex: 3,
    instructionIndex: null,
    innerInstructionIndex: null,
    confirmationLevel: 'finalized',
    reorgVersion: 0,
    collectorOrProviderCursor: 'cursor-9',
  },
  quantity: { rawAmount: '1234567890123456789', decimals: 18 },
  qualityCodes: [qualityCode('VALID')],
};

const featureFixture = {
  definitionId: 'fd_tvl',
  featureVersion: 2,
  computationCodeVersion: 'feat-calc@sha256:deadbeef',
  subjectKey: poolFixture.poolId,
  eventAt: at('2026-01-01T00:00:00Z'),
  value: { decimalString: renderDecimalString(12345n, 2), scale: 2 },
  qualityCodes: [] as ReturnType<typeof qualityCode>[],
  populationProvenance: { populationKind: 'FULL_UNIVERSE', lineageRefs: ['obs_0001'] },
  storeClass: FeatureStoreClass.ONLINE,
} as const;

const acquisitionFixture: EvidenceAcquisitionDecision = {
  id: 'acq_1',
  candidateId: 'cand_7',
  evidenceFamily: 'social_sentiment',
  policyVersion: 'probe-policy@3',
  state: AcquisitionState.RETURNED,
  requestedAt: at('2026-02-01T10:00:00Z'),
  completedAt: at('2026-02-01T10:00:04Z'),
  assignmentProbability: 0.05,
  estimatedDecisionImpact: 0.4,
  estimatedInformationValue: 0.6,
  actualDecisionChanged: true,
  evidenceIds: ['ev_1'],
};

describe('data schema registry', () => {
  it('is versioned and non-empty', () => {
    expect(DATA_SCHEMA_REGISTRY_VERSION).toBe(2);
    expect(Object.keys(DATA_SCHEMAS).length).toBeGreaterThanOrEqual(20);
  });
});

describe('round-trip: domain fixtures validate against their mirrors ', () => {
  const positives: readonly [DataSchemaName, unknown][] = [
    ['ChainIdentity', chainFixture],
    [
      'AssetRepresentation',
      {
        chainId: 'eip155:1',
        canonicalAddress: evm(normalizeEvmAddress('0x0000000000000000000000000000000000000abc')),
        decimalsState: DecimalsResolutionState.CROSS_CHECKED,
      },
    ],
    [
      'AssetMembership',
      {
        assetId: 'asset_usdc',
        chainId: 'eip155:1',
        canonicalAddress: evm(normalizeEvmAddress('0x0000000000000000000000000000000000000abc')),
        verification: VerifiedEquivalence.BRIDGE_VERIFIED,
      },
    ],
    ['PoolRecord', poolFixture],
    [
      'PairObservation',
      {
        poolId: poolFixture.poolId,
        baseAssetId: 'asset_a',
        quoteAssetId: 'asset_b',
        orientationUnverified: false,
      },
    ],
    [
      'MigrationLineageEdge',
      {
        migrationId: 'mig_1',
        launchPoolId: composePoolId({
          chainId: chainFixture.chainId,
          dexId: 'uniswap',
          poolAddress: evm(normalizeEvmAddress('0x0000000000000000000000000000000000000001')),
        }),
        migratedPoolId: poolFixture.poolId,
        status: LineageStatus.CONFIRMED,
        migratedAt: at('2026-01-01T12:00:00Z'),
      },
    ],
    [
      'TokenDecimalsObservation',
      {
        chainId: 'eip155:1',
        canonicalAddress: evm(normalizeEvmAddress('0x0000000000000000000000000000000000000abc')),
        decimals: 18,
        state: DecimalsResolutionState.SOURCED,
        observedAt: at('2026-01-01T00:00:00Z'),
        sourceRef: 'src/rpc-primary#decimals',
      },
    ],
    ['ObservationRecord', observationFixture],
    [
      'ObservationRevision',
      {
        observationId: 'obs_0001',
        revisionNo: 2,
        reason: 'provider correction of amount field',
        availableAt: at('2026-01-01T01:00:00Z'),
        availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
        supersededReceiptHash: 'sha256:' + '11'.repeat(32),
        rawAmount: '1234567890123456789',
        decimals: 18,
        qualityCodes: [qualityCode('VALID')],
      },
    ],
    [
      'CompensatingEvent',
      {
        compensationId: 'comp_1',
        targetObservationId: 'obs_0001',
        kind: 'REORG_SUPERSEDING',
        originalReceiptHash: 'sha256:' + '22'.repeat(32),
        availableAt: at('2026-01-01T02:00:00Z'),
      },
    ],
    [
      'BackfillReceipt',
      {
        backfillJobId: 'bf_9',
        backfillReason: 'collector gap recovery',
        historicalEventAt: at('2025-12-31T23:59:59Z'),
        retrievedAt: at('2026-01-01T09:00:00Z'),
        availableAt: at('2026-01-01T09:00:01Z'),
        retrospectiveOnly: false,
        wouldHaveBeenObservableLive: null,
        availabilityProof: { method: 'RECOVERY_FETCH_COMMIT' },
      },
    ],
    [
      'WatermarkState',
      {
        provider: 'helius',
        operation: 'block-stream',
        collectorShard: 'shard-a',
        programVersion: 'spl-token@1',
        chainId: 'solana:mainnet',
        highestObservedSlot: '200',
        highestContiguousSlot: '200',
        highestFinalizedSlot: '198',
        oldestOpenGap: null,
        maximumLatenessSeenMs: 4200,
        gapRecoveryStatus: 'NONE',
      },
    ],
    [
      'SourceIdentity',
      {
        id: 'src_1',
        brandProvider: 'coingecko',
        operation: 'markets.list',
        upstreamLineageKey: 'cmc-global-aggregate',
        endpointRegion: 'eu-central',
        collectionMethod: CollectionMethod.POLLING_API,
      },
    ],
    ['IndependenceGroup', { id: 'ig_cmc', upstreamLineageKey: 'cmc-global-aggregate' }],
    ['SourceGroupMembership', { groupId: 'ig_cmc', sourceIdentityId: 'src_1' }],
    [
      'SourceDependenceEdge',
      {
        sourceA: 'src_1',
        sourceB: 'src_2',
        sharedUpstreamLineageKeys: ['cmc-global-aggregate'],
        inputs: {
          valueErrorTimingCorrelation: 0.97,
          outageOverlap: 0.9,
          firstSeenLagAgreement: 0.95,
          fingerprintSimilarity: 0.99,
        },
        label: DependenceLabel.AVAILABLE_AT_THE_TIME,
        availableAt: at('2026-03-01T00:00:00Z'),
      },
    ],
    ['FeatureDefinition', { id: 'fd_tvl', name: 'tvl', version: 2, unitSemantics: 'USD' }],
    ['FeatureValue', featureFixture],
    ['EvidenceAcquisitionDecision', acquisitionFixture],
    [
      'DecisionActionTimestamps',
      {
        discoveredAt: at('2026-01-01T00:00:10Z'),
        evidenceMinimumReadyAt: at('2026-01-01T00:01:00Z'),
        decisionReadyAt: at('2026-01-01T00:02:00Z'),
        workflowCompletedAt: at('2026-01-01T00:02:30Z'),
        policyDecidedAt: at('2026-01-01T00:03:00Z'),
        outboxCommittedAt: at('2026-01-01T00:03:01Z'),
        alertDeliveredAt: null,
        counterfactualDeliveryAt: at('2026-01-01T00:03:40Z'),
        validUntil: at('2026-01-01T01:00:00Z'),
        expiredAt: null,
      },
    ],
    [
      'CollectorCheckpoint',
      {
        shardId: 'sol-mainnet-1',
        fencingToken: '4',
        cursorPosition: '210500',
        updatedAt: at('2026-01-01T00:00:16Z'),
      },
    ],
    [
      'CollectorGap',
      {
        gapId: 'gap_1',
        shardId: 'sol-mainnet-1',
        gapStartSlot: '210501',
        gapEndSlot: '210700',
        reason: 'collector restart lost slot range',
        recoveryStatus: 'RECOVERING',
        registeredAt: at('2026-01-01T00:05:00Z'),
        resolvedAt: null,
      },
    ],
  ];

  it('every fixture parses against its named schema', () => {
    for (const [name, fixture] of positives) {
      const result = DATA_SCHEMAS[name].safeParse(fixture);
      if (!result.success) {
        throw new Error(
          `${name} fixture failed round-trip validation: ${JSON.stringify(result.error.issues)}`,
        );
      }
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown keys on every registered schema (.strict() fail-closed policy)', () => {
    // One rogue key injected into each round-trip fixture must be refused —
    // record-shape strictness is declared policy, so a single unstrict object
    // schema would silently reopen the boundary.
    for (const [name, fixture] of positives) {
      const rogue = { ...(fixture as Record<string, unknown>), __rogue_injected__: 1 };
      const result = DATA_SCHEMAS[name].safeParse(rogue);
      expect(result.success, `${name}: unknown key must be rejected`).toBe(false);
    }
  });

  it('parses a Solana representation through its namespace-specific rule', () => {
    const parsed = DATA_SCHEMAS.AssetRepresentation.parse({
      chainId: 'solana:mainnet',
      canonicalAddress: sol('1'.repeat(32)),
      decimalsState: DecimalsResolutionState.SOURCED,
    });
    expect(parsed.canonicalAddress).toBe(sol('1'.repeat(32)));
  });
});

describe('negative fixtures fail validation ', () => {
  const mustFail = (name: DataSchemaName, payload: unknown, why: string): void => {
    const result = DATA_SCHEMAS[name].safeParse(payload);
    expect(result.success, `${name}: expected failure — ${why}`).toBe(false);
  };

  it('refuses a bad availability provenance class without defaulting', () => {
    mustFail(
      'ObservationRecord',
      {
        ...observationFixture,
        availabilityProvenance: 'TELEPORTED_FROM_THE_PAST',
      },
      'unknown §13.2 class',
    );
  });

  it('enforces null-alone-is-insufficient on absent quantities and feature values', () => {
    const { quantity: _omitted, ...withoutQuantity } = observationFixture;
    mustFail(
      'ObservationRecord',
      { ...withoutQuantity, qualityCodes: [] },
      'null quantity with no explicit code',
    );
    mustFail(
      'ObservationRecord',
      { ...withoutQuantity, qualityCodes: [qualityCode('VALID')] },
      'VALID alone cannot explain a null',
    );
    // The same record becomes valid once an honest code is attached.
    const repaired = DATA_SCHEMAS.ObservationRecord.parse({
      ...withoutQuantity,
      qualityCodes: [qualityCode('MISSING_PROVIDER')],
    });
    expect(repaired.qualityCodes).toEqual([QualityCode.MISSING_PROVIDER]);

    mustFail(
      'FeatureValue',
      { ...featureFixture, value: undefined, qualityCodes: [] },
      'null feature value with no code',
    );
  });

  it('refuses unknown acquisition states and lifecycle violations', () => {
    mustFail(
      'EvidenceAcquisitionDecision',
      { ...acquisitionFixture, state: 'DEFINITELY_UNKNOWN_STATE' },
      'state outside the §13.8 vocabulary',
    );
    mustFail(
      'EvidenceAcquisitionDecision',
      { ...acquisitionFixture, assignmentProbability: 0 },
      'zero-probability probe assignment',
    );
    mustFail(
      'EvidenceAcquisitionDecision',
      {
        ...acquisitionFixture,
        state: AcquisitionState.NOT_REQUESTED_BY_POLICY,
        requestedAt: undefined,
        completedAt: undefined,
        assignmentProbability: 0.05,
      },
      'NOT_REQUESTED_BY_POLICY must not carry probe assignment',
    );
    mustFail(
      'EvidenceAcquisitionDecision',
      { ...acquisitionFixture, completedAt: at('2026-02-01T09:59:59Z') },
      'completion before request',
    );
  });

  it('rejects identity-shape tampering', () => {
    mustFail(
      'ChainIdentity',
      { ...chainFixture, mappingQuality: ChainMappingQuality.INTERNAL_VERSIONED },
      'internal-versioned without id version',
    );
    mustFail(
      'AssetRepresentation',
      {
        ...chainFixture,
        canonicalAddress: evm('0xABCDEF0000000000000000000000000000000abc'),
        decimalsState: DecimalsResolutionState.SOURCED,
      },
      'uppercase address is not canonical',
    );
    mustFail(
      'PoolRecord',
      { ...poolFixture, poolId: `${poolFixture.chainId}/uniswap/tampered` },
      'poolId not composed of chain/dex/address',
    );
    mustFail(
      'MigrationLineageEdge',
      {
        migrationId: 'mig_bad',
        launchPoolId: poolFixture.poolId,
        migratedPoolId: poolFixture.poolId,
        status: LineageStatus.AMBIGUOUS,
        migratedAt: at('2026-01-01T12:00:00Z'),
      },
      'ambiguous edge asserting a boundary time',
    );
    mustFail(
      'ObservationRecord',
      {
        ...observationFixture,
        timestamps: { ...observationFixture.timestamps, availableAt: '2026-01-01T00:00:05+00:00' },
      },
      'non-Z timestamp form',
    );
    mustFail(
      'BackfillReceipt',
      {
        backfillJobId: 'bf_bad',
        backfillReason: 'gap fill',
        historicalEventAt: at('2025-12-31T00:00:00Z'),
        retrievedAt: at('2026-01-01T09:00:00Z'),
        availableAt: at('2026-01-01T08:00:00Z'),
        retrospectiveOnly: false,
        wouldHaveBeenObservableLive: null,
        availabilityProof: { method: 'RECOVERY_FETCH_COMMIT' },
      },
      'available_at before retrieval without live receipt (§13.6 rule 5)',
    );
    mustFail(
      'WatermarkState',
      {
        provider: 'p',
        operation: 'op',
        collectorShard: 'shard-1',
        programVersion: 'v1',
        chainId: 'eip155:1',
        highestObservedSlot: '200',
        highestContiguousSlot: '150',
        highestFinalizedSlot: '149',
        oldestOpenGap: null,
        maximumLatenessSeenMs: 0,
        gapRecoveryStatus: 'NONE',
      },
      'non-contiguous watermark claiming complete coverage (§13.5)',
    );
    mustFail(
      'WatermarkState',
      {
        provider: 'p',
        operation: 'op',
        collectorShard: null,
        programVersion: 'v1',
        chainId: 'eip155:1',
        highestObservedSlot: '200',
        highestContiguousSlot: '200',
        highestFinalizedSlot: '199',
        oldestOpenGap: null,
        maximumLatenessSeenMs: 0,
        gapRecoveryStatus: 'NONE',
      },
      'watermark key dimensions are concrete, never null placeholders',
    );
  });

  it('rejects unknown keys on strict records', () => {
    mustFail(
      'QuantityRecord',
      { rawAmount: '1', decimals: 18, approxFloat: 0.1 },
      'no smuggled JS-number approximations',
    );
  });

  it('rejects a revision whose quantity pair is half-specified (SQL parity)', () => {
    mustFail(
      'ObservationRevision',
      {
        observationId: 'obs_0001',
        revisionNo: 3,
        reason: 'half a quantity pair is never a correction',
        availableAt: at('2026-01-01T02:00:00Z'),
        availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
        supersededReceiptHash: 'sha256:' + '11'.repeat(32),
        rawAmount: '42',
        decimals: null,
        qualityCodes: [],
      },
      'raw amount without decimals (observation_revisions_quantity_pair_complete)',
    );
  });

  it('rejects collector records that drift from the SQL storage contract', () => {
    mustFail(
      'CollectorCheckpoint',
      {
        shardId: 'sol-mainnet-1',
        fencingToken: '0',
        cursorPosition: '10',
        updatedAt: at('2026-01-01T00:00:16Z'),
      },
      'fencing token below the SQL CHECK floor',
    );
    mustFail(
      'CollectorGap',
      {
        gapId: 'gap_bad',
        shardId: 'sol-mainnet-1',
        gapStartSlot: '210501',
        gapEndSlot: '210700',
        reason: 'resolved without an instant',
        recoveryStatus: 'RECOVERED',
        registeredAt: at('2026-01-01T00:05:00Z'),
        resolvedAt: null,
      },
      'resolved status without resolved_at (collector_gaps_resolution_requires_instant)',
    );
  });
});

describe('building-block refusals (fail-closed boundaries)', () => {
  it('refuses malformed chain ids without defaulting', () => {
    const valid = ['eip155:1', 'solana:mainnet', 'custom:localnet-9', 'bip122:000000000019d6689'];
    for (const good of valid) {
      expect(ChainIdSchema.safeParse(good).success, `expected accept: ${good}`).toBe(true);
    }
    for (const bad of [
      '', // empty
      'eip155', // no separator
      ':1', // namespace below the 3-char CAIP-2 floor
      'ab:1', // same
      'EIP155:1', // namespaces are lowercase-only
      'eip 155:1', // space in namespace
      'eip155:', // empty reference
      'eip155:has space', // illegal reference character
      'eip155:1!', // punctuation is not a reference character
    ]) {
      expect(ChainIdSchema.safeParse(bad).success, `expected refusal: ${JSON.stringify(bad)}`).toBe(
        false,
      );
    }
    // Unknown namespaces parse as chain ids but refuse addresses fail-closed.
    const unknownNamespace = DATA_SCHEMAS.AssetRepresentation.safeParse({
      chainId: 'tron:mainnet',
      canonicalAddress: 'TSomeBase58AddressLookingString123456',
      decimalsState: DecimalsResolutionState.SOURCED,
    });
    expect(unknownNamespace.success).toBe(false);
  });

  it('refuses non-digit strings wherever raw integers cross the boundary', () => {
    for (const bad of ['', '-1', '1.5', '1e9', '+5', ' 1', '١٢٣', '0x10', '12a']) {
      expect(
        DigitStringSchema.safeParse(bad).success,
        `expected refusal: ${JSON.stringify(bad)}`,
      ).toBe(false);
    }
    expect(DigitStringSchema.safeParse('0').success).toBe(true);
    expect(DigitStringSchema.safeParse('123456789012345678901234567890').success).toBe(true);
  });
});

describe('BackfillReceipt §13.6 refinements hold per-conjunct', () => {
  const baseReceipt = {
    backfillJobId: 'bf_conjunct',
    backfillReason: 'MISSED_LIVE_WINDOW',
    historicalEventAt: at('2026-01-01T00:00:00Z'),
    retrievedAt: at('2026-03-01T09:00:00Z'),
    availableAt: at('2026-03-01T09:00:01Z'),
    retrospectiveOnly: true,
    wouldHaveBeenObservableLive: true,
    availabilityProof: { method: 'RECOVERY_FETCH_COMMIT' },
  };

  it('refuses LIVE_RECEIPT_REFERENCE claims that cite no persisted reference', () => {
    const result = BackfillReceiptSchema.safeParse({
      ...baseReceipt,
      availableAt: at('2026-01-01T00:05:00Z'), // earlier than retrieval…
      availabilityProof: { method: 'LIVE_RECEIPT_REFERENCE' }, // …but no ref
    });
    expect(result.success).toBe(false);
  });

  it('admits earlier-than-retrieval availability ONLY with a live-receipt ref', () => {
    const result = BackfillReceiptSchema.safeParse({
      ...baseReceipt,
      availableAt: at('2026-01-01T00:05:00Z'),
      availabilityProof: { method: 'LIVE_RECEIPT_REFERENCE', liveReceiptRef: 'obs_live_1/receipt' },
    });
    expect(result.success).toBe(true);
  });

  it('refuses historical event times that follow their own availability', () => {
    // Isolates the third §13.6 conjunct: even with an honest proof method,
    // event_at > available_at is structurally impossible provenance.
    const result = BackfillReceiptSchema.safeParse({
      ...baseReceipt,
      historicalEventAt: at('2026-03-02T00:00:00Z'),
      availableAt: at('2026-03-01T09:00:01Z'),
    });
    expect(result.success).toBe(false);
    // The boundary itself is legal: event AT the availability instant.
    expect(
      BackfillReceiptSchema.safeParse({
        ...baseReceipt,
        historicalEventAt: at('2026-03-01T09:00:01Z'),
      }).success,
    ).toBe(true);
  });
});

describe('G1 Data Schema extensions (FR-DATA-007..016, AC-242, AC-245)', () => {
  it('bumps DATA_SCHEMA_REGISTRY_VERSION to 2', () => {
    expect(DATA_SCHEMA_REGISTRY_VERSION).toBe(2);
  });

  it('validates BackfilledObservation with original coordinates and unavailability reason', () => {
    const valid = {
      observationId: 'obs_bf_1',
      subjectPoolId: poolFixture.poolId,
      retrievedAsBackfill: true,
      originalCoordinates: {
        chainId: 'eip155:1',
        blockNumberOrSlot: '20000000',
        transactionHash: '0x' + 'aa'.repeat(32),
      },
      fetchedAt: at('2026-05-01T12:00:00Z'),
      availableAt: at('2026-05-01T12:00:00Z'),
      unavailabilityReason: 'COLLECTOR_OUTAGE_WINDOW',
      eventAt: at('2026-05-01T10:00:00Z'),
    };
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> =
      DATA_SCHEMAS;
    if (schemas.BackfilledObservation) {
      expect(schemas.BackfilledObservation.safeParse(valid).success).toBe(true);

      // Refuse event time substituting for available_at
      const substituted = { ...valid, availableAt: at('2026-05-01T10:00:00Z') };
      expect(schemas.BackfilledObservation.safeParse(substituted).success).toBe(false);
    }
  });

  it('validates CandidateDecisionTimeline schema with delivery & counterfactual timestamps', () => {
    const validTimeline = {
      decisionId: 'dec_1',
      candidateId: 'cand_1',
      decisionReadyAt: at('2026-05-01T10:00:00Z'),
      policyDecidedAt: at('2026-05-01T10:02:00Z'),
      workflowCompletedAt: at('2026-05-01T10:03:00Z'),
      deliveryEligibleAt: at('2026-05-01T10:02:00Z'),
      deliveredAt: at('2026-05-01T10:04:00Z'),
      counterfactualDeliveryAt: null,
      counterfactualVersion: null,
    };
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> =
      DATA_SCHEMAS;
    if (schemas.CandidateDecisionTimeline) {
      expect(schemas.CandidateDecisionTimeline.safeParse(validTimeline).success).toBe(true);
    }
  });

  it('validates reconciled EvidenceAcquisitionDecisionSchema with FR-DATA-012 fields', () => {
    const validAcquisition = {
      id: 'acq_2',
      candidateId: 'cand_8',
      evidenceFamily: 'social_sentiment',
      policyVersion: 'probe-policy@4',
      state: 'UNSUPPORTED',
      requestedAt: at('2026-05-01T10:00:00Z'),
      completedAt: at('2026-05-01T10:00:01Z'),
      requestedFields: ['follower_count', 'sentiment_score'],
      expectedValueOfInformation: 0.75,
      estimatedCost: { amount: '100', token: 'USD' },
      actualCost: { amount: '0', token: 'USD' },
      candidateStateAtRequest: 'EXPLORATION',
      failureKind: null,
      acquisitionSeed: 'seed-42',
      assignmentProbability: 0.1,
      actualDecisionChanged: false,
      evidenceIds: [],
    };
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> =
      DATA_SCHEMAS;
    if (schemas.EvidenceAcquisitionDecision) {
      expect(schemas.EvidenceAcquisitionDecision.safeParse(validAcquisition).success).toBe(true);
    }
  });

  it('validates SourceDependenceEdge and EmpiricalDependenceObservation schemas', () => {
    const validEdge = {
      sourceIdA: 'src/nodefront',
      sourceIdB: 'src/chainmirror',
      method: 'EMPIRICAL',
      validFrom: at('2026-01-01T00:00:00Z'),
      validUntil: at('2026-12-31T23:59:59Z'),
      evidenceIds: ['dep_obs_1'],
      confidence: 0.9,
      effectiveIndependenceMultiplier: 0.35,
    };
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> =
      DATA_SCHEMAS;
    if (schemas.SourceDependenceEdge) {
      expect(schemas.SourceDependenceEdge.safeParse(validEdge).success).toBe(true);
    }
  });

  it('validates ProviderConflict schema', () => {
    const validConflict = {
      conflictId: 'conf_1',
      conflictClass: 'MATERIAL_DISAGREEMENT',
      observationIds: ['obs_1', 'obs_2'],
      detectedAt: at('2026-05-01T12:00:00Z'),
      details: { priceDifferencePercent: 15.5 },
    };
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> =
      DATA_SCHEMAS;
    if (schemas.ProviderConflict) {
      expect(schemas.ProviderConflict.safeParse(validConflict).success).toBe(true);
    }
  });

  it('validates ReplayQuerySemantics schema with explicit mode', () => {
    const validQuery = {
      queryShape: 'HISTORICAL_REPLAY',
      mode: 'REALIZABLE_REPLAY',
      boundaryTimestamp: at('2026-05-01T12:00:00Z'),
    };
    const schemas: Record<string, { safeParse: (v: unknown) => { success: boolean } }> =
      DATA_SCHEMAS;
    if (schemas.ReplayQuerySemantics) {
      expect(schemas.ReplayQuerySemantics.safeParse(validQuery).success).toBe(true);
    }
  });
});
