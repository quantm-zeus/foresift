/**
 * Population constraint fixtures (§63.12 failure behavior, FR-DISC-013).
 * Collector-gap, decoder-pause, program-version, and provider-health state vectors
 * with expected constraint kinds and effects.
 * Traces: FR-DISC-013.
 */
import type { UtcTimestamp } from '@foresift/domain';

export type PopulationConstraintKind =
  | 'COLLECTOR_GAP'
  | 'DECODER_PAUSE'
  | 'PROGRAM_VERSION_UNVERIFIED'
  | 'PROVIDER_HEALTH_UNAVAILABLE';

export const ALL_POPULATION_CONSTRAINT_KINDS: readonly PopulationConstraintKind[] = [
  'COLLECTOR_GAP',
  'DECODER_PAUSE',
  'PROGRAM_VERSION_UNVERIFIED',
  'PROVIDER_HEALTH_UNAVAILABLE',
];

export type PopulationConstraintEffect =
  | 'CONSTRAIN_POPULATION'
  | 'BLOCKS_CONFIRMED_ALERTS'
  | 'RECORD_INCIDENT_ONLY'
  | 'DEGRADE_CAPABILITY';

export const ALL_POPULATION_CONSTRAINT_EFFECTS: readonly PopulationConstraintEffect[] = [
  'CONSTRAIN_POPULATION',
  'BLOCKS_CONFIRMED_ALERTS',
  'RECORD_INCIDENT_ONLY',
  'DEGRADE_CAPABILITY',
];

export interface PopulationConstraintFixture {
  readonly constraintId: string;
  readonly kind: PopulationConstraintKind;
  readonly effect: PopulationConstraintEffect;
  readonly targetPopulationManifestId: string;
  readonly sourceId?: string;
  readonly startSlot?: string;
  readonly endSlot?: string;
  readonly startTime?: UtcTimestamp;
  readonly endTime?: UtcTimestamp;
  readonly blocksPublication: boolean;
  readonly detail: string;
  readonly recordedAt: UtcTimestamp;
}

// -----------------------------------------------------------------------------
// 1. Expected constraint state vectors across all 4 kinds and effects
// -----------------------------------------------------------------------------

export const COLLECTOR_GAP_CONSTRAINT_FIXTURE: PopulationConstraintFixture = {
  constraintId: 'cst_gap_solana_pump_001',
  kind: 'COLLECTOR_GAP',
  effect: 'CONSTRAIN_POPULATION',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  sourceId: 'col_solana_pump_live',
  startSlot: '300100101',
  endSlot: '300100104',
  startTime: '2026-08-20T10:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T10:00:02Z' as UtcTimestamp,
  blocksPublication: true,
  detail: 'Unobserved slot gap 300100101-300100104 constrains population claim to verified window',
  recordedAt: '2026-08-20T10:00:03Z' as UtcTimestamp,
};

export const DECODER_PAUSE_CONSTRAINT_FIXTURE: PopulationConstraintFixture = {
  constraintId: 'cst_decoder_pause_002',
  kind: 'DECODER_PAUSE',
  effect: 'BLOCKS_CONFIRMED_ALERTS',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  sourceId: 'col_solana_pump_live',
  startTime: '2026-08-20T11:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T11:15:00Z' as UtcTimestamp,
  blocksPublication: true,
  detail: 'Decoder pause due to unsupported account layout layout_v3 blocks confirmed alerts',
  recordedAt: '2026-08-20T11:00:05Z' as UtcTimestamp,
};

export const UNVERIFIED_PROGRAM_VERSION_CONSTRAINT_FIXTURE: PopulationConstraintFixture = {
  constraintId: 'cst_prog_version_003',
  kind: 'PROGRAM_VERSION_UNVERIFIED',
  effect: 'DEGRADE_CAPABILITY',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  sourceId: 'col_solana_raydium_live',
  blocksPublication: true,
  detail: 'Raydium CPMM program upgrade detected without live-chain verification; capability degraded',
  recordedAt: '2026-08-20T12:00:00Z' as UtcTimestamp,
};

