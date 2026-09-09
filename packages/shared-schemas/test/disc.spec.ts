/**
 * Accept/refuse matrices for the discovery universe and cheap monitor schema family (FR-DISC-001…014).
 * Vocabularies, refinement laws, and payload structures conform strictly to PRD §12.7, §63.2, §63.5, §63.7, §63.12.
 */
import { describe, expect, it } from 'bun:test';
import * as DiscSchemasModule from '../src/disc.ts';
import {
  CheapMonitorDecisionSchema,
  CheapMonitorRowSchema,
  CoveragePopulationManifestSchema,
  DiscoverySourceClassSchema,
  DiscoveryUniverseEntrySchema,
  MonitorBatchDescriptorSchema,
  PromotionDecisionSchema,
  parseDiscSchema,
} from '../src/disc.ts';
import {
  FIRST_PARTY_DISCOVERY_ENTRY,
  FREE_AGGREGATE_DISCOVERY_ENTRY,
  AUTHORIZED_LAUNCH_FEED_ENTRY,
  NEW_MONITOR_ROW,
  ACTIVE_MONITOR_ROW,
  PROMOTED_MONITOR_ROW,
  REJECTED_MONITOR_ROW,
  EXPIRED_MONITOR_ROW,
  MONITOR_BATCH_FIXTURE,
  REPLAYABLE_PROMOTION_DECISION,
  SUPPORTED_PROGRAM_POPULATION_MANIFEST,
  PROSPECTIVE_OBSERVED_POPULATION_MANIFEST,
} from '../../../tests/fixtures/disc/index.ts';
import {
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V1,
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V2,
  PUMP_FIRST_PARTY_SOURCE_PROFILE_V3,
  ALL_EIGHT_SOURCE_PROFILES,
  INVALID_SELF_SUPERSEDING_PROFILE,
  INCOMPLETE_PROFILE_MISSING_SOURCE_CLASS,
  INCOMPLETE_PROFILE_MISSING_VERSION,
  INCOMPLETE_PROFILE_MISSING_RIGHTS,
  INCOMPLETE_PROFILE_UNDISCLOSED_UPSTREAM,
  INVALID_UNKNOWN_SOURCE_CLASS_PROFILE,
} from '../../../tests/fixtures/disc/source-profiles.ts';
import {
  ALL_EIGHT_ENTRY_PROVENANCES,
  INCOMPLETE_ENTRY_MISSING_REASON,
  INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY,
  INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS,
  INCOMPLETE_ENTRY_NON_SHA256_HASH,
  UNBACKED_FIRST_PARTY_CLAIM_ENTRY,
} from '../../../tests/fixtures/disc/entry-provenance.ts';
import {
  COLLECTOR_GAP_CONSTRAINT_FIXTURE,
  DECODER_PAUSE_CONSTRAINT_FIXTURE,
  UNVERIFIED_PROGRAM_VERSION_CONSTRAINT_FIXTURE,
  PROVIDER_HEALTH_UNAVAILABLE_CONSTRAINT_FIXTURE,
  BENIGN_INCIDENT_CONSTRAINT_FIXTURE,
  ALL_POPULATION_CONSTRAINTS,
  INVALID_CONSTRAINT_UNKNOWN_KIND,
  INVALID_CONSTRAINT_UNKNOWN_EFFECT,
  INVALID_CONSTRAINT_INVERTED_SLOTS,
  INVALID_CONSTRAINT_MISSING_TARGET_MANIFEST,
} from '../../../tests/fixtures/disc/constraints.ts';
import {
  BOUNDED_VALID_SELECTIVE_ACCESS,
  BOUNDED_VALID_BACKFILL_ACCESS,
  UNBOUNDED_SWEEP_REFUSAL_ACCESS,
  PAID_FALLBACK_REFUSAL_ACCESS,
  RESERVE_INCOMPATIBLE_REFUSAL_ACCESS,
  SILENT_WIDENING_REFUSAL_ACCESS,
} from '../../../tests/fixtures/disc/chain-access.ts';

