/**
 * Coverage population manifest & metrics unit tests (FR-DISC-003, §63.7).
 */
import { describe, expect, it } from 'bun:test';
import {
  SUPPORTED_PROGRAM_POPULATION_MANIFEST,
  PROSPECTIVE_OBSERVED_POPULATION_MANIFEST,
} from '../../../tests/fixtures/disc/index.ts';

describe('Coverage Population Manifests (§63.7, FR-DISC-003)', () => {
  it('manifest requires explicit population class and source list', () => {
    expect(SUPPORTED_PROGRAM_POPULATION_MANIFEST.populationClass).toBe(
      'SUPPORTED_PROGRAM_UNIVERSE',
    );
    expect(SUPPORTED_PROGRAM_POPULATION_MANIFEST.collectorScopeIds.length).toBeGreaterThan(0);
    expect(SUPPORTED_PROGRAM_POPULATION_MANIFEST.sourceDependenceDisclosed).toBe(true);
  });

  it('prospective observed universe requires declared collector scope', () => {
    expect(PROSPECTIVE_OBSERVED_POPULATION_MANIFEST.populationClass).toBe(
      'PROSPECTIVELY_OBSERVED_UNIVERSE',
    );
    expect(PROSPECTIVE_OBSERVED_POPULATION_MANIFEST.collectorScopeIds).toContain('scope_pump_v1');
  });
});