export const PROVIDER_HEALTH_UNAVAILABLE_CONSTRAINT_FIXTURE: PopulationConstraintFixture = {
  constraintId: 'cst_provider_unavail_004',
  kind: 'PROVIDER_HEALTH_UNAVAILABLE',
  effect: 'CONSTRAIN_POPULATION',
  targetPopulationManifestId: 'cov_man_prospective_2026q3',
  sourceId: 'src_gmgn_free_aggregate',
  startTime: '2026-08-20T13:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T13:30:00Z' as UtcTimestamp,
  blocksPublication: true,
  detail: 'Aggregate provider 30-minute outage; first-party observation spine maintained independently',
  recordedAt: '2026-08-20T13:00:10Z' as UtcTimestamp,
};

export const BENIGN_INCIDENT_CONSTRAINT_FIXTURE: PopulationConstraintFixture = {
  constraintId: 'cst_benign_subslot_005',
  kind: 'COLLECTOR_GAP',
  effect: 'RECORD_INCIDENT_ONLY',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  sourceId: 'col_solana_pump_live',
  startSlot: '300100900',
  endSlot: '300100900',
  startTime: '2026-08-20T14:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T14:00:00.400Z' as UtcTimestamp,
  blocksPublication: false,
  detail: 'Isolated empty slot gap resolved via immediate backfill; incident recorded for audit',
  recordedAt: '2026-08-20T14:00:01Z' as UtcTimestamp,
};

export const ALL_POPULATION_CONSTRAINTS: readonly PopulationConstraintFixture[] = [
  COLLECTOR_GAP_CONSTRAINT_FIXTURE,
  DECODER_PAUSE_CONSTRAINT_FIXTURE,
  UNVERIFIED_PROGRAM_VERSION_CONSTRAINT_FIXTURE,
  PROVIDER_HEALTH_UNAVAILABLE_CONSTRAINT_FIXTURE,
  BENIGN_INCIDENT_CONSTRAINT_FIXTURE,
];

// -----------------------------------------------------------------------------
// 2. Incomplete / invalid constraint vectors (refusals)
// -----------------------------------------------------------------------------

export const INVALID_CONSTRAINT_UNKNOWN_KIND = {
  constraintId: 'cst_invalid_kind',
  kind: 'WEATHER_ANOMALY',
  effect: 'CONSTRAIN_POPULATION',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  blocksPublication: true,
  detail: 'Invalid constraint kind',
  recordedAt: '2026-08-20T10:00:00Z',
};

export const INVALID_CONSTRAINT_UNKNOWN_EFFECT = {
  constraintId: 'cst_invalid_effect',
  kind: 'COLLECTOR_GAP',
  effect: 'IGNORE_AND_OVERWRITE',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  blocksPublication: true,
  detail: 'Invalid constraint effect',
  recordedAt: '2026-08-20T10:00:00Z',
};

export const INVALID_CONSTRAINT_INVERTED_SLOTS = {
  constraintId: 'cst_inverted_slots',
  kind: 'COLLECTOR_GAP',
  effect: 'CONSTRAIN_POPULATION',
  targetPopulationManifestId: 'cov_man_pump_raydium_2026q3',
  startSlot: '300100200',
  endSlot: '300100100', // Inverted: endSlot < startSlot
  blocksPublication: true,
  detail: 'Inverted slot range',
  recordedAt: '2026-08-20T10:00:00Z',
};

export const INVALID_CONSTRAINT_MISSING_TARGET_MANIFEST = {
  constraintId: 'cst_missing_manifest',
  kind: 'COLLECTOR_GAP',
  effect: 'CONSTRAIN_POPULATION',
  blocksPublication: true,
  detail: 'Missing target population manifest ID',
  recordedAt: '2026-08-20T10:00:00Z',
};
