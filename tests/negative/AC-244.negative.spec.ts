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
  type DecimalValue,
  type FeatureValue,
} from '@foresift/domain';
import { DATA_SCHEMAS } from '@foresift/shared-schemas';

// `value` may be explicitly unset (an absent value must be explained by a
// quality code — the refusal case below), which exactOptionalPropertyTypes
// forbids expressing through Partial<>.
const value = (
  overrides: Omit<Partial<FeatureValue>, 'value'> & {
    readonly value?: DecimalValue | undefined;
  } = {},
): FeatureValue =>
  ({
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
    // Overrides may deliberately unset `value` — the explained-absence case the
    // schema mirror must accept only with quality codes.
  }) as FeatureValue;

describe('AC-244 negative: lift claims without valid provenance are refused', () => {
  it('an empty computation code version is a typed refusal', () => {
    try {
      supportsPopulationClaim(value({ computationCodeVersion: '' }));
      throw new Error('expected refusal');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Sentinel rethrown before asserting: an accepted call must FAIL here.
      if (message.startsWith('expected refusal')) throw err;
      expect((err as { code?: string }).code).toBe(ErrorCode.FEATURE_PROVENANCE_INCOMPLETE);
    }
  });

  it('a zero feature version is a typed refusal', () => {
    try {
      supportsPopulationClaim(value({ featureVersion: 0 }));
      throw new Error('expected refusal');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Sentinel rethrown before asserting — this zero-version refusal is
      // pinned nowhere else, so a vacuous skip here would go unnoticed.
      if (message.startsWith('expected refusal')) throw err;
      expect((err as { code?: string }).code).toBe(ErrorCode.FEATURE_PROVENANCE_INCOMPLETE);
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
    const broken = value() as unknown as Record<string, unknown>;
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
