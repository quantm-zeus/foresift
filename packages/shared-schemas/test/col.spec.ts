/**
 * Accept/refuse matrices for the collector schema family (FR-COL-001…011 manifest schemaRefs).
 * Every `.strict()` object must refuse unknown keys; vocabularies are asserted against PRD §12.9, §12.10, §63.3.1, §62.5.
 */
import { describe, expect, it } from 'bun:test';
import {
  CollectorCeilingSetSchema,
  CollectorGapStateSchema,
  CollectorHealthSchema,
  CollectorPartitionStateSchema,
  CollectorScopeDeclarationSchema,
  CollectorStreamRecordSchema,
  FirstSeenLatencySpansSchema,
  ProgramSupportManifestSchema,
  parseColSchema,
} from '../src/col.ts';
import {
  PUMP_SCOPE,
  RAYDIUM_AMM_V4_SCOPE,
  ORCA_WHIRLPOOLS_SCOPE,
  METEORA_DLMM_SCOPE,
  JUPITER_ROUTE_SCOPE,
  PUMP_MANIFEST,
  RAYDIUM_V4_MANIFEST,
  ORCA_WHIRLPOOLS_MANIFEST,
  METEORA_DLMM_MANIFEST,
  JUPITER_ROUTE_MANIFEST,
  DEGRADED_MANIFEST,
  STREAM_RECORD_PUMP_BUY,
  STREAM_RECORD_RAYDIUM_SWAP,
  VALID_COLLECTOR_CEILINGS,
} from '../../../tests/fixtures/col/index.ts';

