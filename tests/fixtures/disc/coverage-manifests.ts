import type { UtcTimestamp } from '@foresift/domain';

export type CoveragePopulationClass =
  | 'SUPPORTED_PROGRAM_UNIVERSE'
  | 'PROSPECTIVELY_OBSERVED_UNIVERSE'
  | 'AGGREGATE_PROVIDER_UNIVERSE'
  | 'AUTHORIZED_LAUNCH_UNIVERSE'
  | 'STRATIFIED_SAMPLED_UNIVERSE'
  | 'CURRENTLY_OBSERVED_SUBSET_ONLY';

export interface CoveragePopulationManifestFixture {
  readonly manifestId: string;
  readonly populationClass: CoveragePopulationClass;
  readonly collectorScopeIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly startSlot: string;
  readonly endSlot: string;
  readonly startTime: UtcTimestamp;
  readonly endTime: UtcTimestamp;
  readonly knownGapsCount: number;
  readonly rightsExclusions: readonly string[];
  readonly selectionProbabilities?: Record<string, number>;
  readonly sourceDependenceDisclosed: boolean;
}

export const SUPPORTED_PROGRAM_POPULATION_MANIFEST: CoveragePopulationManifestFixture = {
  manifestId: 'cov_man_pump_raydium_2026q3',
  populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
  collectorScopeIds: ['scope_pump_v1', 'scope_raydium_v4'],
  sourceIds: ['col_solana_pump_live', 'col_solana_raydium_live'],
  startSlot: '250000000',
  endSlot: '300000000',
  startTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T00:00:00Z' as UtcTimestamp,
  knownGapsCount: 0,
  rightsExclusions: [],
  sourceDependenceDisclosed: true,
};

export const PROSPECTIVE_OBSERVED_POPULATION_MANIFEST: CoveragePopulationManifestFixture = {
  manifestId: 'cov_man_prospective_2026q3',
  populationClass: 'PROSPECTIVELY_OBSERVED_UNIVERSE',
  collectorScopeIds: ['scope_pump_v1'],
  sourceIds: ['col_solana_pump_live'],
  startSlot: '250000000',
  endSlot: '300000000',
  startTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T00:00:00Z' as UtcTimestamp,
  knownGapsCount: 0,
  rightsExclusions: [],
  sourceDependenceDisclosed: true,
};
