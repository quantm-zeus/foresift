/**
 * Versioned Zod schemas mirroring the domain data contracts — the manifest
 * schemaRefs for FR-DATA-001…006.
 *
 * These schemas are the runtime-validation boundary for records crossing
 * process/store boundaries (stored JSON, API payloads, telemetry). Where a
 * vocabulary exists in `@foresift/domain` it is imported, not restated —
 * quality codes, availability provenance classes, acquisition states, chain
 * mapping qualities, decimals states, equivalence kinds, lineage statuses,
 * dependence labels, collection methods, and feature-store classes are
 * compile-linked, so a domain change cannot drift from its schema mirror
 * without failing to compile. The remaining closed vocabularies below
 * (compensating-event kinds, availability proof methods, watermark gap
 * statuses, population kinds, checkpoint/gap statuses) are local literals
 * kept in parity with SQL truth by tests. Unknown keys are rejected
 * (`.strict()`) — fail-closed extends to record shape.
 *
 * Numeric policy: raw amounts cross boundaries as decimal digit STRINGS
 * (never JS numbers); timestamps as ISO-8601 UTC strings ending in `Z`.
 */
import { z } from 'zod';
import {
  ALL_ACQUISITION_STATES,
  ALL_AVAILABILITY_PROVENANCE_CLASSES,
  ALL_QUALITY_CODES,
  ChainMappingQuality,
  compareTimestamps,
  DecimalsResolutionState,
  DependenceLabel,
  CollectionMethod,
  FeatureStoreClass,
  LineageStatus,
  VerifiedEquivalence,
  composePoolId,
  isChainId,
  isSolanaAddress,
  isValidUtcTimestamp,
  nullRequiresExplicitCode,
  type AcquisitionState,
  type AvailabilityProvenanceClass,
  type QualityCode,
  type UtcTimestamp,
} from '@foresift/domain';

/**
 * Instant comparison inside refines: the values have already passed
 * `UtcTimestampSchema`, so the branded view is guaranteed at runtime — this
 * bridge only closes the Zod-inferred-`string` vs `UtcTimestamp` type gap.
 */
function compareStamps(a: string, b: string): number {
  return compareTimestamps(a as UtcTimestamp, b as UtcTimestamp);
}

/** Registry version — bumped only on breaking shape changes, never silently. */
export const DATA_SCHEMA_REGISTRY_VERSION = 1;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** ISO-8601 UTC timestamp (`Z` suffix), calendar-validated via the domain rule. */
export const UtcTimestampSchema = z
  .string()
  .refine(isValidUtcTimestamp, { message: 'expected ISO-8601 UTC timestamp ending in Z' });

/** CAIP-2-compatible chain id. */
export const ChainIdSchema = z.string().refine(isChainId, {
  message: 'not a CAIP-2-compatible chain id',
});

/**
 * Decimal-digit string carrying an unbounded integer (raw amounts, slots).
 * Note the deliberate asymmetry vs `DecimalStringSchema`: leading zeros are
 * ALLOWED here (slot/amount strings arrive zero-padded from sources), while
 * the §11.5 quantity policy forbids them in canonical decimal quantities.
 */
export const DigitStringSchema = z.string().regex(/^[0-9]+$/, 'expected decimal digit string');

/** Exact decimal string per the domain quantity policy: no leading zeros, optional fraction. */
export const DecimalStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/, 'expected canonical decimal string');

const qualityCodeValues = [...ALL_QUALITY_CODES] as [QualityCode, ...QualityCode[]];

/** §13.9 closed vocabulary — mirrored from the domain declaration. */
export const QualityCodeSchema = z.enum(qualityCodeValues);

export const QualityCodesSchema = z.array(QualityCodeSchema);

/**
 * "null alone is insufficient" (§13.9): a null/absent stored field MUST carry
 * at least one explicit code, and not merely VALID.
 */
export const nullAloneIsInsufficient = (codes: readonly QualityCode[]): boolean =>
  nullRequiresExplicitCode(codes);

const provenanceClassValues = [...ALL_AVAILABILITY_PROVENANCE_CLASSES] as [
  AvailabilityProvenanceClass,
  ...AvailabilityProvenanceClass[],
];

/** §13.2 availability provenance classes — mirrored from the domain declaration. */
export const AvailabilityProvenanceClassSchema = z.enum(provenanceClassValues);

// ---------------------------------------------------------------------------
// Identity (FR-DATA-001): chains, addresses, assets, pools, migrations
// ---------------------------------------------------------------------------

