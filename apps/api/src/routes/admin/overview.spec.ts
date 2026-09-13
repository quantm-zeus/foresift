/**
 * Provider-call-free overview read-model tests
 * (T016, FR-ADM-001, AC-060, AC-061, AC-062, AC-063, AC-260…AC-264).
 *
 * Proves the §28.2 guarantees on PGlite with injected read ports:
 *   - one refresh assembles EVERY required §28.2/§33.6 section with provenance
 *     and freshness, NEVER reaches a spy provider/model/notification port, and
 *     writes EXACTLY ONE snapshot with zero provider calls and zero external
 *     writes;
 *   - the port surface is read-only by construction (no mutating method and no
 *     provider/model/notification method);
 *   - alert precision/recall carries its sample size and confidence interval and
 *     never pools EARLY_WATCH into the confirmed denominator;
 *   - missed gems group by the twelve §28.9 categories;
 *   - a stale/unavailable/refused source renders explicit UNKNOWN/insufficient
 *     and can never be reported as a fresh complete refresh;
 *   - a provider incident cannot render as fresh complete;
 *   - the freshness/grouping decisions survive a globally shadowed
 *     `Array.prototype` (audit NEW-M4/NEW-M5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ALL_KILL_SWITCH_KINDS,
  ALL_OVERVIEW_SECTION_KEYS,
  type KillSwitchKind,
} from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../../../tests/acceptance/helpers.ts';
import {
  ADMIN_OVERVIEW_SOURCE_PORT_METHODS,
  ALL_MISSED_GEM_CATEGORIES,
  MissedGemCategory,
  assertReadOnlyOverviewSourcePorts,
  createAdminOverviewSourcePorts,
  freshnessForExpiry,
  groupMissedGemClassifications,
  unknownRead,
  worstFreshness,
  type ActiveSchedulesPayload,
  type AdminOverviewSourcePorts,
  type AlertPrecisionRecallPayload,
  type BackupStatusPayload,
  type CandidateCountsPayload,
  type CostPayload,
  type FunnelFailuresPayload,
  type KillSwitchStatePayload,
  type KillSwitchSubState,
  type MissedGemsPayload,
  type ProviderIncidentsPayload,
  type QuotaForecastPayload,
  type RecoveryReadinessPayload,
  type ScheduleDriftPayload,
  type SourceRead,
  type StorageGrowthPayload,
  type SystemModePayload,
  type WorkflowCountsPayload,
} from './overview-sources.ts';
import {
  assembleOverview,
  createOverviewSnapshotSink,
  type AdminOverviewPorts,
  type AssembledOverview,
} from './overview.ts';

const NOW_MS = Date.parse('2026-09-01T12:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const EXPIRES = new Date(NOW_MS + 5 * 60 * 1000).toISOString();
const HASH = `sha256:${'a'.repeat(64)}`;

const SYSTEM_MODE_PAYLOAD: SystemModePayload = {
  systemMode: 'ACTIVE',
  lifecycleCounts: { ACTIVE: 1 },
  containmentOpenCount: 0,
  containmentRefs: [],
  posture: 'SLA_BACKED',
  postureMissingSlaRefs: [],
  postureEvidenceRefs: ['prod.best_effort_declarations:d1'],
  activationScopeCount: 1,
  activationAnyRefused: false,
  activationAnyExpired: false,
  activationRefs: ['eval-1'],
};

const PROVIDER_INCIDENTS_PAYLOAD: ProviderIncidentsPayload = { incidents: [], openCount: 0 };

const QUOTA_PAYLOAD: QuotaForecastPayload = {
  forecastId: 'forecast-1',
  planVersionId: 'version-1',
  scheduleId: 'schedule-1',
  computedAt: NOW,
  expiresAt: EXPIRES,
  runsPerDay: 12,
  providerCallsPerDay: 240,
  modelTokensPerDay: 48000,
  estimatedModelSpendPerDay: '3.25',
  quotaExhaustionDate: '2026-10-01',
  storageGrowthPerMonth: 1048576,
  quotaBalances: [],
};

const ACTIVE_SCHEDULES_PAYLOAD: ActiveSchedulesPayload = {
  schedules: [
    {
      scheduleId: 'schedule-1',
      name: 'hourly',
      status: 'ACTIVE',
      shadow: false,
      currentVersionId: 'version-1',
    },
  ],
  activeCount: 1,
  pausedCount: 0,
  disabledCount: 0,
  draftCount: 0,
};

const SCHEDULE_DRIFT_PAYLOAD: ScheduleDriftPayload = {
  reports: [],
  latestCheckedAt: NOW,
  incidentRefs: [],
  repairedRefs: [],
  driftDetected: false,
};

const WORKFLOW_COUNTS_PAYLOAD: WorkflowCountsPayload = {
  runsByStatus: { RUNNING: 2, WAITING: 1 },
  deadLetterCounts: { OPEN: 1 },
  outboxCounts: { PENDING: 3 },
  pendingRuns: 0,
  runningRuns: 2,
  waitingRuns: 1,
  openDeadLetters: 1,
  waitingSteps: 1,
};

const CANDIDATE_COUNTS_PAYLOAD: CandidateCountsPayload = {
  byLifecycleState: { CONFIRMED: 3 },
  byRiskState: { HIGH: 1 },
  total: 3,
};

const FUNNEL_FAILURES_PAYLOAD: FunnelFailuresPayload = {
  failures: [{ stage: 'RESEARCH_PRIORITY_RANKING', gateCode: 'BELOW_CUTOFF', count: 2 }],
  total: 2,
};

const COST_PAYLOAD: CostPayload = {
  windowStart: NOW,
  windowEnd: EXPIRES,
  modelCostUsd: 4.5,
  providerCostUsd: 1.25,
  totalCostUsd: 5.75,
  byDimension: { MODEL: 4.5, DATA_PROVIDER: 1.25 },
  budgetLimitUsd: 50,
  budgetUtilization: 0.115,
};

const STORAGE_GROWTH_PAYLOAD: StorageGrowthPayload = {
  measuredAt: NOW,
  totalBytes: 1_048_576,
  objectCount: 4,
  bytesPerDay: 1024,
  bytesPerMonth: 30720,
  growthPerMonth: 30720,
};

const BACKUP_STATUS_PAYLOAD: BackupStatusPayload = {
  latestRunId: 'backup-1',
  latestBackupAt: NOW,
  latestBackupStatus: 'SUCCEEDED',
  artifactRefs: ['artifact-1'],
  policyId: 'policy-1',
  policyValidated: true,
  rpoTargetMinutes: 60,
  measuredRpoMinutes: 15,
  drillId: 'drill-1',
  drillOutcome: 'PASSED',
  drillFinishedAt: NOW,
  credentialProviderPresent: true,
  healthKind: 'HEALTHY',
  confirmedOpportunityInfluenceBlocked: false,
  deterministicRiskMonitoringAllowed: true,
};

const RECOVERY_READINESS_PAYLOAD: RecoveryReadinessPayload = {
  drillId: 'drill-1',
  outcome: 'PASSED',
  verifications: [{ name: 'database-migration-state', passed: true, detail: 'ok' }],
  executedChecks: ['database-migration-state'],
  resumeBlockers: [],
  automationResumeAllowed: true,
  measuredRpoMinutesByTier: { 'tier-1': 15 },
  rpoTargetMinutesByTier: { 'tier-1': 60 },
  openIncidentRefs: [],
};

function killSwitchPayload(): KillSwitchStatePayload {
  const switches: KillSwitchSubState[] = [];
  for (let index = 0; index < ALL_KILL_SWITCH_KINDS.length; index += 1) {
    const kind = ALL_KILL_SWITCH_KINDS[index] as KillSwitchKind;
    switches[switches.length] = {
      switchKind: kind,
      state: 'DISENGAGED',
      closed: false,
      degraded: false,
      reason: null,
      stateRowId: `ks-${kind}`,
    };
  }
  return { switches, engaged: [], readOnlyEmergencyEngaged: false };
}

function alertPrecisionRecallPayload(): AlertPrecisionRecallPayload {
  return {
    windowStart: NOW,
    windowEnd: NOW,
    confirmed: [
      {
        alertClass: 'CONFIRMED_OPPORTUNITY',
        metricKey: 'CONFIRMED_PRECISION',
        numerator: 8,
        denominator: 10,
        sampleSize: 10,
        observationCount: 1,
        rate: 0.8,
        windowStart: NOW,
        windowEnd: NOW,
        confidenceInterval: {
          method: 'WILSON_SCORE_95',
          pointEstimate: 0.8,
          lowerBound: 0.49,
          upperBound: 0.94,
          effectiveIndependentSampleSize: 10,
          naiveSampleSize: 10,
          essGatePassed: true,
        },
      },
      {
        alertClass: 'CONFIRMED_OPPORTUNITY',
        metricKey: 'CONFIRMED_RECALL',
        numerator: 6,
        denominator: 10,
        sampleSize: 10,
        observationCount: 1,
        rate: 0.6,
        windowStart: NOW,
        windowEnd: NOW,
        confidenceInterval: {
          method: 'WILSON_SCORE_95',
          pointEstimate: 0.6,
          lowerBound: 0.31,
          upperBound: 0.83,
          effectiveIndependentSampleSize: 10,
          naiveSampleSize: 10,
          essGatePassed: true,
        },
      },
    ],
    earlyWatch: [
      {
        alertClass: 'EARLY_WATCH',
        metricKey: 'EARLY_WATCH_PRECISION',
        numerator: 3,
        denominator: 25,
        sampleSize: 25,
        observationCount: 1,
        rate: 0.12,
        windowStart: NOW,
        windowEnd: NOW,
        confidenceInterval: {
          method: 'WILSON_SCORE_95',
          pointEstimate: 0.12,
          lowerBound: 0.04,
          upperBound: 0.3,
          effectiveIndependentSampleSize: 25,
          naiveSampleSize: 25,
          essGatePassed: true,
        },
      },
    ],
    perClassDenominators: { CONFIRMED_OPPORTUNITY: 10, EARLY_WATCH: 25 },
    perClassSampleSizes: { CONFIRMED_OPPORTUNITY: 10, EARLY_WATCH: 25 },
    perMetricDenominators: {
      'CONFIRMED_OPPORTUNITY:CONFIRMED_PRECISION': 10,
      'CONFIRMED_OPPORTUNITY:CONFIRMED_RECALL': 10,
      'EARLY_WATCH:EARLY_WATCH_PRECISION': 25,
    },
    sampleSize: 10,
    confidenceInterval: {
      method: 'WILSON_SCORE_95',
      pointEstimate: 0.8,
      lowerBound: 0.49,
      upperBound: 0.94,
      effectiveIndependentSampleSize: 10,
      naiveSampleSize: 10,
      essGatePassed: true,
    },
    neverPoolsEarlyWatch: true,
    ownerGuards: ['computeConfirmedOpportunityMetrics', 'assertNoEarlyWatchInConfirmedDenominator'],
  };
}

function missedGemCategories(): MissedGemsPayload['categories'] {
  const categories: MissedGemsPayload['categories'] = [];
  for (let index = 0; index < ALL_MISSED_GEM_CATEGORIES.length; index += 1) {
    categories[categories.length] = ALL_MISSED_GEM_CATEGORIES[
      index
    ] as MissedGemsPayload['categories'][number];
  }
  return categories;
}

function missedGemsPayload(): MissedGemsPayload {
  const groups: MissedGemsPayload['groups'] = [];
  for (let index = 0; index < ALL_MISSED_GEM_CATEGORIES.length; index += 1) {
    const category = ALL_MISSED_GEM_CATEGORIES[
      index
    ] as MissedGemsPayload['groups'][number]['category'];
    groups[groups.length] = { category, count: 0, candidateRefs: [] };
  }
  groups[0] = { category: MissedGemCategory.NOT_DISCOVERED, count: 2, candidateRefs: ['c1', 'c2'] };
  groups[1] = { category: MissedGemCategory.PROVIDER_LAG, count: 1, candidateRefs: ['c3'] };
  return {
    groups,
    categories: missedGemCategories(),
    total: 3,
    windowStart: null,
    windowEnd: null,
  };
}

function fresh<T>(payload: T, ownerPackage: string, rowRefs: readonly string[]): SourceRead<T> {
  return {
    ownerPackage,
    freshness: 'FRESH',
    rowRefs,
    qualityCodes: [],
    detail: null,
    computedAt: NOW,
    expiresAt: EXPIRES,
    payload,
  };
}

function makeSources(overrides: Partial<AdminOverviewSourcePorts> = {}): AdminOverviewSourcePorts {
  const base: AdminOverviewSourcePorts = {
    readSystemMode: async () =>
      fresh(SYSTEM_MODE_PAYLOAD, '@foresift/capability-registry', ['prod.module_states:m1']),
    readKillSwitchState: async () =>
      fresh(killSwitchPayload(), '@foresift/api/admin', ['adm.kill_switch_states:global']),
    readProviderIncidents: async () =>
      fresh(PROVIDER_INCIDENTS_PAYLOAD, '@foresift/provider-lifecycle', [
        'prov.prov_operations:h1',
      ]),
    readQuotaExhaustionForecast: async () =>
      fresh(QUOTA_PAYLOAD, '@foresift/workflow-runtime', ['wf.schedule_forecasts:forecast-1']),
    readActiveSchedules: async () =>
      fresh(ACTIVE_SCHEDULES_PAYLOAD, '@foresift/workflow-runtime', ['wf.schedules:schedule-1']),
    readScheduleDrift: async () =>
      fresh(SCHEDULE_DRIFT_PAYLOAD, '@foresift/workflow-runtime', ['wf.reconciliation_reports:r1']),
    readWorkflowCounts: async () =>
      fresh(WORKFLOW_COUNTS_PAYLOAD, '@foresift/workflow-runtime', ['wf.runs:count']),
    readCandidateCounts: async () =>
      fresh(CANDIDATE_COUNTS_PAYLOAD, '@foresift/signal-intelligence', [
        'sig.candidate_lifecycle:latest',
      ]),
    readAlertPrecisionRecall: async () =>
      fresh(alertPrecisionRecallPayload(), '@foresift/alerts', [
        'alert.alert_metric_observations:window',
      ]),
    readMissedGems: async () =>
      fresh(missedGemsPayload(), '@foresift/evaluation', ['missed_opportunities:c1']),
    readFunnelFailures: async () =>
      fresh(FUNNEL_FAILURES_PAYLOAD, '@foresift/signal-intelligence', [
        'sig.candidate_funnel_stages:failed',
      ]),
    readModelProviderCost: async () =>
      fresh(COST_PAYLOAD, '@foresift/cost-router', ['cost.budget_consumption_totals:head']),
    readStorageGrowth: async () =>
      fresh(STORAGE_GROWTH_PAYLOAD, '@foresift/persistence', ['object_artifacts:sum']),
    readLatestBackupStatus: async () =>
      fresh(BACKUP_STATUS_PAYLOAD, '@foresift/persistence', ['backup_runs:backup-1']),
    readRecoveryReadiness: async () =>
      fresh(RECOVERY_READINESS_PAYLOAD, '@foresift/persistence', ['restore_drills:drill-1']),
  };
  const merged: Record<string, unknown> = {};
  const baseRecord = base as unknown as Record<string, unknown>;
  let keyIndex = 0;
  const baseKeys = Object.keys(baseRecord);
  while (keyIndex < baseKeys.length) {
    const key = baseKeys[keyIndex] as string;
    merged[key] = baseRecord[key];
    keyIndex += 1;
  }
  if (overrides !== undefined) {
    const overrideRecord = overrides as unknown as Record<string, unknown>;
    const overrideKeys = Object.keys(overrideRecord);
    let overrideIndex = 0;
    while (overrideIndex < overrideKeys.length) {
      const key = overrideKeys[overrideIndex] as string;
      merged[key] = overrideRecord[key];
      overrideIndex += 1;
    }
  }
  return merged as unknown as AdminOverviewSourcePorts;
}

interface SpyBundle {
  readonly providerClient: { calls: number; complete: () => Promise<void> };
  readonly modelRouter: { calls: number; invoke: () => Promise<void> };
  readonly notificationChannel: { calls: number; send: () => Promise<void> };
}

function makeSpies(): SpyBundle {
  const providerClient = {
    calls: 0,
    async complete(): Promise<void> {
      providerClient.calls += 1;
    },
  };
  const modelRouter = {
    calls: 0,
    async invoke(): Promise<void> {
      modelRouter.calls += 1;
    },
  };
  const notificationChannel = {
    calls: 0,
    async send(): Promise<void> {
      notificationChannel.calls += 1;
    },
  };
  return { providerClient, modelRouter, notificationChannel };
}

function sectionByKey(
  result: AssembledOverview,
  key: string,
): AssembledOverview['sections'][number] {
  for (let index = 0; index < result.sections.length; index += 1) {
    const section = result.sections[index];
    if (section !== undefined && section.sectionKey === key) return section;
  }
  throw new Error(`section '${key}' is missing`);
}

let tdb: TestDatabase;
let snapshotSink: AdminOverviewPorts['snapshots'];

beforeAll(async () => {
  tdb = await makeTestDatabase();
  snapshotSink = createOverviewSnapshotSink({ engine: tdb.engine });
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('provider-call-free overview refresh (§28.2, AC-060)', () => {
  it('assembles every required section, never reaches a spy port, and writes exactly one zero-call snapshot', async () => {
    const sources = makeSources();
    const spies = makeSpies();
    // The spy clients ride on the SAME object handed to the assembly: they are
    // structurally out of scope, so the assertion below proves non-invocation
    // rather than trusting a convention.
    const deps = { sources, snapshots: snapshotSink, ...spies };

    const before = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.overview_snapshots`,
    );
    const result = await assembleOverview(deps, () => NOW_MS);
    const after = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.overview_snapshots`,
    );

    expect(result.sections.length).toBe(ALL_OVERVIEW_SECTION_KEYS.length);
    for (let index = 0; index < ALL_OVERVIEW_SECTION_KEYS.length; index += 1) {
      const key = ALL_OVERVIEW_SECTION_KEYS[index];
      const section = sectionByKey(result, key as string);
      expect(section.ownerPackage.length).toBeGreaterThan(0);
      expect(section.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(result.complete).toBe(true);
    expect(result.freshness).toBe('FRESH');
    expect(result.providerCallsTriggered).toBe(0);
    expect(result.externalWriteAttempts).toBe(0);

    expect(spies.providerClient.calls).toBe(0);
    expect(spies.modelRouter.calls).toBe(0);
    expect(spies.notificationChannel.calls).toBe(0);

    expect((after.rows[0]?.count ?? 0) - (before.rows[0]?.count ?? 0)).toBe(1);
    const snapshotRow = await tdb.engine.query<{
      provider_calls_triggered: number;
      external_write_attempts: number;
      system_mode: string;
      sections: unknown;
      section_hashes: unknown;
      source_refs: unknown;
    }>(
      `SELECT provider_calls_triggered, external_write_attempts, system_mode,
              sections, section_hashes, source_refs
         FROM adm.overview_snapshots
        ORDER BY generated_at DESC, snapshot_id DESC
        LIMIT 1`,
    );
    expect(snapshotRow.rows[0]?.provider_calls_triggered).toBe(0);
    expect(snapshotRow.rows[0]?.external_write_attempts).toBe(0);
    expect(snapshotRow.rows[0]?.system_mode).toBe('ACTIVE');
    // The PERSISTED read model really names every section, with hashes.
    const persistedSections = snapshotRow.rows[0]?.sections;
    expect(Array.isArray(persistedSections) ? persistedSections.length : -1).toBe(15);
    const persistedHashes = snapshotRow.rows[0]?.section_hashes;
    expect(
      persistedHashes !== null && typeof persistedHashes === 'object'
        ? Object.getOwnPropertyNames(persistedHashes).length
        : -1,
    ).toBe(15);
    const persistedRefs = snapshotRow.rows[0]?.source_refs;
    expect(Array.isArray(persistedRefs) ? persistedRefs.length : 0).toBeGreaterThan(0);
  }, 120_000);

  it('exposes a read-only, provider-free port surface with no mutating method', () => {
    const sources = makeSources();
    expect(ADMIN_OVERVIEW_SOURCE_PORT_METHODS.length).toBe(15);
    for (let index = 0; index < ADMIN_OVERVIEW_SOURCE_PORT_METHODS.length; index += 1) {
      const name = ADMIN_OVERVIEW_SOURCE_PORT_METHODS[index] as string;
      expect(name.startsWith('read')).toBe(true);
    }
    expect(() => assertReadOnlyOverviewSourcePorts(sources)).not.toThrow();
    expect(() => assertReadOnlyOverviewSourcePorts({ readSystemMode: () => undefined })).toThrow();

    const ownNames = Object.getOwnPropertyNames(sources);
    for (let index = 0; index < ownNames.length; index += 1) {
      const name = ownNames[index] as string;
      expect(name.startsWith('read')).toBe(true);
    }
  }, 120_000);
});

describe('alert precision/recall provenance and EARLY_WATCH exclusion (AC-060)', () => {
  it('carries sample size and confidence interval and never pools EARLY_WATCH', async () => {
    const result = await assembleOverview(
      { sources: makeSources(), snapshots: snapshotSink },
      () => NOW_MS,
    );
    const section = sectionByKey(result, 'ALERT_PRECISION_RECALL');
    const payload = section.payload as AlertPrecisionRecallPayload;

    // The confirmed sample size is the shared population behind each confirmed
    // metric, consistent with the reported interval (never an inflated sum).
    expect(payload.sampleSize).toBe(10);
    expect(payload.confidenceInterval).not.toBeNull();
    expect(payload.confidenceInterval?.method).toBe('WILSON_SCORE_95');
    expect(payload.confidenceInterval?.effectiveIndependentSampleSize).toBe(10);
    expect(payload.neverPoolsEarlyWatch).toBe(true);

    for (let index = 0; index < payload.confirmed.length; index += 1) {
      const metric = payload.confirmed[index];
      expect(metric?.alertClass).toBe('CONFIRMED_OPPORTUNITY');
      expect(metric?.sampleSize).toBeGreaterThan(0);
      expect(metric?.confidenceInterval).not.toBeNull();
      expect(metric?.confidenceInterval?.effectiveIndependentSampleSize).toBe(metric?.sampleSize);
    }
    // The early-watch denominator is reported SEPARATELY (a class population,
    // not a sum over precision+recall) and is excluded from the confirmed
    // class denominator.
    expect(payload.perClassDenominators['EARLY_WATCH']).toBe(25);
    expect(payload.perClassDenominators['CONFIRMED_OPPORTUNITY']).toBe(10);
    expect(payload.perMetricDenominators['EARLY_WATCH:EARLY_WATCH_PRECISION']).toBe(25);
    expect(payload.perClassDenominators['CONFIRMED_OPPORTUNITY']).not.toBeGreaterThanOrEqual(
      payload.perClassDenominators['EARLY_WATCH'] ?? 0,
    );
  }, 120_000);
});

describe('missed gems are grouped by the §28.9 categories (AC-061)', () => {
  it('groups every miss classification into exactly the twelve §28.9 buckets', () => {
    const grouped = groupMissedGemClassifications([
      { candidateRef: 'c1', missClassification: 'NOT_DISCOVERED' },
      { candidateRef: 'c2', missClassification: 'PROVIDER_LATE' },
      { candidateRef: 'c3', missClassification: 'RANK_BELOW_CUTOFF' },
      { candidateRef: 'c4', missClassification: 'ALERT_TOO_LATE' },
    ]);
    expect(grouped.total).toBe(4);
    expect(grouped.groups.length).toBe(ALL_MISSED_GEM_CATEGORIES.length);
    expect(ALL_MISSED_GEM_CATEGORIES.length).toBe(12);

    let notDiscovered = 0;
    let providerLag = 0;
    let rankingBelowCutoff = 0;
    let alertTooLate = 0;
    for (let index = 0; index < grouped.groups.length; index += 1) {
      const group = grouped.groups[index];
      if (group === undefined) continue;
      if (group.category === MissedGemCategory.NOT_DISCOVERED) notDiscovered = group.count;
      if (group.category === MissedGemCategory.PROVIDER_LAG) providerLag = group.count;
      if (group.category === MissedGemCategory.RANKING_BELOW_CUTOFF)
        rankingBelowCutoff = group.count;
      if (group.category === MissedGemCategory.ALERT_DELIVERED_TOO_LATE) alertTooLate = group.count;
    }
    expect(notDiscovered).toBe(1);
    expect(providerLag).toBe(1);
    expect(rankingBelowCutoff).toBe(1);
    expect(alertTooLate).toBe(1);
  }, 120_000);

  it('renders the grouped categories inside the MISSED_GEMS section', async () => {
    const result = await assembleOverview(
      { sources: makeSources(), snapshots: snapshotSink },
      () => NOW_MS,
    );
    const payload = sectionByKey(result, 'MISSED_GEMS').payload as MissedGemsPayload;
    expect(payload.categories.length).toBe(12);
    expect(payload.total).toBe(3);
  }, 120_000);
});

describe('unknown/stale/refused sources render explicitly (AC-061, AC-062)', () => {
  it('never drops a section, never claims fresh complete, and still writes one snapshot', async () => {
    const sources = makeSources({
      readQuotaExhaustionForecast: async () =>
        unknownRead('@foresift/workflow-runtime', 'no forecast recorded', NOW),
      readLatestBackupStatus: async () => ({
        ownerPackage: '@foresift/persistence',
        freshness: 'STALE',
        rowRefs: ['backup_runs:stale'],
        qualityCodes: ['BACKUP_NOT_SUCCEEDED'],
        detail: 'the latest backup did not succeed',
        computedAt: NOW,
        expiresAt: EXPIRES,
        payload: { ...BACKUP_STATUS_PAYLOAD, latestBackupStatus: 'FAILED' },
      }),
      readModelProviderCost: async () => ({
        ownerPackage: '@foresift/cost-router',
        freshness: 'REFUSED',
        rowRefs: [],
        qualityCodes: ['SOURCE_REFUSED'],
        detail: 'cost owner refused the read',
        computedAt: NOW,
        expiresAt: null,
        payload: null,
      }),
    });
    const before = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.overview_snapshots`,
    );
    const result = await assembleOverview({ sources, snapshots: snapshotSink }, () => NOW_MS);
    const after = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.overview_snapshots`,
    );

    expect(result.sections.length).toBe(15);
    const quota = sectionByKey(result, 'QUOTA_EXHAUSTION_FORECAST');
    expect(quota.freshness).toBe('UNKNOWN');
    expect(quota.payload).toBeNull();
    expect(quota.detail).not.toBeNull();

    const backup = sectionByKey(result, 'LATEST_BACKUP_STATUS');
    expect(backup.freshness).toBe('STALE');
    expect(backup.qualityCodes).toContain('BACKUP_NOT_SUCCEEDED');

    const cost = sectionByKey(result, 'MODEL_PROVIDER_COST');
    expect(cost.freshness).toBe('REFUSED');
    expect(cost.payload).toBeNull();

    expect(result.complete).toBe(false);
    expect(result.freshness).toBe('REFUSED');
    expect((after.rows[0]?.count ?? 0) - (before.rows[0]?.count ?? 0)).toBe(1);
  }, 120_000);

  it('never renders an open provider incident as fresh complete, even with a lying count', async () => {
    const incident: ProviderIncidentsPayload = {
      incidents: [
        {
          providerId: 'p1',
          operationId: 'op1',
          version: 'v1',
          incidentRef: 'prov:p1:op1:v1',
          healthStatus: 'QUOTA_EXHAUSTED',
          currentState: 'DEGRADED',
          reasonClass: 'QUOTA',
          occurredAt: NOW,
        },
      ],
      // The injected port LIES about the count as well as the freshness; the
      // incident LIST is authoritative and must still floor the section.
      openCount: 0,
    };
    const sources = makeSources({
      readProviderIncidents: async () =>
        fresh(incident, '@foresift/provider-lifecycle', ['prov:p1:op1:v1']),
    });
    const result = await assembleOverview({ sources, snapshots: snapshotSink }, () => NOW_MS);
    const section = sectionByKey(result, 'PROVIDER_INCIDENTS');
    expect(section.freshness).not.toBe('FRESH');
    expect(section.freshness).toBe('STALE');
    expect(result.complete).toBe(false);
  }, 120_000);
});

describe('injected-port trust-boundary hardening', () => {
  it('degrades a FRESH marker with a null payload to UNKNOWN, never fresh complete', async () => {
    const sources = makeSources({
      readStorageGrowth: async () => ({
        ownerPackage: '@foresift/persistence',
        freshness: 'FRESH',
        rowRefs: ['object_artifacts:sum'],
        qualityCodes: [],
        detail: null,
        computedAt: NOW,
        expiresAt: EXPIRES,
        payload: null,
      }),
    });
    const result = await assembleOverview({ sources, snapshots: snapshotSink }, () => NOW_MS);
    const section = sectionByKey(result, 'STORAGE_GROWTH');
    expect(section.freshness).toBe('UNKNOWN');
    expect(section.payload).toBeNull();
    expect(result.complete).toBe(false);
  }, 120_000);

  it('treats an observation past its declared expiry as STALE', async () => {
    const sources = makeSources({
      readActiveSchedules: async () => ({
        ownerPackage: '@foresift/workflow-runtime',
        freshness: 'FRESH',
        rowRefs: ['wf.schedules:schedule-1'],
        qualityCodes: [],
        detail: null,
        computedAt: new Date(NOW_MS - 3_600_000).toISOString(),
        expiresAt: new Date(NOW_MS - 60_000).toISOString(),
        payload: ACTIVE_SCHEDULES_PAYLOAD,
      }),
    });
    const result = await assembleOverview({ sources, snapshots: snapshotSink }, () => NOW_MS);
    expect(sectionByKey(result, 'ACTIVE_SCHEDULES').freshness).toBe('STALE');
    expect(result.complete).toBe(false);
  }, 120_000);

  it('survives malformed rowRefs/qualityCodes without dropping the section', async () => {
    const sources = makeSources({
      readFunnelFailures: async () => ({
        ownerPackage: '@foresift/signal-intelligence',
        freshness: 'FRESH',
        rowRefs: undefined as unknown as readonly string[],
        qualityCodes: undefined as unknown as readonly string[],
        detail: null,
        computedAt: NOW,
        expiresAt: EXPIRES,
        payload: FUNNEL_FAILURES_PAYLOAD,
      }),
    });
    const result = await assembleOverview({ sources, snapshots: snapshotSink }, () => NOW_MS);
    const section = sectionByKey(result, 'FUNNEL_FAILURES');
    expect(section.freshness).toBe('FRESH');
    expect(section.rowRefs.length).toBeGreaterThan(0);
    expect(result.sections.length).toBe(15);
  }, 120_000);
});

describe('freshness decisions resist Array.prototype shadowing (NEW-M4/NEW-M5)', () => {
  it('keeps worst-of-freshness and §28.9 grouping correct under global array shadows', () => {
    const shadowCases: { name: string; install: () => void; restore: () => void }[] = [];
    const proto = Array.prototype as unknown as Record<string, unknown>;
    const methods: readonly (readonly [string, unknown])[] = [
      ['includes', () => true],
      ['map', () => []],
      ['filter', () => []],
      ['some', () => true],
      ['find', () => undefined],
      ['forEach', () => undefined],
      ['push', () => 0],
    ];
    for (let index = 0; index < methods.length; index += 1) {
      const entry = methods[index] as readonly [string, unknown];
      const methodName = entry[0];
      const replacement = entry[1];
      const original = proto[methodName];
      shadowCases[shadowCases.length] = {
        name: `Array.prototype.${methodName}`,
        install: () => {
          proto[methodName] = replacement;
        },
        restore: () => {
          proto[methodName] = original;
        },
      };
    }
    for (let index = 0; index < shadowCases.length; index += 1) {
      const shadowCase = shadowCases[index] as {
        name: string;
        install: () => void;
        restore: () => void;
      };
      shadowCase.install();
      try {
        expect(worstFreshness(['FRESH', 'STALE', 'FRESH']), shadowCase.name).toBe('STALE');
        expect(worstFreshness(['FRESH', 'REFUSED', 'UNKNOWN']), shadowCase.name).toBe('REFUSED');
        expect(worstFreshness([]), shadowCase.name).toBe('FRESH');
        expect(freshnessForExpiry('2026-09-01T11:00:00Z', NOW), shadowCase.name).toBe('STALE');
        expect(freshnessForExpiry(null, NOW), shadowCase.name).toBe('FRESH');
        const grouped = groupMissedGemClassifications([
          { candidateRef: 'c1', missClassification: 'NOT_DISCOVERED' },
          { candidateRef: 'c2', missClassification: 'PROVIDER_LATE' },
          { candidateRef: 'c3', missClassification: 'BUDGET_EXHAUSTED' },
        ]);
        expect(grouped.total, shadowCase.name).toBe(3);
        expect(grouped.groups.length, shadowCase.name).toBe(12);
      } finally {
        shadowCase.restore();
      }
    }
  }, 120_000);

  it('keeps assembly correct or fails closed under globally shadowed membership primitives', async () => {
    const proto = Array.prototype as unknown as Record<string, unknown>;
    const shadows: readonly (readonly [string, unknown])[] = [
      ['includes', () => false],
      ['some', () => false],
    ];
    for (let shadowIndex = 0; shadowIndex < shadows.length; shadowIndex += 1) {
      const entry = shadows[shadowIndex] as readonly [string, unknown];
      const name = entry[0];
      const original = proto[name];
      proto[name] = entry[1];
      const before = await tdb.engine.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM adm.overview_snapshots`,
      );
      try {
        const result = await assembleOverview(
          { sources: makeSources(), snapshots: snapshotSink },
          () => NOW_MS,
        );
        // If the third-party schema layer got through, MY decisions must still
        // be correct: every section present and genuinely complete.
        expect(result.sections.length, name).toBe(15);
        expect(result.complete, name).toBe(true);
        expect(result.freshness, name).toBe('FRESH');
      } catch (error) {
        // Otherwise the refresh must FAIL CLOSED with a typed admin error and
        // no fabricated snapshot, never a partial/fresh-lying read model.
        expect((error as { code?: string }).code, name).toBe('ADMIN_SURFACE_FAILURE');
      } finally {
        proto[name] = original;
      }
      const after = await tdb.engine.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM adm.overview_snapshots`,
      );
      expect((after.rows[0]?.count ?? 0) - (before.rows[0]?.count ?? 0), name).toBeLessThanOrEqual(
        1,
      );
    }
  }, 120_000);
});

// --- default owner-backed readers on real PGlite tables ----------------------

describe('default owner-backed read ports over real PGlite tables', () => {
  it('gathers workflow schedules/counts, alert metrics, storage and backup rows', async () => {
    await tdb.engine.query(
      `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status)
       VALUES ('sched-real-1', 'real schedule', 'SKIP_IF_RUNNING', 'ACTIVE')`,
    );
    await tdb.engine.query(
      `INSERT INTO object_artifacts
         (artifact_id, content_hash, encryption_status, retention_class, size_bytes, uploaded_at)
       VALUES ('artifact-real-1', $1, 'SERVER_SIDE_AES256', 'STANDARD', 2048, $2)`,
      [HASH, NOW],
    );
    await tdb.engine.query(
      `INSERT INTO backup_policies
         (policy_id, retention_days, encryption_status, location_ref, rights_ref,
          legal_hold, deletion_policy, key_reference)
       VALUES ('policy-real-1', 30, 'SERVER_SIDE_AES256', 'region:test', 'rights:test',
               false, 'delete-after-retention', 'keyref:test/kek')`,
    );
    await tdb.engine.query(
      `INSERT INTO backup_runs (run_id, policy_id, started_at, finished_at, status, artifact_refs)
       VALUES ('backup-real-1', 'policy-real-1', $1, $1, 'SUCCEEDED', ARRAY['artifact-real-1'])`,
      [NOW],
    );
    await tdb.engine.query(
      `INSERT INTO restore_drills (drill_id, started_at, finished_at, outcome, checks, credential_provider_present)
       VALUES ('drill-real-1', $1, $1, 'PASSED', $2::jsonb, true)`,
      [NOW, JSON.stringify([{ name: 'database-migration-state', passed: true, detail: 'ok' }])],
    );
    await tdb.engine.query(
      `INSERT INTO recovery_tiers (tier_id, data_class, rpo_target_minutes, rto_target_minutes)
       VALUES ('tier-real-1', 'CRITICAL_METADATA', 15, 30)`,
    );
    await tdb.engine.query(
      `INSERT INTO tier_measurements
         (measurement_id, tier_id, achieved_rpo_minutes, achieved_rto_minutes, outcome, measured_at)
       VALUES ('meas-real-1', 'tier-real-1', 5, 10, 'WITHIN_TIER', $1)`,
      [NOW],
    );
    await tdb.engine.query(
      `INSERT INTO alert.alert_metric_observations
         (metric_id, alert_class, metric_key, numerator, denominator, sample_size,
          window_start, window_end, observed_at)
       VALUES
         ('met-real-conf-p', 'CONFIRMED_OPPORTUNITY', 'CONFIRMED_PRECISION', 8, 10, 10, $1, $2, $1),
         ('met-real-conf-r', 'CONFIRMED_OPPORTUNITY', 'CONFIRMED_RECALL', 6, 10, 10, $1, $2, $1),
         ('met-real-early-p', 'EARLY_WATCH', 'EARLY_WATCH_PRECISION', 3, 25, 25, $1, $2, $1)`,
      [new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(), NOW],
    );
    // A WAITING run (with a step) so the waiting counts are real, not zero.
    await tdb.engine.query(
      `INSERT INTO wf.schedule_versions (version_id, schedule_id, config_hash, resolved_config)
       VALUES ('ver-real-1', 'sched-real-1', $1, '{}'::jsonb)`,
      [HASH],
    );
    await tdb.engine.query(
      `INSERT INTO wf.trigger_inbox
         (inbox_id, source, external_message_id, canonical_external_message_id, schedule_id,
          scheduled_for, payload_hash, received_at, status)
       VALUES ('inbox-real-1', 'test', 'msg-real-1', 'cmsg-real-1', 'sched-real-1', $1, $2, $1, 'PROCESSED')`,
      [NOW, HASH],
    );
    await tdb.engine.query(
      `INSERT INTO wf.runs
         (run_id, schedule_id, resolved_schedule_version, inbox_id, trigger_source,
          trigger_external_message_id, trigger_canonical_external_message_id,
          concurrency_policy, concurrency_outcome, status, deadline)
       VALUES ('run-real-1', 'sched-real-1', 'ver-real-1', 'inbox-real-1', 'test',
               'msg-real-1', 'cmsg-real-1', 'SKIP_IF_RUNNING', 'SKIP_IF_RUNNING', 'WAITING', $1)`,
      [new Date(NOW_MS + 3_600_000).toISOString()],
    );
    await tdb.engine.query(
      `INSERT INTO wf.steps (step_id, run_id, step_type, idempotency_key, status)
       VALUES ('step-real-1', 'run-real-1', 'collect', 'idem-real-1', 'PENDING')`,
    );

    const sources = createAdminOverviewSourcePorts({ engine: tdb.engine, clock: () => NOW_MS });

    const schedules = await sources.readActiveSchedules();
    expect(schedules.freshness).toBe('FRESH');
    expect(schedules.payload?.activeCount).toBeGreaterThanOrEqual(1);
    expect(schedules.rowRefs.length).toBeGreaterThan(0);

    const counts = await sources.readWorkflowCounts();
    expect(counts.freshness).toBe('FRESH');
    expect(counts.payload?.openDeadLetters).toBe(0);
    // `WAITING` is a RUN status; the step count must follow the waiting run.
    expect(counts.payload?.waitingRuns).toBe(1);
    expect(counts.payload?.waitingSteps).toBe(1);

    const alert = await sources.readAlertPrecisionRecall();
    expect(alert.freshness).toBe('FRESH');
    // Both confirmed metrics share the same 10-observation population; the
    // sample size is that population, not their 20-sum.
    expect(alert.payload?.sampleSize).toBe(10);
    expect(alert.payload?.perClassDenominators['CONFIRMED_OPPORTUNITY']).toBe(10);
    expect(alert.payload?.perClassDenominators['EARLY_WATCH']).toBe(25);
    expect(alert.payload?.perMetricDenominators['EARLY_WATCH:EARLY_WATCH_PRECISION']).toBe(25);
    for (let index = 0; index < (alert.payload?.confirmed.length ?? 0); index += 1) {
      expect(alert.payload?.confirmed[index]?.alertClass).toBe('CONFIRMED_OPPORTUNITY');
    }

    const storage = await sources.readStorageGrowth();
    expect(storage.freshness).toBe('FRESH');
    expect(storage.payload?.totalBytes).toBe(2048);

    const backup = await sources.readLatestBackupStatus();
    expect(backup.freshness).toBe('FRESH');
    expect(backup.payload?.latestBackupStatus).toBe('SUCCEEDED');
    expect(backup.payload?.policyValidated).toBe(true);
    expect(backup.payload?.drillOutcome).toBe('PASSED');
    expect(backup.payload?.measuredRpoMinutes).toBe(5);

    const recovery = await sources.readRecoveryReadiness();
    expect(recovery.freshness).toBe('FRESH');
    expect(recovery.payload?.automationResumeAllowed).toBe(true);
  }, 120_000);

  it('counts ONLY the active quota/budget period, never a closed one', async () => {
    const previous = new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString();
    const closedAt = new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString();
    const activeFrom = new Date(NOW_MS - 60 * 60 * 1000).toISOString();
    const activeUntil = new Date(NOW_MS + 60 * 60 * 1000).toISOString();
    await tdb.engine.query(
      `INSERT INTO cost.cost_quota_balances
         (provider_id, quota_model_id, period_window_start, period_reset_at, cap_limit,
          consumed_reserved, consumed_committed)
       VALUES
         ('prov-real', 'RATE_ONLY', $1, $2, 100, 40, 40),
         ('prov-real', 'RATE_ONLY', $3, $4, 200, 30, 10)`,
      [previous, closedAt, activeFrom, activeUntil],
    );
    await tdb.engine.query(
      `INSERT INTO cost.budget_consumption_totals
         (dimension, period_window_start, period_reset_at, cap_limit, consumed, rendered_classes)
       VALUES
         ('MODEL', $1, $2, 100, 50, '{"MODEL_SPEND":50}'),
         ('MODEL', $3, $4, 200, 20, '{"MODEL_SPEND":20}')`,
      [previous, closedAt, activeFrom, activeUntil],
    );

    const sources = createAdminOverviewSourcePorts({ engine: tdb.engine, clock: () => NOW_MS });

    const quota = await sources.readQuotaExhaustionForecast();
    expect(quota.payload?.quotaBalances.length).toBe(1);
    expect(quota.payload?.quotaBalances[0]?.capLimit).toBe(200);
    expect(quota.payload?.quotaBalances[0]?.remainingUnits).toBe(160);
    expect(quota.payload?.quotaBalances[0]?.periodWindowStart).toBe(activeFrom);

    const cost = await sources.readModelProviderCost();
    expect(cost.freshness).toBe('FRESH');
    expect(cost.payload?.modelCostUsd).toBe(20);
    expect(cost.payload?.budgetLimitUsd).toBe(200);
    expect(cost.payload?.totalCostUsd).toBe(20);
  }, 120_000);
});