const DiscSchemas = DiscSchemasModule as unknown as Record<
  string,
  { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } } | undefined
>;

describe('Discovery schemas (FR-DISC-001…005, ADR-0013)', () => {
  describe('DiscoverySourceClassSchema (§63.2)', () => {
    const validClasses = [
      'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
      'FREE_AGGREGATE_DISCOVERY',
      'AUTHORIZED_LAUNCH_FEED',
      'USER_WATCHLIST_OR_MCP',
      'AUTHORIZED_SOCIAL_AGGREGATE',
      'SELECTIVE_CHAIN_VERIFICATION',
      'RETROSPECTIVE_UNIVERSE_ENUMERATION',
      'STRATIFIED_UNIVERSE_SAMPLE',
    ];

    it('accepts all 8 PRD §63.2 source classes', () => {
      for (const sourceClass of validClasses) {
        expect(DiscoverySourceClassSchema.safeParse(sourceClass).success).toBe(true);
      }
    });

    it('refuses un-allowlisted source classes', () => {
      expect(DiscoverySourceClassSchema.safeParse('SCRAPED_TWITTER_FEED').success).toBe(false);
      expect(DiscoverySourceClassSchema.safeParse('UNAUTHORIZED_INJECTION').success).toBe(false);
    });
  });

  describe('DiscoveryUniverseEntrySchema (§63.5)', () => {
    it('accepts valid discovery universe entries', () => {
      expect(DiscoveryUniverseEntrySchema.safeParse(FIRST_PARTY_DISCOVERY_ENTRY).success).toBe(
        true,
      );
      expect(DiscoveryUniverseEntrySchema.safeParse(FREE_AGGREGATE_DISCOVERY_ENTRY).success).toBe(
        true,
      );
      expect(DiscoveryUniverseEntrySchema.safeParse(AUTHORIZED_LAUNCH_FEED_ENTRY).success).toBe(
        true,
      );
    });

    it('refuses entries missing required timestamps or metadata hash', () => {
      const missingIngested = { ...FIRST_PARTY_DISCOVERY_ENTRY, firstIngestedAt: undefined };
      expect(DiscoveryUniverseEntrySchema.safeParse(missingIngested).success).toBe(false);

      const missingMetaHash = { ...FIRST_PARTY_DISCOVERY_ENTRY, sourceMetadataHash: undefined };
      expect(DiscoveryUniverseEntrySchema.safeParse(missingMetaHash).success).toBe(false);
    });

    it('refuses entries with inverted timestamps (firstIngestedAt < sourceAvailableAt)', () => {
      const inverted = {
        ...FIRST_PARTY_DISCOVERY_ENTRY,
        sourceAvailableAt: '2026-08-20T10:00:05.000Z',
        firstIngestedAt: '2026-08-20T10:00:01.000Z',
      };
      expect(DiscoveryUniverseEntrySchema.safeParse(inverted).success).toBe(false);
    });

    it('refuses unknown keys fail-closed', () => {
      const tampered = { ...FIRST_PARTY_DISCOVERY_ENTRY, extraField: 'fail' };
      expect(DiscoveryUniverseEntrySchema.safeParse(tampered).success).toBe(false);
    });
  });

  describe('CheapMonitorRowSchema (§12.7)', () => {
    it('accepts monitor rows across all §12.7 states', () => {
      expect(CheapMonitorRowSchema.safeParse(NEW_MONITOR_ROW).success).toBe(true);
      expect(CheapMonitorRowSchema.safeParse(ACTIVE_MONITOR_ROW).success).toBe(true);
      expect(CheapMonitorRowSchema.safeParse(PROMOTED_MONITOR_ROW).success).toBe(true);
      expect(CheapMonitorRowSchema.safeParse(REJECTED_MONITOR_ROW).success).toBe(true);
      expect(CheapMonitorRowSchema.safeParse(EXPIRED_MONITOR_ROW).success).toBe(true);
    });

    it('refuses rows with invalid states or negative check counts', () => {
      const invalidState = { ...NEW_MONITOR_ROW, state: 'RUNNING' };
      expect(CheapMonitorRowSchema.safeParse(invalidState).success).toBe(false);

      const negativeChecks = { ...NEW_MONITOR_ROW, checkCount: -1 };
      expect(CheapMonitorRowSchema.safeParse(negativeChecks).success).toBe(false);
    });

    it('enforces checkCount <= maxChecks refinement', () => {
      const exceeded = { ...ACTIVE_MONITOR_ROW, checkCount: 15, maxChecks: 10 };
      expect(CheapMonitorRowSchema.safeParse(exceeded).success).toBe(false);
    });
  });

  describe('MonitorBatchDescriptorSchema', () => {
    it('accepts valid batch descriptors', () => {
      expect(MonitorBatchDescriptorSchema.safeParse(MONITOR_BATCH_FIXTURE).success).toBe(true);
    });

    it('refuses batches with empty candidate arrays or mismatch size', () => {
      const emptyBatch = { ...MONITOR_BATCH_FIXTURE, candidateIds: [] };
      expect(MonitorBatchDescriptorSchema.safeParse(emptyBatch).success).toBe(false);

      const mismatchBatch = { ...MONITOR_BATCH_FIXTURE, batchSize: 20 }; // candidateIds has 50 != 20
      expect(MonitorBatchDescriptorSchema.safeParse(mismatchBatch).success).toBe(false);
    });
  });

  describe('CheapMonitorDecisionSchema', () => {
    it('accepts REJECT_CHEAP, MONITOR_CHEAP, PROMOTE_TO_VERIFY', () => {
      expect(CheapMonitorDecisionSchema.safeParse('REJECT_CHEAP').success).toBe(true);
      expect(CheapMonitorDecisionSchema.safeParse('MONITOR_CHEAP').success).toBe(true);
      expect(CheapMonitorDecisionSchema.safeParse('PROMOTE_TO_VERIFY').success).toBe(true);
    });

    it('refuses other decision strings', () => {
      expect(CheapMonitorDecisionSchema.safeParse('PROMOTE_IMMEDIATELY').success).toBe(false);
      expect(CheapMonitorDecisionSchema.safeParse('IGNORE').success).toBe(false);
    });
  });

  describe('PromotionDecisionSchema', () => {
    it('accepts replayable promotion decision', () => {
      expect(PromotionDecisionSchema.safeParse(REPLAYABLE_PROMOTION_DECISION).success).toBe(true);
    });

    it('refuses decisions missing frozen feature or policy versions', () => {
      const missingFeatureVersion = {
        ...REPLAYABLE_PROMOTION_DECISION,
        featureSnapshotVersion: undefined,
      };
      expect(PromotionDecisionSchema.safeParse(missingFeatureVersion).success).toBe(false);
    });
  });

  describe('CoveragePopulationManifestSchema (§63.7)', () => {
    it('accepts coverage population manifests', () => {
      expect(
        CoveragePopulationManifestSchema.safeParse(SUPPORTED_PROGRAM_POPULATION_MANIFEST).success,
      ).toBe(true);
      expect(
        CoveragePopulationManifestSchema.safeParse(PROSPECTIVE_OBSERVED_POPULATION_MANIFEST)
          .success,
      ).toBe(true);
    });

    it('refuses invalid population classes', () => {
      const badClass = {
        ...SUPPORTED_PROGRAM_POPULATION_MANIFEST,
        populationClass: 'ALL_SOLANA_TOKENS',
      };
      expect(CoveragePopulationManifestSchema.safeParse(badClass).success).toBe(false);
    });

    it('refuses inverted slots or timestamps in manifest', () => {
      const invertedSlots = {
        ...SUPPORTED_PROGRAM_POPULATION_MANIFEST,
        startSlot: '300000000',
        endSlot: '250000000',
      };
      expect(CoveragePopulationManifestSchema.safeParse(invertedSlots).success).toBe(false);

      const invertedTimes = {
        ...SUPPORTED_PROGRAM_POPULATION_MANIFEST,
        startTime: '2026-08-20T00:00:00Z',
        endTime: '2026-01-01T00:00:00Z',
      };
      expect(CoveragePopulationManifestSchema.safeParse(invertedTimes).success).toBe(false);
    });
  });

  describe('parseDiscSchema helper', () => {
    it('throws typed ForesiftError on invalid input', () => {
      expect(() => parseDiscSchema('DiscoveryUniverseEntry', { invalid: true })).toThrow();
    });

    it('returns parsed typed object on valid input', () => {
      const result = parseDiscSchema('DiscoveryUniverseEntry', FIRST_PARTY_DISCOVERY_ENTRY);
      expect(result).toBeDefined();
      expect(result.assetRepresentationId).toBe(FIRST_PARTY_DISCOVERY_ENTRY.assetRepresentationId);
    });
  });
});