describe('Collector schemas (FR-COL-001…011, ADR-0013)', () => {
  describe('CollectorScopeDeclarationSchema', () => {
    it('accepts valid protocol scopes', () => {
      expect(CollectorScopeDeclarationSchema.safeParse(PUMP_SCOPE).success).toBe(true);
      expect(CollectorScopeDeclarationSchema.safeParse(RAYDIUM_AMM_V4_SCOPE).success).toBe(true);
      expect(CollectorScopeDeclarationSchema.safeParse(ORCA_WHIRLPOOLS_SCOPE).success).toBe(true);
      expect(CollectorScopeDeclarationSchema.safeParse(METEORA_DLMM_SCOPE).success).toBe(true);
      expect(CollectorScopeDeclarationSchema.safeParse(JUPITER_ROUTE_SCOPE).success).toBe(true);
    });

    it('refuses unknown keys fail-closed', () => {
      const tampered = { ...PUMP_SCOPE, extraKey: 'forbidden' };
      const parsed = CollectorScopeDeclarationSchema.safeParse(tampered);
      expect(parsed.success).toBe(false);
    });

    it('refuses invalid finality policy', () => {
      const invalid = { ...PUMP_SCOPE, finalityPolicy: 'unsupported_finality' };
      expect(CollectorScopeDeclarationSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('CollectorStreamRecordSchema', () => {
    it('accepts valid stream records with full FR-COL-003 coordinates', () => {
      expect(CollectorStreamRecordSchema.safeParse(STREAM_RECORD_PUMP_BUY).success).toBe(true);
      expect(CollectorStreamRecordSchema.safeParse(STREAM_RECORD_RAYDIUM_SWAP).success).toBe(true);
    });

    it('refuses stream records missing required coordinates', () => {
      const missingSlot = { ...STREAM_RECORD_PUMP_BUY, slot: undefined };
      expect(CollectorStreamRecordSchema.safeParse(missingSlot).success).toBe(false);

      const missingTx = { ...STREAM_RECORD_PUMP_BUY, transactionSignature: undefined };
      expect(CollectorStreamRecordSchema.safeParse(missingTx).success).toBe(false);

      const missingRawArtifactHash = { ...STREAM_RECORD_PUMP_BUY, rawArtifactHash: undefined };
      expect(CollectorStreamRecordSchema.safeParse(missingRawArtifactHash).success).toBe(false);
    });

    it('refuses non-strict keys on stream record', () => {
      const tampered = { ...STREAM_RECORD_PUMP_BUY, injected_data: 123 };
      expect(CollectorStreamRecordSchema.safeParse(tampered).success).toBe(false);
    });
  });

  describe('ProgramSupportManifestSchema (§63.3.1)', () => {
    it('accepts signed program support manifests for all mandatory protocol families', () => {
      expect(ProgramSupportManifestSchema.safeParse(PUMP_MANIFEST).success).toBe(true);
      expect(ProgramSupportManifestSchema.safeParse(RAYDIUM_V4_MANIFEST).success).toBe(true);
      expect(ProgramSupportManifestSchema.safeParse(ORCA_WHIRLPOOLS_MANIFEST).success).toBe(true);
      expect(ProgramSupportManifestSchema.safeParse(METEORA_DLMM_MANIFEST).success).toBe(true);
      expect(ProgramSupportManifestSchema.safeParse(JUPITER_ROUTE_MANIFEST).success).toBe(true);
      expect(ProgramSupportManifestSchema.safeParse(DEGRADED_MANIFEST).success).toBe(true);
    });

    it('refuses unknown protocol families or capability states', () => {
      const invalidCapability = { ...PUMP_MANIFEST, capabilityState: 'INVALID_STATE' };
      expect(ProgramSupportManifestSchema.safeParse(invalidCapability).success).toBe(false);
      // Unknown protocol family likewise refused (PUMP_MANIFEST carries a
      // known family; any unknown family must fail the enum).
      const unknownFamilyResult = ProgramSupportManifestSchema.safeParse({
        ...PUMP_MANIFEST,
        protocolFamily: 'UNKNOWN_DEX',
      });
      expect(unknownFamilyResult.success).toBe(false);
    });

    it('refuses unknown upgrade authority state', () => {
      const badUpgradeState = { ...PUMP_MANIFEST, upgradeAuthorityState: 'MUTABLE_UNCONTROLLED' };
      expect(ProgramSupportManifestSchema.safeParse(badUpgradeState).success).toBe(false);
    });
  });

  describe('CollectorPartitionStateSchema (§12.9)', () => {
    const validStates = [
      'DISABLED',
      'STARTING',
      'SYNCING',
      'LIVE',
      'DEGRADED',
      'GAP_DETECTED',
      'BACKFILLING',
      'PAUSED',
      'FAILED',
    ];

    it('accepts all §12.9 collector partition states', () => {
      for (const state of validStates) {
        expect(CollectorPartitionStateSchema.safeParse(state).success).toBe(true);
      }
    });

    it('refuses non-vocabulary state strings', () => {
      expect(CollectorPartitionStateSchema.safeParse('RUNNING').success).toBe(false);
      expect(CollectorPartitionStateSchema.safeParse('STOPPED').success).toBe(false);
    });
  });

  describe('CollectorGapStateSchema (§12.10)', () => {
    const validGapStates = [
      'OPEN',
      'BACKFILL_QUEUED',
      'BACKFILLING',
      'RESOLVED_COMPLETE',
      'RESOLVED_EMPTY_PROOF',
      'PARTIAL',
      'UNRESOLVED',
      'WAIVED_FOR_NARROW_SCOPE',
    ];

    it('accepts all §12.10 gap states', () => {
      for (const state of validGapStates) {
        expect(CollectorGapStateSchema.safeParse(state).success).toBe(true);
      }
    });

    it('refuses invalid gap states', () => {
      expect(CollectorGapStateSchema.safeParse('CLOSED').success).toBe(false);
      expect(CollectorGapStateSchema.safeParse('IGNORED').success).toBe(false);
    });
  });

  describe('CollectorHealthSchema (FR-COL-008)', () => {
    const validHealth = {
      partitionId: 'part_solana_pump_0',
      connectedState: 'CONNECTED',
      endpointGeneration: 1,
      headSlot: '300100200',
      finalizedSlot: '300100150',
      checkpointLag: 5,
      gapCount: 0,
      gapDurationSeconds: 0,
      backfillStatus: 'IDLE',
      decodeFailureRate: 0.0,
      streamedBytes: 1048576,
      eventRate: 150.5,
      deduplicationRate: 0.02,
      resourceConsumption: {
        cpuPercent: 12.5,
        memoryMb: 256,
      },
      sampledAt: '2026-08-20T10:00:00Z',
    };

    it('accepts full FR-COL-008 health snapshot', () => {
      expect(CollectorHealthSchema.safeParse(validHealth).success).toBe(true);
    });

    it('refuses incomplete health snapshot', () => {
      const missingField = { ...validHealth, headSlot: undefined };
      expect(CollectorHealthSchema.safeParse(missingField).success).toBe(false);
    });
  });

  describe('CollectorCeilingSetSchema (FR-COL-010)', () => {
    it('accepts 8-dimension capacity ceiling set', () => {
      expect(CollectorCeilingSetSchema.safeParse(VALID_COLLECTOR_CEILINGS).success).toBe(true);
    });

    it('refuses negative limits or unknown keys', () => {
      const negativeLimit = { ...VALID_COLLECTOR_CEILINGS, cpuCoreLimit: -1 };
      expect(CollectorCeilingSetSchema.safeParse(negativeLimit).success).toBe(false);

      const unknownKey = { ...VALID_COLLECTOR_CEILINGS, extra: 'bad' };
      expect(CollectorCeilingSetSchema.safeParse(unknownKey).success).toBe(false);
    });
  });

  describe('FirstSeenLatencySpansSchema (FR-COL-011)', () => {
    const validSpans = {
      eventToCollectorMs: 45,
      collectorToFeatureMs: 12,
      featureToDecisionMs: 8,
      decisionToDeliveryMs: 15,
      providerComparisonMs: 120,
      isFirstPartyVerifiedScope: true,
    };

    it('accepts valid first-seen latency decomposition spans', () => {
      expect(FirstSeenLatencySpansSchema.safeParse(validSpans).success).toBe(true);
    });

    it('refuses negative durations', () => {
      const negativeSpan = { ...validSpans, eventToCollectorMs: -5 };
      expect(FirstSeenLatencySpansSchema.safeParse(negativeSpan).success).toBe(false);
    });
  });

  describe('parseColSchema helper', () => {
    it('throws typed ForesiftError on invalid input', () => {
      expect(() => parseColSchema('CollectorScopeDeclaration', { invalid: true })).toThrow();
    });

    it('returns parsed typed object on valid input', () => {
      const result = parseColSchema('CollectorScopeDeclaration', PUMP_SCOPE);
      expect(result).toBeDefined();
      expect(result.scopeId).toBe(PUMP_SCOPE.scopeId);
    });
  });
});
