import type { UtcTimestamp } from '@foresift/domain';

export interface RetrospectiveSampleFixture {
  readonly sampleId: string;
  readonly assetRepresentationId: string;
  readonly retrospectiveSourceId: string;
  readonly lineageIndependenceDeclared: boolean;
  readonly upstreamLineageSharedWithLive: boolean;
  readonly discoveredByLiveSources: boolean;
  readonly outcomeProfileMet: boolean;
  readonly expectedClassification: 'NOT_DISCOVERED' | 'DISCOVERED' | 'INELIGIBLE' | 'LINEAGE_DEPENDENT';
  readonly excludedFromHistoricalDecisionBundle: boolean;
  readonly sampleTimestamp: UtcTimestamp;
}

export const RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED: RetrospectiveSampleFixture = {
  sampleId: 'retro_sample_001',
  assetRepresentationId: 'asset_rep_sol_missed_gem_001',
  retrospectiveSourceId: 'src_solana_archive_node_direct',
  lineageIndependenceDeclared: true,
  upstreamLineageSharedWithLive: false,
  discoveredByLiveSources: false,
  outcomeProfileMet: true,
  expectedClassification: 'NOT_DISCOVERED',
  excludedFromHistoricalDecisionBundle: true,
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RETROSPECTIVE_SAMPLE_SHARED_LINEAGE: RetrospectiveSampleFixture = {
  sampleId: 'retro_sample_002',
  assetRepresentationId: 'asset_rep_sol_shared_lineage_002',
  retrospectiveSourceId: 'src_gmgn_archive_dump',
  lineageIndependenceDeclared: false,
  upstreamLineageSharedWithLive: true,
  discoveredByLiveSources: false,
  outcomeProfileMet: true,
  expectedClassification: 'LINEAGE_DEPENDENT',
  excludedFromHistoricalDecisionBundle: true,
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RETROSPECTIVE_SAMPLE_DISCOVERED: RetrospectiveSampleFixture = {
  sampleId: 'retro_sample_003',
  assetRepresentationId: 'asset_rep_sol_pump_token_001',
  retrospectiveSourceId: 'src_solana_archive_node_direct',
  lineageIndependenceDeclared: true,
  upstreamLineageSharedWithLive: false,
  discoveredByLiveSources: true,
  outcomeProfileMet: true,
  expectedClassification: 'DISCOVERED',
  excludedFromHistoricalDecisionBundle: true,
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};