export const ChainIdentitySchema = z
  .object({
    chainId: ChainIdSchema,
    namespace: z.string().min(1),
    reference: z.string().min(1),
    mappingQuality: z.enum(
      Object.values(ChainMappingQuality) as [
        (typeof ChainMappingQuality)[keyof typeof ChainMappingQuality],
        ...(typeof ChainMappingQuality)[keyof typeof ChainMappingQuality][],
      ],
    ),
    internalIdVersion: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.mappingQuality !== ChainMappingQuality.INTERNAL_VERSIONED ||
      v.internalIdVersion !== undefined,
    { message: 'internal identifiers require an explicit id version' },
  );

export const EvmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, 'expected lowercase 20-byte hex address');

export const SolanaAddressSchema = z.string().refine(isSolanaAddress, {
  message: 'not a valid base58-encoded ed25519 program address',
});

/** Address shape must match the chain namespace; unknown namespaces fail closed. */
const addressMatchesNamespace = (chainId: string, canonicalAddress: string): boolean => {
  const namespace = chainId.slice(0, chainId.indexOf(':'));
  if (namespace === 'eip155') return EvmAddressSchema.safeParse(canonicalAddress).success;
  if (namespace === 'solana') return SolanaAddressSchema.safeParse(canonicalAddress).success;
  return false;
};

/** `(chain_id, canonical_address)` asset representation identity (§11.2). */
export const AssetRepresentationSchema = z
  .object({
    chainId: ChainIdSchema,
    canonicalAddress: z.string().min(1),
    decimalsState: z.enum(
      Object.values(DecimalsResolutionState) as [
        (typeof DecimalsResolutionState)[keyof typeof DecimalsResolutionState],
        ...(typeof DecimalsResolutionState)[keyof typeof DecimalsResolutionState][],
      ],
    ),
  })
  .strict()
  .refine((v) => addressMatchesNamespace(v.chainId, v.canonicalAddress), {
    message: 'canonical address does not match the chain namespace',
  });

/** Verified-equivalence membership edge; heuristic merges have no representation here. */
export const AssetMembershipSchema = z
  .object({
    assetId: z.string().min(1),
    chainId: ChainIdSchema,
    canonicalAddress: z.string().min(1),
    verification: z.enum(
      Object.values(VerifiedEquivalence) as [
        (typeof VerifiedEquivalence)[keyof typeof VerifiedEquivalence],
        ...(typeof VerifiedEquivalence)[keyof typeof VerifiedEquivalence][],
      ],
    ),
  })
  .strict()
  .refine((v) => addressMatchesNamespace(v.chainId, v.canonicalAddress), {
    message: 'canonical address does not match the chain namespace',
  });

/** `pool_id` = chain + DEX + pool address (§11.2/§11.4). */
export const PoolRecordSchema = z
  .object({
    poolId: z.string().min(1),
    chainId: ChainIdSchema,
    dexId: z.string().min(1),
    poolAddress: z.string().min(1),
  })
  .strict()
  .refine((v) => addressMatchesNamespace(v.chainId, v.poolAddress), {
    message: 'pool address does not match the chain namespace',
  })
  .refine(
    (v) =>
      composePoolId({ chainId: v.chainId, dexId: v.dexId, poolAddress: v.poolAddress }) ===
      v.poolId,
    {
      message: 'poolId must be exactly chainId/dexId/poolAddress',
    },
  );

/** A pair as observed on a specific pool; quote/base orientation may be unverified. */
export const PairObservationSchema = z
  .object({
    poolId: z.string().min(1),
    baseAssetId: z.string().min(1),
    quoteAssetId: z.string().min(1),
    orientationUnverified: z.boolean(),
  })
  .strict();

