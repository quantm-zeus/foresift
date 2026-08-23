/**
 * AC-244 negative / failure-path — task T055.
 * Traces: FR-DATA-004.
 * A lift claim without valid provenance is refused at the substrate level:
 * values lacking code/version provenance raise FEATURE_PROVENANCE_INCOMPLETE;
 * lineage-less records are never claim support; the schema mirror refuses
 * provenance-free feature values outright.
 */
import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  FeatureStoreClass,
  supportsPopulationClaim,
  utcTimestamp,
  type FeatureValue,
} from '@foresift/domain';
import { DATA_SCHEMAS } from '@foresift/shared-schemas';

const value = (overrides: Partial<FeatureValue> = {}): FeatureValue => ({
  definitionId: 'def/ac244n' as never,
  featureVersion: 1,
  computationCodeVersion: 'rolling-volume/v1',
  subjectKey: 'pool/ac244n',
  eventAt: utcTimestamp('2026-06-15T12:00:00Z'),
  value: { decimalString: '3500', scale: 0 },
  qualityCodes: [],
  populationProvenance: {
    populationKind: 'FULL_UNIVERSE',
    lineageRefs: ['observations:pool/ac244n'],
  },
  storeClass: FeatureStoreClass.ONLINE,
  ...overrides,
});

describe('AC-244 negative: lift claims without valid provenance are refused', () => {
  it('an empty computation code version is a typed refusal', () => {
    try {
      supportsPopulationClaim(value({ computationCodeVersion: '' }));
      throw new Error('expected refusal');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.startsWith('expected refusal')) {
        expect((err as { code?: string }).code).toBe(ErrorCode.FEATURE_PROVENANCE_INCOMPLETE);
      }
    }
  });

  it('a zero feature version is a typed refusal', () => {
    try {
      supportsPopulationClaim(value({ featureVersion: 0 }));
      throw new Error('expected refusal');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.startsWith('expected refusal')) {
        expect((err as { code?: string }).code).toBe(ErrorCode.FEATURE_PROVENANCE_INCOMPLETE);
      }
    }
  });

  it('a FULL_UNIVERSE label without lineage refs is not claim support', () => {
    expect(
      supportsPopulationClaim(
        value({ populationProvenance: { populationKind: 'FULL_UNIVERSE', lineageRefs: [] } }),
      ),
    ).toBe(false);
  });

  it('the schema mirror refuses a feature value with no population provenance', () => {
    const broken = value() as Record<string, unknown>;
    delete broken.populationProvenance;
    expect(DATA_SCHEMAS.FeatureValue.safeParse(broken).success).toBe(false);
  });

  it('the schema mirror refuses an absent value without explicit quality codes', () => {
    const nullish = value({ value: undefined, qualityCodes: [] });
    expect(DATA_SCHEMAS.FeatureValue.safeParse(nullish).success).toBe(false);
    // With an explicit code the same record becomes representable — absence
    // must always be explained, never silent.
    const explained = value({ value: undefined, qualityCodes: ['LOW_SAMPLE'] });
    expect(DATA_SCHEMAS.FeatureValue.safeParse(explained).success).toBe(true);
  });
});
