import type { UtcTimestamp } from '@foresift/domain';

export type CheapMonitorState =
  | 'NEW'
  | 'MONITORING_CHEAP'
  | 'PROMOTED_TO_VERIFY'
  | 'REJECTED_CHEAP'
  | 'EXPIRED_CHEAP';

export interface CheapMonitorRowFixture {
  readonly candidateId: string;
  readonly assetRepresentationId: string;
  readonly state: CheapMonitorState;
  readonly checkCount: number;
  readonly maxChecks: number;
  readonly backoffSeconds: number;
  readonly lastCheckedAt?: UtcTimestamp;
  readonly nextCheckDueAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly stalenessLimitSeconds: number;
  readonly decisionHistory: readonly string[];
}

export interface MonitorBatchDescriptorFixture {
  readonly batchId: string;
  readonly batchSize: number;
  readonly candidateIds: readonly string[];
  readonly providerId: string;
  readonly operationId: string;
  readonly scheduledAt: UtcTimestamp;
}

export const NEW_MONITOR_ROW: CheapMonitorRowFixture = {
  candidateId: 'cand_disc_001',
  assetRepresentationId: 'asset_rep_sol_pump_token_001',
  state: 'NEW',
  checkCount: 0,
  maxChecks: 10,
  backoffSeconds: 30,
  nextCheckDueAt: '2026-08-20T10:00:30.000Z' as UtcTimestamp,
  expiresAt: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
  stalenessLimitSeconds: 600,
  decisionHistory: [],
};

export const ACTIVE_MONITOR_ROW: CheapMonitorRowFixture = {
  candidateId: 'cand_disc_002',
  assetRepresentationId: 'asset_rep_sol_raydium_token_002',
  state: 'MONITORING_CHEAP',
  checkCount: 3,
  maxChecks: 10,
  backoffSeconds: 60,
  lastCheckedAt: '2026-08-20T10:05:00.000Z' as UtcTimestamp,
  nextCheckDueAt: '2026-08-20T10:06:00.000Z' as UtcTimestamp,
  expiresAt: '2026-08-20T12:05:00.000Z' as UtcTimestamp,
  stalenessLimitSeconds: 600,
  decisionHistory: ['MONITOR_CHEAP', 'MONITOR_CHEAP', 'MONITOR_CHEAP'],
};

export const PROMOTED_MONITOR_ROW: CheapMonitorRowFixture = {
  candidateId: 'cand_disc_003',
  assetRepresentationId: 'asset_rep_sol_pump_token_003',
  state: 'PROMOTED_TO_VERIFY',
  checkCount: 2,
  maxChecks: 10,
  backoffSeconds: 30,
  lastCheckedAt: '2026-08-20T10:02:00.000Z' as UtcTimestamp,
  nextCheckDueAt: '2026-08-20T10:02:30.000Z' as UtcTimestamp,
  expiresAt: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
  stalenessLimitSeconds: 600,
  decisionHistory: ['MONITOR_CHEAP', 'PROMOTE_TO_VERIFY'],
};

export const REJECTED_MONITOR_ROW: CheapMonitorRowFixture = {
  candidateId: 'cand_disc_004',
  assetRepresentationId: 'asset_rep_sol_dead_token_004',
  state: 'REJECTED_CHEAP',
  checkCount: 1,
  maxChecks: 10,
  backoffSeconds: 30,
  lastCheckedAt: '2026-08-20T10:01:00.000Z' as UtcTimestamp,
  nextCheckDueAt: '2026-08-20T10:01:30.000Z' as UtcTimestamp,
  expiresAt: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
  stalenessLimitSeconds: 600,
  decisionHistory: ['REJECT_CHEAP'],
};

export const EXPIRED_MONITOR_ROW: CheapMonitorRowFixture = {
  candidateId: 'cand_disc_005',
  assetRepresentationId: 'asset_rep_sol_stale_token_005',
  state: 'EXPIRED_CHEAP',
  checkCount: 10,
  maxChecks: 10,
  backoffSeconds: 120,
  lastCheckedAt: '2026-08-20T11:59:00.000Z' as UtcTimestamp,
  nextCheckDueAt: '2026-08-20T12:01:00.000Z' as UtcTimestamp,
  expiresAt: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
  stalenessLimitSeconds: 600,
  decisionHistory: Array(10).fill('MONITOR_CHEAP'),
};

export const MONITOR_BATCH_FIXTURE: MonitorBatchDescriptorFixture = {
  batchId: 'batch_disc_20260820_001',
  batchSize: 50,
  candidateIds: Array.from({ length: 50 }, (_, i) => `cand_disc_batch_${String(i).padStart(3, '0')}`),
  providerId: 'prov_gmgn',
  operationId: 'get_token_security',
  scheduledAt: '2026-08-20T10:10:00.000Z' as UtcTimestamp,
};