/** §11.6 migration lineage edge: launch_pool → migration_event → migrated_pool. */
export const MigrationLineageEdgeSchema = z
  .object({
    migrationId: z.string().min(1),
    launchPoolId: z.string().min(1),
    migratedPoolId: z.string().min(1),
    status: z.enum(
      Object.values(LineageStatus) as [
        (typeof LineageStatus)[keyof typeof LineageStatus],
        ...(typeof LineageStatus)[keyof typeof LineageStatus][],
      ],
    ),
    migratedAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .refine((v) => v.status !== 'CONFIRMED' || v.migratedAt !== undefined, {
    message: 'confirmed edges require a boundary time',
  })
  .refine((v) => v.status !== 'AMBIGUOUS' || v.migratedAt === undefined, {
    message: 'ambiguous edges must not assert a boundary time',
  });

/** One sourced token-decimals observation (decimals are sourced/cross-checked/versioned). */
export const TokenDecimalsObservationSchema = z
  .object({
    chainId: ChainIdSchema,
    canonicalAddress: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    state: z.enum(
      Object.values(DecimalsResolutionState) as [
        (typeof DecimalsResolutionState)[keyof typeof DecimalsResolutionState],
        ...(typeof DecimalsResolutionState)[keyof typeof DecimalsResolutionState][],
      ],
    ),
    observedAt: UtcTimestampSchema,
    sourceRef: z.string().min(1),
  })
  .strict()
  .refine((v) => addressMatchesNamespace(v.chainId, v.canonicalAddress), {
    message: 'canonical address does not match the chain namespace',
  });

// ---------------------------------------------------------------------------
// Observations, revisions, coordinates (FR-DATA-002)
// ---------------------------------------------------------------------------

/** §13.3 chain coordinates for on-chain observations. Absent parts stay null. */
export const ChainCoordinatesSchema = z
  .object({
    chainId: ChainIdSchema,
    blockNumberOrSlot: DigitStringSchema.nullable(),
    blockHash: z.string().min(1).nullable(),
    parentBlockHashOrParentSlot: z.string().min(1).nullable(),
    transactionHash: z.string().min(1).nullable(),
    transactionIndex: z.number().int().min(0).nullable(),
    instructionIndex: z.number().int().min(0).nullable(),
    innerInstructionIndex: z.number().int().min(0).nullable(),
    /** Deployment/config-controlled level (e.g. `confirmed`); never guessed. */
    confirmationLevel: z.string().min(1),
    reorgVersion: z.number().int().min(0),
    collectorOrProviderCursor: z.string().nullable(),
  })
  .strict();

/** §13.1 required timestamp set; absent fields are genuinely inapplicable. */
export const ObservationTimestampsSchema = z
  .object({
    eventAt: UtcTimestampSchema,
    sourceObservedAt: UtcTimestampSchema.optional(),
    sourcePublishedAt: UtcTimestampSchema.optional(),
    availableAt: UtcTimestampSchema,
    authorizedAt: UtcTimestampSchema.optional(),
    requestedAt: UtcTimestampSchema.optional(),
    fetchedAt: UtcTimestampSchema.optional(),
    ingestedAt: UtcTimestampSchema.optional(),
    finalizedAt: UtcTimestampSchema.optional(),
    revisedAt: UtcTimestampSchema.optional(),
  })
  .strict();

/** Raw integer amount + decimals — quantities never cross as JS numbers (§11.5). */
export const QuantityRecordSchema = z
  .object({
    rawAmount: DigitStringSchema,
    decimals: z.number().int().min(0).max(36),
  })
  .strict();

/** One immutable observation record (originals are never mutated in place). */
export const ObservationRecordSchema = z
  .object({
    observationId: z.string().min(1),
    subjectPoolId: z.string().min(1).optional(),
    subjectAssetId: z.string().min(1).optional(),
    timestamps: ObservationTimestampsSchema,
    availabilityProvenance: AvailabilityProvenanceClassSchema,
    coordinates: ChainCoordinatesSchema.optional(),
    quantity: QuantityRecordSchema.optional(),
    qualityCodes: QualityCodesSchema,
  })
  .strict()
  .refine((v) => v.quantity !== undefined || nullAloneIsInsufficient(v.qualityCodes), {
    message: 'null quantity requires at least one explicit quality code',
  });

/** A provider correction: new revision over an immutable original. */
export const ObservationRevisionSchema = z
  .object({
    observationId: z.string().min(1),
    revisionNo: z.number().int().min(1),
    reason: z.string().min(1),
    availableAt: UtcTimestampSchema,
    availabilityProvenance: AvailabilityProvenanceClassSchema,
    supersededReceiptHash: z.string().min(1),
    /** Corrected quantity, or explicit absence — never one half of the pair. */
    rawAmount: DigitStringSchema.nullable(),
    decimals: z.number().int().min(0).max(36).nullable(),
    qualityCodes: QualityCodesSchema,
  })
  .strict()
  .refine((v) => (v.rawAmount === null) === (v.decimals === null), {
    message: 'quantity pair incomplete: raw amount and decimals must be present or absent together',
  });

/** Reorg/finality compensation that supersedes without rewriting receipt history. */
export const CompensatingEventSchema = z
  .object({
    compensationId: z.string().min(1),
    targetObservationId: z.string().min(1),
    kind: z.enum(['REORG_SUPERSEDING', 'FINALITY_CORRECTION']),
    originalReceiptHash: z.string().min(1),
    availableAt: UtcTimestampSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Backfill receipts (§13.6) and watermarks (§13.5)
// ---------------------------------------------------------------------------

const AvailabilityProofMethodSchema = z.enum([
  'LIVE_RECEIPT_REFERENCE',
  'RECOVERY_FETCH_COMMIT',
  'MANUAL_IMPORT_RECEIPT',
]);

/**
 * §13.6 backfill receipt with the exact required fields plus the no-backdating
 * rules encoded structurally:
 * - `available_at >= retrieved_at` unless an independently persisted live
 *   receipt reference proves earlier availability;
 * - event time can never sit after availability.
 *
 * Note: availability provenance class is NOT restricted here — receipts may be
 * validated against any §13.2 class by callers; this schema enforces shape.
 */
export const BackfillReceiptSchema = z
  .object({
    backfillJobId: z.string().min(1),
    backfillReason: z.string().min(1),
    historicalEventAt: UtcTimestampSchema,
    retrievedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    retrospectiveOnly: z.boolean(),
    wouldHaveBeenObservableLive: z.boolean().nullable(),
    availabilityProof: z
      .object({
        method: AvailabilityProofMethodSchema,
        liveReceiptRef: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (v) =>
      v.availabilityProof.method !== 'LIVE_RECEIPT_REFERENCE' ||
      v.availabilityProof.liveReceiptRef !== undefined,
    { message: 'live-receipt proof requires a persisted receipt reference' },
  )
  .refine(
    (v) =>
      v.availabilityProof.method === 'LIVE_RECEIPT_REFERENCE' ||
      compareStamps(v.availableAt, v.retrievedAt) >= 0,
    { message: 'available_at precedes retrieval commit without a live receipt (backdating)' },
  )
  .refine((v) => compareStamps(v.historicalEventAt, v.availableAt) <= 0, {
    message: 'historical event time cannot follow its availability',
  });

/** §13.5 watermark state keyed by provider/operation/shard/program-version/chain. */
export const WatermarkStateSchema = z
  .object({
    provider: z.string().min(1),
    operation: z.string().min(1),
    /** Watermark key dimensions are always concrete — never null placeholders. */
    collectorShard: z.string().min(1),
    programVersion: z.string().min(1),
    chainId: ChainIdSchema,
    highestObservedSlot: DigitStringSchema,
    highestContiguousSlot: DigitStringSchema,
    highestFinalizedSlot: DigitStringSchema.nullable(),
    oldestOpenGap: z
      .object({ startSlot: DigitStringSchema, endSlot: DigitStringSchema })
      .strict()
      .nullable(),
    maximumLatenessSeenMs: z.number().int().min(0),
    gapRecoveryStatus: z.enum(['NONE', 'IN_PROGRESS', 'RECOVERED', 'ACCEPTED_LOSS']),
  })
  .strict()
  .refine(
    (v) =>
      // Non-contiguous watermarks cannot claim complete coverage: the gap interval
      // must be explicit (§13.5).
      BigInt(v.highestContiguousSlot) >= BigInt(v.highestObservedSlot) || v.oldestOpenGap !== null,
    { message: 'non-contiguous watermark requires an explicit open gap' },
  );

// ---------------------------------------------------------------------------
// Sources and dependence (FR-DATA-006)
// ---------------------------------------------------------------------------

export const SourceIdentitySchema = z
  .object({
    id: z.string().min(1),
    brandProvider: z.string().min(1),
    operation: z.string().min(1),
    upstreamLineageKey: z.string().min(1),
    endpointRegion: z.string().min(1),
    collectionMethod: z.enum(
      Object.values(CollectionMethod) as [
        (typeof CollectionMethod)[keyof typeof CollectionMethod],
        ...(typeof CollectionMethod)[keyof typeof CollectionMethod][],
      ],
    ),
  })
  .strict();

export const IndependenceGroupSchema = z
  .object({ id: z.string().min(1), upstreamLineageKey: z.string().min(1) })
  .strict();

export const SourceGroupMembershipSchema = z
  .object({ groupId: z.string().min(1), sourceIdentityId: z.string().min(1) })
  .strict();

export const DependenceObservationInputsSchema = z
  .object({
    valueErrorTimingCorrelation: z.number().min(-1).max(1),
    outageOverlap: z.number().min(0).max(1),
    firstSeenLagAgreement: z.number().min(0).max(1),
    fingerprintSimilarity: z.number().min(0).max(1),
  })
  .strict();

export const SourceDependenceEdgeSchema = z
  .object({
    sourceA: z.string().min(1),
    sourceB: z.string().min(1),
    sharedUpstreamLineageKeys: z.array(z.string().min(1)),
    inputs: DependenceObservationInputsSchema,
    label: z.enum(
      Object.values(DependenceLabel) as [
        (typeof DependenceLabel)[keyof typeof DependenceLabel],
        ...(typeof DependenceLabel)[keyof typeof DependenceLabel][],
      ],
    ),
    availableAt: UtcTimestampSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Features (FR-DATA-004)
// ---------------------------------------------------------------------------

/** Decimal value carried at an explicit scale; fraction digits must equal scale. */
export const DecimalValueSchema = z
  .object({
    decimalString: DecimalStringSchema,
    scale: z.number().int().min(0).max(36),
  })
  .strict()
  .refine((v) => (v.decimalString.split('.')[1] ?? '').length === v.scale, {
    message: 'fraction digits must equal the declared scale',
  });

export const PopulationProvenanceSchema = z
  .object({
    populationKind: z.enum([
      'FULL_UNIVERSE',
      'DEEP_RESEARCH_SELECTED',
      'CONTROL_GROUP',
      'EXPLORATION_ARM',
    ]),
    lineageRefs: z.array(z.string().min(1)),
  })
  .strict();

export const FeatureDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().min(1),
    unitSemantics: z.string().min(1),
  })
  .strict();

export const FeatureValueSchema = z
  .object({
    definitionId: z.string().min(1),
    featureVersion: z.number().int().min(1),
    computationCodeVersion: z.string().min(1),
    subjectKey: z.string().min(1),
    eventAt: UtcTimestampSchema,
    value: DecimalValueSchema.optional(),
    qualityCodes: QualityCodesSchema,
    populationProvenance: PopulationProvenanceSchema,
    storeClass: z.enum(
      Object.values(FeatureStoreClass) as [
        (typeof FeatureStoreClass)[keyof typeof FeatureStoreClass],
        ...(typeof FeatureStoreClass)[keyof typeof FeatureStoreClass][],
      ],
    ),
  })
  .strict()
  .refine((v) => v.value !== undefined || nullAloneIsInsufficient(v.qualityCodes), {
    message: 'null feature value requires at least one explicit quality code',
  });

// ---------------------------------------------------------------------------
// Acquisition decisions (FR-DATA-003/005, §13.8) — exact PRD interface mirror
// ---------------------------------------------------------------------------

const acquisitionStateValues = [...ALL_ACQUISITION_STATES] as [
  AcquisitionState,
  ...AcquisitionState[],
];

export const EvidenceAcquisitionDecisionSchema = z
  .object({
    id: z.string().min(1),
    candidateId: z.string().min(1),
    evidenceFamily: z.string().min(1),
    policyVersion: z.string().min(1),
    state: z.enum(acquisitionStateValues),
    requestedAt: UtcTimestampSchema.optional(),
    completedAt: UtcTimestampSchema.optional(),
    assignmentProbability: z.number().gt(0).lt(1).optional(),
    estimatedDecisionImpact: z.number().min(0).max(1).optional(),
    estimatedInformationValue: z.number().min(0).max(1).optional(),
    actualDecisionChanged: z.boolean().optional(),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict()
  .refine(
    (v) =>
      v.state !== 'NOT_REQUESTED_BY_POLICY' ||
      (v.requestedAt === undefined &&
        v.completedAt === undefined &&
        v.assignmentProbability === undefined),
    { message: 'NOT_REQUESTED_BY_POLICY carries no retrieval lifecycle fields' },
  )
  .refine((v) => v.completedAt === undefined || v.requestedAt !== undefined, {
    message: 'completion requires a prior request time',
  })
  .refine(
    (v) =>
      v.completedAt === undefined ||
      v.requestedAt === undefined ||
      compareStamps(v.completedAt, v.requestedAt) >= 0,
    {
      message: 'completion cannot precede request',
    },
  );

// ---------------------------------------------------------------------------
// Decision/action timestamps (§13.7), checkpoints and gaps (DR substrate)
// ---------------------------------------------------------------------------

export const DecisionActionTimestampsSchema = z
  .object({
    discoveredAt: UtcTimestampSchema,
    evidenceMinimumReadyAt: UtcTimestampSchema,
    decisionReadyAt: UtcTimestampSchema,
    workflowCompletedAt: UtcTimestampSchema,
    policyDecidedAt: UtcTimestampSchema,
    outboxCommittedAt: UtcTimestampSchema,
    alertDeliveredAt: UtcTimestampSchema.nullable(),
    counterfactualDeliveryAt: UtcTimestampSchema,
    validUntil: UtcTimestampSchema,
    expiredAt: UtcTimestampSchema.nullable(),
  })
  .strict();

/**
 * Collector continuity records mirroring the SQL truth of
 * `g0_data_0007_checkpoints_gaps.sql` (§34.7, INV-009): fenced per-shard
 * checkpoints with bigint-range cursors/tokens as digit strings, and the
 * explicit gap registry whose resolved statuses require a resolution instant.
 */
export const CollectorCheckpointSchema = z
  .object({
    shardId: z.string().min(1),
    fencingToken: DigitStringSchema.refine((v) => BigInt(v) >= 1n, {
      message: 'fencing token must be >= 1',
    }),
    cursorPosition: DigitStringSchema.refine((v) => BigInt(v) >= 0n, {
      message: 'cursor position must be >= 0',
    }),
    updatedAt: UtcTimestampSchema,
  })
  .strict();

const GAP_RECOVERY_STATUSES = [
  'UNRECOVERED',
  'RECOVERING',
  'RECOVERED',
  'DECLARED_UNRECOVERABLE',
] as const;

export const CollectorGapSchema = z
  .object({
    gapId: z.string().min(1),
    shardId: z.string().min(1),
    gapStartSlot: DigitStringSchema,
    gapEndSlot: DigitStringSchema,
    reason: z.string().min(1),
    recoveryStatus: z.enum(GAP_RECOVERY_STATUSES),
    registeredAt: UtcTimestampSchema,
    resolvedAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((v) => BigInt(v.gapEndSlot) >= BigInt(v.gapStartSlot), {
    message: 'gap bounds inverted',
  })
  .refine(
    (v) =>
      (v.recoveryStatus !== 'RECOVERED' && v.recoveryStatus !== 'DECLARED_UNRECOVERABLE') ||
      v.resolvedAt !== null,
    { message: 'a resolved gap status requires its resolution instant' },
  );

// ---------------------------------------------------------------------------
// Versioned registry
// ---------------------------------------------------------------------------

/**
 * Every data-family schema under its registry key. Registry keys are the
 * PUBLIC schema names (the names the requirements manifest and fixtures
 * reference); the local Zod variable names carry the `Schema` suffix.
 */
export const DATA_SCHEMAS = {
  ChainIdentity: ChainIdentitySchema,
  AssetRepresentation: AssetRepresentationSchema,
  AssetMembership: AssetMembershipSchema,
  PoolRecord: PoolRecordSchema,
  PairObservation: PairObservationSchema,
  MigrationLineageEdge: MigrationLineageEdgeSchema,
  TokenDecimalsObservation: TokenDecimalsObservationSchema,
  ObservationRecord: ObservationRecordSchema,
  QuantityRecord: QuantityRecordSchema,
  ObservationRevision: ObservationRevisionSchema,
  CompensatingEvent: CompensatingEventSchema,
  BackfillReceipt: BackfillReceiptSchema,
  WatermarkState: WatermarkStateSchema,
  SourceIdentity: SourceIdentitySchema,
  IndependenceGroup: IndependenceGroupSchema,
  SourceGroupMembership: SourceGroupMembershipSchema,
  SourceDependenceEdge: SourceDependenceEdgeSchema,
  FeatureDefinition: FeatureDefinitionSchema,
  FeatureValue: FeatureValueSchema,
  EvidenceAcquisitionDecision: EvidenceAcquisitionDecisionSchema,
  DecisionActionTimestamps: DecisionActionTimestampsSchema,
  CollectorCheckpoint: CollectorCheckpointSchema,
  CollectorGap: CollectorGapSchema,
} as const;

export type DataSchemaName = keyof typeof DATA_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseDataSchema<T extends DataSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof DATA_SCHEMAS)[T]> {
  return DATA_SCHEMAS[name].parse(payload) as z.infer<(typeof DATA_SCHEMAS)[T]>;
}
