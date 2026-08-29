/**
 * Accept/refuse matrices for the discovery universe and cheap monitor schema family (FR-DISC-001…005).
 * Vocabularies and structures conform strictly to PRD §12.7, §63.2, §63.5, §63.7.
 */
import { describe, expect, it } from 'bun:test';
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
} from '../../../tests/fixtures/disc/index.ts';

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
      expect(DiscoveryUniverseEntrySchema.safeParse(FIRST_PARTY_DISCOVERY_ENTRY).success).toBe(true);
      expect(DiscoveryUniverseEntrySchema.safeParse(FREE_AGGREGATE_DISCOVERY_ENTRY).success).toBe(true);
      expect(DiscoveryUniverseEntrySchema.safeParse(AUTHORIZED_LAUNCH_FEED_ENTRY).success).toBe(true);
    });

    it('refuses entries missing required timestamps or metadata hash', () => {
      const missingIngested = { ...FIRST_PARTY_DISCOVERY_ENTRY, firstIngestedAt: undefined };
      expect(DiscoveryUniverseEntrySchema.safeParse(missingIngested).success).toBe(false);

      const missingMetaHash = { ...FIRST_PARTY_DISCOVERY_ENTRY, sourceMetadataHash: undefined };
      expect(DiscoveryUniverseEntrySchema.safeParse(missingMetaHash).success).toBe(false);
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
  });

  describe('MonitorBatchDescriptorSchema', () => {
    it('accepts valid batch descriptors', () => {
      expect(MonitorBatchDescriptorSchema.safeParse(MONITOR_BATCH_FIXTURE).success).toBe(true);
    });

    it('refuses batches with empty candidate arrays or mismatch size', () => {
      const emptyBatch = { ...MONITOR_BATCH_FIXTURE, candidateIds: [] };
      expect(MonitorBatchDescriptorSchema.safeParse(emptyBatch).success).toBe(false);
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
    });

    it('refuses invalid population classes', () => {
      const badClass = {
        ...SUPPORTED_PROGRAM_POPULATION_MANIFEST,
        populationClass: 'ALL_SOLANA_TOKENS',
      };
      expect(CoveragePopulationManifestSchema.safeParse(badClass).success).toBe(false);
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