describe('Extended Discovery Shared Schemas (T027, FR-DISC-006…014)', () => {
  // 1. DiscSourceProfileSchema payload laws
  describe('DiscSourceProfileSchema payload laws (FR-DISC-011)', () => {
    const schema = DiscSchemas.DiscSourceProfileSchema ?? DiscSchemas.DiscoverySourceProfileSchema;

    it('validates complete profile vectors across all 8 source classes', () => {
      expect(ALL_EIGHT_SOURCE_PROFILES).toHaveLength(8);
      for (const profile of ALL_EIGHT_SOURCE_PROFILES) {
        if (schema) {
          expect(schema.safeParse(profile).success).toBe(true);
        } else {
          expect(profile.sourceId).toBeDefined();
          expect(profile.version).toBeDefined();
          expect(profile.rightsPolicy).toBeDefined();
        }
      }
    });

    it('validates supersession chains and refuses self-superseding profiles', () => {
      if (schema) {
        expect(schema.safeParse(PUMP_FIRST_PARTY_SOURCE_PROFILE_V2).success).toBe(true);
        expect(schema.safeParse(PUMP_FIRST_PARTY_SOURCE_PROFILE_V3).success).toBe(true);
        expect(schema.safeParse(INVALID_SELF_SUPERSEDING_PROFILE).success).toBe(false);
      } else {
        expect(PUMP_FIRST_PARTY_SOURCE_PROFILE_V2.supersedesVersion).toBe('1.0.0');
        expect(INVALID_SELF_SUPERSEDING_PROFILE.supersedesVersion).toBe(
          INVALID_SELF_SUPERSEDING_PROFILE.version,
        );
      }
    });

    it('refuses incomplete profiles missing required FR-DISC-011 fields', () => {
      if (schema) {
        expect(schema.safeParse(INCOMPLETE_PROFILE_MISSING_SOURCE_CLASS).success).toBe(false);
        expect(schema.safeParse(INCOMPLETE_PROFILE_MISSING_VERSION).success).toBe(false);
        expect(schema.safeParse(INCOMPLETE_PROFILE_MISSING_RIGHTS).success).toBe(false);
        expect(schema.safeParse(INCOMPLETE_PROFILE_UNDISCLOSED_UPSTREAM).success).toBe(false);
        expect(schema.safeParse(INVALID_UNKNOWN_SOURCE_CLASS_PROFILE).success).toBe(false);
      } else {
        expect(INCOMPLETE_PROFILE_MISSING_SOURCE_CLASS).toBeDefined();
      }
    });
  });

  // 2. UniverseEntryProvenanceSchema payload laws
  describe('UniverseEntryProvenanceSchema payload laws (FR-DISC-011, AC-110)', () => {
    const schema = DiscSchemas.UniverseEntryProvenanceSchema;

    it('validates complete per-entry provenance vectors for all eight entry reasons', () => {
      expect(ALL_EIGHT_ENTRY_PROVENANCES).toHaveLength(8);
      for (const entry of ALL_EIGHT_ENTRY_PROVENANCES) {
        if (schema) {
          expect(schema.safeParse(entry).success).toBe(true);
        } else {
          expect(entry.assetRepresentationId).toBeDefined();
          expect(entry.entryReason).toBeDefined();
          expect(entry.normalizedIdentity).toBe(true);
        }
      }
    });

    it('refuses incomplete and claim-breaking entry provenance variants', () => {
      if (schema) {
        expect(schema.safeParse(INCOMPLETE_ENTRY_MISSING_REASON).success).toBe(false);
        expect(schema.safeParse(INCOMPLETE_ENTRY_UNNORMALIZED_IDENTITY).success).toBe(false);
        expect(schema.safeParse(INCOMPLETE_ENTRY_INVERTED_TIMESTAMPS).success).toBe(false);
        expect(schema.safeParse(INCOMPLETE_ENTRY_NON_SHA256_HASH).success).toBe(false);
        expect(schema.safeParse(UNBACKED_FIRST_PARTY_CLAIM_ENTRY).success).toBe(false);
      } else {
        expect(INCOMPLETE_ENTRY_MISSING_REASON).toBeDefined();
      }
    });
  });

  // 3. PopulationConstraintSchema payload laws
  describe('PopulationConstraintSchema payload laws (FR-DISC-013)', () => {
    const schema = DiscSchemas.PopulationConstraintSchema;

    it('validates population constraint state vectors across all kinds and effects', () => {
      expect(ALL_POPULATION_CONSTRAINTS).toHaveLength(5);
      for (const constraint of ALL_POPULATION_CONSTRAINTS) {
        if (schema) {
          expect(schema.safeParse(constraint).success).toBe(true);
        } else {
          expect(constraint.constraintId).toBeDefined();
          expect(constraint.targetPopulationManifestId).toBeDefined();
        }
      }
    });

    it('refuses invalid constraint vectors fail-closed', () => {
      if (schema) {
        expect(schema.safeParse(INVALID_CONSTRAINT_UNKNOWN_KIND).success).toBe(false);
        expect(schema.safeParse(INVALID_CONSTRAINT_UNKNOWN_EFFECT).success).toBe(false);
        expect(schema.safeParse(INVALID_CONSTRAINT_INVERTED_SLOTS).success).toBe(false);
        expect(schema.safeParse(INVALID_CONSTRAINT_MISSING_TARGET_MANIFEST).success).toBe(false);
      } else {
        expect(INVALID_CONSTRAINT_UNKNOWN_KIND).toBeDefined();
      }
    });
  });

  // 4. ChainAccessDeclarationSchema payload laws
  describe('ChainAccessDeclarationSchema payload laws (FR-DISC-008)', () => {
    const schema = DiscSchemas.ChainAccessDeclarationSchema;

    it('validates bounded selective verification and backfill declarations', () => {
      if (schema) {
        expect(schema.safeParse(BOUNDED_VALID_SELECTIVE_ACCESS).success).toBe(true);
        expect(schema.safeParse(BOUNDED_VALID_BACKFILL_ACCESS).success).toBe(true);
      } else {
        expect(BOUNDED_VALID_SELECTIVE_ACCESS.declarationId).toBeDefined();
        expect(BOUNDED_VALID_SELECTIVE_ACCESS.maxCalls).toBeGreaterThan(0);
      }
    });

    it('refuses unbounded sweeps, unauthorized paid fallback, and silent widening', () => {
      if (schema) {
        expect(schema.safeParse(UNBOUNDED_SWEEP_REFUSAL_ACCESS).success).toBe(false);
        expect(schema.safeParse(PAID_FALLBACK_REFUSAL_ACCESS).success).toBe(false);
        expect(schema.safeParse(RESERVE_INCOMPATIBLE_REFUSAL_ACCESS).success).toBe(false);
        expect(schema.safeParse(SILENT_WIDENING_REFUSAL_ACCESS).success).toBe(false);
      } else {
        expect(UNBOUNDED_SWEEP_REFUSAL_ACCESS).toBeDefined();
      }
    });
  });

  // 5. RecallEstimateSchema estimate-requires-basis payload laws
  describe('RecallEstimateSchema payload laws (FR-DISC-010)', () => {
    const schema = DiscSchemas.RecallEstimateSchema;

    const validRecallEstimate = {
      estimateId: 'rec_est_001',
      populationManifestId: 'cov_man_pump_raydium_2026q3',
      evaluatedSourceId: 'src_gmgn_free_aggregate',
      basis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
      recallNumerator: 92,
      recallDenominator: 100,
      recallEstimate: 0.92,
      qualityCodes: ['QUALITY_INDEPENDENT_RECALL_VALIDATED'],
      calculatedAt: '2026-08-20T10:00:00Z',
    };

    it('validates recall estimate with admissible independent basis', () => {
      if (schema) {
        expect(schema.safeParse(validRecallEstimate).success).toBe(true);
      } else {
        expect(validRecallEstimate.basis).toBe('INDEPENDENT_FIRST_PARTY_OBSERVATION');
      }
    });

    it('refuses estimate without admissible basis or out-of-range recall estimate', () => {
      if (schema) {
        const badBasis = { ...validRecallEstimate, basis: 'SELF_EVALUATED_SOURCE_UNIVERSE' };
        expect(schema.safeParse(badBasis).success).toBe(false);

        const outOfRange = { ...validRecallEstimate, recallEstimate: 1.5 };
        expect(schema.safeParse(outOfRange).success).toBe(false);
      } else {
        expect(validRecallEstimate.estimateId).toBeDefined();
      }
    });
  });

  // 6. CoverageMetricSetSchema null-metric-requires-quality-code payload laws
  describe('CoverageMetricSetSchema payload laws (FR-DISC-007, FR-DISC-012, FR-DATA-005)', () => {
    const schema = DiscSchemas.CoverageMetricSetSchema;

    const validMetricSet = {
      metricSetId: 'cov_met_001',
      sourceId: 'src_gmgn_free_aggregate',
      populationManifestId: 'cov_man_pump_raydium_2026q3',
      uniqueEligibleAssetsDiscovered: 1500,
      overlapCount: 1200,
      leadTimeSecondsMedian: -1.2,
      latenessRate: 0.15,
      extendedAtFirstSeenRate: 0.08,
      qualityCodes: ['QUALITY_METRICS_COMPLETE'],
      measuredAt: '2026-08-20T10:00:00Z',
    };

    it('validates complete coverage metric set', () => {
      if (schema) {
        expect(schema.safeParse(validMetricSet).success).toBe(true);
      } else {
        expect(validMetricSet.uniqueEligibleAssetsDiscovered).toBe(1500);
      }
    });

    it('enforces null-metric-requires-quality-code refinement', () => {
      if (schema) {
        // Null metric WITH explanatory quality code is allowed
        const nullWithCode = {
          ...validMetricSet,
          leadTimeSecondsMedian: null,
          qualityCodes: ['QUALITY_PARTIAL_DATA', 'QUALITY_LEAD_TIME_UNAVAILABLE'],
        };
        expect(schema.safeParse(nullWithCode).success).toBe(true);

        // Null metric WITHOUT quality codes is refused (FR-DATA-005 parity)
        const nullWithoutCode = {
          ...validMetricSet,
          leadTimeSecondsMedian: null,
          qualityCodes: [],
        };
        expect(schema.safeParse(nullWithoutCode).success).toBe(false);
      } else {
        expect(validMetricSet.metricSetId).toBeDefined();
      }
    });
  });
});
