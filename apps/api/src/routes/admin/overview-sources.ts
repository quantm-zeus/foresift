/**
 * §28.2/§33.6 provider-call-free overview READ PORTS
 * (T014, FR-ADM-001, PRD §28.2, §25.10, §28.9, §33.6, §35.1;
 * AC-060, AC-061, AC-062, AC-063, AC-260…AC-264).
 *
 * This module owns the READ-ONLY ports that gather each §28.2 section from its
 * owning package. The assembly read model (`overview.ts`) consumes these ports
 * and computes no metric, forecast, gate, or status of its own (plan D1).
 *
 * Structural no-provider guarantee (plan D2, ADR-G2ADM-3). {@link
 * AdminOverviewSourcePorts} exposes ONLY `read*` methods that return data; it
 * has no provider client, no model client, no notification channel, and no
 * mutating method. The §28.2 property ("Dashboard refresh MUST NOT trigger
 * external provider calls") is therefore a property of the TYPE, not a
 * convention, and `ADMIN_OVERVIEW_SOURCE_PORT_METHODS` is the frozen runtime
 * statement of that surface that the tests assert against.
 *
 * Every port returns a {@link SourceRead}: validated rows plus an EXPLICIT
 * freshness/quality marker (`FRESH|STALE|UNKNOWN|REFUSED`), the owning package,
 * the row refs the value came from, and a non-secret detail. An owner refusal
 * or an unreadable store never fabricates a fresh value: it degrades the
 * marker and nulls the payload, so the assembly renders it explicitly instead
 * of silently dropping the section.
 *
 * Shadow-safe discipline (in-process `Array.prototype` shadowing, audit
 * NEW-M4/NEW-M5). Every DECISION about freshness/completeness/membership and
 * every aggregation in this module walks arrays by NUMERIC INDEX and uses
 * `isOneOf` for membership — never `.map/.filter/.some/.find/.includes/.push`,
 * `for…of`, array spread, or `new Set(array)`. Display-only formatting may use
 * ordinary helpers.
 *
 * Strictly read-only: nothing here can trade, hold custody, sign, handle
 * private keys, or submit a transaction, and nothing here reaches a provider.
 */
import { z } from 'zod';
import {
  ALL_ALERT_CLASSES,
  ALL_MISS_CLASSIFICATIONS,
  isOneOf,
  type MissClassification,
} from '@foresift/domain';
import {
  ALL_KILL_SWITCH_KINDS,
  AlertClassSchema,
  AlertMetricKeySchema,
  CandidateRiskStateSchema,
  KillSwitchKindSchema,
  KillSwitchStateSchema,
  OverviewSectionKey,
  SystemModeSchema,
  UtcTimestampSchema,
  type AdminOverviewFreshness,
  type KillSwitchKind,
  type KillSwitchScope,
  type OverviewSectionKey as OverviewSectionKeyType,
} from '@foresift/shared-schemas';
import { type DatabaseEngine } from '@foresift/persistence';
import {
  AlertMetricScope,
  assertNoEarlyWatchInConfirmedDenominator,
  computeAlertMetric,
  computeConfirmedOpportunityMetrics,
  declaredAlertMetricKeys,
  type AlertMetricResult,
} from '@foresift/alerts';
import { validateBackupPolicy } from '@foresift/persistence';
import { FORECAST_FRESHNESS_WINDOW_MS } from '@foresift/workflow-runtime';
import { createKillSwitchResolver, type KillSwitchResolution } from './kill-switches.ts';

/** The owner package named in each section's provenance. */
export const OverviewOwnerPackage = {
  WORKFLOW_RUNTIME: '@foresift/workflow-runtime',
  ALERTS: '@foresift/alerts',
  EVALUATION: '@foresift/evaluation',
  SIGNAL_INTELLIGENCE: '@foresift/signal-intelligence',
  CAPABILITY_REGISTRY: '@foresift/capability-registry',
  PROVIDER_LIFECYCLE: '@foresift/provider-lifecycle',
  COST_ROUTER: '@foresift/cost-router',
  PERSISTENCE_RECOVERY: '@foresift/persistence',
  ADMIN: '@foresift/api/admin',
} as const;
export type OverviewOwnerPackage = (typeof OverviewOwnerPackage)[keyof typeof OverviewOwnerPackage];

// --- READ-ONLY port surface (frozen runtime statement) -----------------------

/**
 * The complete, frozen read-port surface. Every name begins with `read`; there
 * is deliberately no `write*`, `send*`, `call*`, `invoke*`, or `record*`
 * method anywhere on {@link AdminOverviewSourcePorts}. Tests assert this list so
 * a future mutating/provider method is a visible, failing change rather than a
 * silent capability gain.
 */
export const ADMIN_OVERVIEW_SOURCE_PORT_METHODS: readonly string[] = Object.freeze([
  'readSystemMode',
  'readKillSwitchState',
  'readProviderIncidents',
  'readQuotaExhaustionForecast',
  'readActiveSchedules',
  'readScheduleDrift',
  'readWorkflowCounts',
  'readCandidateCounts',
  'readAlertPrecisionRecall',
  'readMissedGems',
  'readFunnelFailures',
  'readModelProviderCost',
  'readStorageGrowth',
  'readLatestBackupStatus',
  'readRecoveryReadiness',
]);

const READ_METHOD_PREFIX = 'read';

/**
 * Fail-closed structural check that an object really is a read-only overview
 * source surface: every declared method exists and starts with `read`. A
 * missing method or a non-`read` method refuses typed rather than degrading.
 */
export function assertReadOnlyOverviewSourcePorts(ports: unknown): void {
  if (ports === null || typeof ports !== 'object') {
    throw new TypeError('overview source ports must be an object');
  }
  const surface = ports as Record<string, unknown>;
  for (let index = 0; index < ADMIN_OVERVIEW_SOURCE_PORT_METHODS.length; index += 1) {
    const name = ADMIN_OVERVIEW_SOURCE_PORT_METHODS[index];
    if (name === undefined) continue;
    if (typeof surface[name] !== 'function') {
      throw new TypeError(`overview source port '${name}' is missing or not a function`);
    }
    if (!name.startsWith(READ_METHOD_PREFIX)) {
      throw new TypeError(`overview source port '${name}' must be read-only`);
    }
  }
}

// --- §28.9 missed-gem categories (grouped exactly as the PRD lists) ----------

/**
 * The §28.9 "Missed Gems view" grouping, verbatim from the PRD. The evaluation
 * owner classifies each miss with the finer `MissClassification` vocabulary;
 * the overview groups those classifications into these twelve §28.9 buckets so
 * the operator view matches the contract.
 */
export const MissedGemCategory = {
  NOT_DISCOVERED: 'NOT_DISCOVERED',
  PROVIDER_LAG: 'PROVIDER_LAG',
  DATA_QUALITY_GATE: 'DATA_QUALITY_GATE',
  ELIGIBILITY_GATE: 'ELIGIBILITY_GATE',
  RISK_FALSE_POSITIVE: 'RISK_FALSE_POSITIVE',
  RANKING_BELOW_CUTOFF: 'RANKING_BELOW_CUTOFF',
  DIVERSITY_EXCLUSION: 'DIVERSITY_EXCLUSION',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  AGENT_REJECTED: 'AGENT_REJECTED',
  POLICY_SUPPRESSED: 'POLICY_SUPPRESSED',
  ALERT_DELIVERED_TOO_LATE: 'ALERT_DELIVERED_TOO_LATE',
  OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION: 'OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION',
} as const;
export type MissedGemCategory = (typeof MissedGemCategory)[keyof typeof MissedGemCategory];
export const ALL_MISSED_GEM_CATEGORIES: readonly MissedGemCategory[] = Object.freeze(
  Object.values(MissedGemCategory),
);
export const MissedGemCategorySchema = z.enum([
  MissedGemCategory.NOT_DISCOVERED,
  MissedGemCategory.PROVIDER_LAG,
  MissedGemCategory.DATA_QUALITY_GATE,
  MissedGemCategory.ELIGIBILITY_GATE,
  MissedGemCategory.RISK_FALSE_POSITIVE,
  MissedGemCategory.RANKING_BELOW_CUTOFF,
  MissedGemCategory.DIVERSITY_EXCLUSION,
  MissedGemCategory.BUDGET_EXHAUSTED,
  MissedGemCategory.AGENT_REJECTED,
  MissedGemCategory.POLICY_SUPPRESSED,
  MissedGemCategory.ALERT_DELIVERED_TOO_LATE,
  MissedGemCategory.OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION,
]);

/**
 * Total mapping from the evaluation owner's `MissClassification` vocabulary to
 * the twelve §28.9 buckets. `assertMissedGemCategoryMapComplete` fails closed
 * if the owner vocabulary ever grows a value this map does not cover, so a new
 * classification can never silently disappear from the operator view.
 */
export const MISSED_GEM_CATEGORY_BY_MISS_CLASSIFICATION: Readonly<
  Record<MissClassification, MissedGemCategory>
> = Object.freeze({
  NOT_IN_CLAIMED_UNIVERSE: MissedGemCategory.NOT_DISCOVERED,
  NOT_DISCOVERED: MissedGemCategory.NOT_DISCOVERED,
  COLLECTOR_FILTER_MISS: MissedGemCategory.DATA_QUALITY_GATE,
  COLLECTOR_GAP: MissedGemCategory.DATA_QUALITY_GATE,
  PROVIDER_LATE: MissedGemCategory.PROVIDER_LAG,
  IDENTITY_FAILURE: MissedGemCategory.DATA_QUALITY_GATE,
  DATA_STALE: MissedGemCategory.DATA_QUALITY_GATE,
  DATA_MISSING: MissedGemCategory.DATA_QUALITY_GATE,
  EVIDENCE_NOT_REQUESTED: MissedGemCategory.DATA_QUALITY_GATE,
  EVIDENCE_COST_BLOCKED: MissedGemCategory.BUDGET_EXHAUSTED,
  EVIDENCE_QUOTA_BLOCKED: MissedGemCategory.BUDGET_EXHAUSTED,
  CAPABILITY_UNAVAILABLE: MissedGemCategory.ELIGIBILITY_GATE,
  ELIGIBILITY_FALSE_NEGATIVE: MissedGemCategory.ELIGIBILITY_GATE,
  SECURITY_FALSE_POSITIVE: MissedGemCategory.RISK_FALSE_POSITIVE,
  MANIPULATION_MISSED: MissedGemCategory.RISK_FALSE_POSITIVE,
  WALLET_CLUSTER_MISSED: MissedGemCategory.RISK_FALSE_POSITIVE,
  SOURCE_INDEPENDENCE_OVERESTIMATED: MissedGemCategory.DATA_QUALITY_GATE,
  RANK_BELOW_CUTOFF: MissedGemCategory.RANKING_BELOW_CUTOFF,
  DIVERSITY_EXCLUDED: MissedGemCategory.DIVERSITY_EXCLUSION,
  BUDGET_EXHAUSTED: MissedGemCategory.BUDGET_EXHAUSTED,
  TOOL_SELECTION_ERROR: MissedGemCategory.AGENT_REJECTED,
  MODEL_REASONING_ERROR: MissedGemCategory.AGENT_REJECTED,
  UNSUPPORTED_CLAIM: MissedGemCategory.AGENT_REJECTED,
  POLICY_TOO_STRICT: MissedGemCategory.POLICY_SUPPRESSED,
  POLICY_TOO_LOOSE: MissedGemCategory.POLICY_SUPPRESSED,
  ALERT_TOO_LATE: MissedGemCategory.ALERT_DELIVERED_TOO_LATE,
  EXECUTION_MODEL_ERROR: MissedGemCategory.OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION,
  POOL_ADAPTER_UNSUPPORTED: MissedGemCategory.ELIGIBILITY_GATE,
  QUOTE_PARITY_FAILURE: MissedGemCategory.ELIGIBILITY_GATE,
  OUTCOME_UNOBSERVED: MissedGemCategory.OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION,
  OUTCOME_LOW_RESOLUTION: MissedGemCategory.OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION,
  SAMPLING_WEIGHT_INVALID: MissedGemCategory.OUTCOME_UNOBSERVED_OR_LOW_RESOLUTION,
  ACTION_TIME_ASYMMETRY: MissedGemCategory.ALERT_DELIVERED_TOO_LATE,
  MARKET_REGIME_SHIFT: MissedGemCategory.POLICY_SUPPRESSED,
});

/** One grouped §28.9 bucket with its contributing classification counts. */
export interface MissedGemGroup {
  readonly category: MissedGemCategory;
  readonly count: number;
  readonly candidateRefs: readonly string[];
}

/** One raw miss row the evaluation owner exposes (candidate + classification). */
export interface MissedGemClassificationRow {
  readonly candidateRef: string;
  readonly missClassification: MissClassification;
}

/**
 * Group miss rows into the twelve §28.9 buckets, zero-filled so the operator
 * view always names every category. Numeric-index aggregation only (audit
 * NEW-M4/NEW-M5): a shadowed `map`/`filter`/`push` cannot drop a bucket or a
 * contributing row, which would hide a systematic miss class.
 */
export function groupMissedGemClassifications(rows: readonly MissedGemClassificationRow[]): {
  readonly groups: readonly MissedGemGroup[];
  readonly total: number;
} {
  const categoryCounts: number[] = [];
  const categoryRefs: string[][] = [];
  for (let index = 0; index < ALL_MISSED_GEM_CATEGORIES.length; index += 1) {
    categoryCounts[index] = 0;
    categoryRefs[index] = [];
  }
  let total = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row === undefined) continue;
    const category = MISSED_GEM_CATEGORY_BY_MISS_CLASSIFICATION[row.missClassification];
    if (category === undefined) continue;
    let bucket = -1;
    for (let index = 0; index < ALL_MISSED_GEM_CATEGORIES.length; index += 1) {
      if (ALL_MISSED_GEM_CATEGORIES[index] === category) {
        bucket = index;
        break;
      }
    }
    if (bucket < 0) continue;
    categoryCounts[bucket] = (categoryCounts[bucket] ?? 0) + 1;
    const refs = categoryRefs[bucket] as string[];
    refs[refs.length] = row.candidateRef;
    total += 1;
  }
  const groups: MissedGemGroup[] = [];
  for (let index = 0; index < ALL_MISSED_GEM_CATEGORIES.length; index += 1) {
    groups[groups.length] = {
      category: ALL_MISSED_GEM_CATEGORIES[index] as MissedGemCategory,
      count: categoryCounts[index] ?? 0,
      candidateRefs: Object.freeze(categoryRefs[index] as string[]),
    };
  }
  return { groups, total };
}

/** Fail closed when the owner's miss vocabulary grows past the §28.9 map. */
export function assertMissedGemCategoryMapComplete(
  classifications: readonly MissClassification[],
): void {
  for (let index = 0; index < classifications.length; index += 1) {
    const classification = classifications[index];
    if (classification === undefined) continue;
    if (MISSED_GEM_CATEGORY_BY_MISS_CLASSIFICATION[classification] === undefined) {
      throw new TypeError(`no §28.9 missed-gem category for '${classification}'`);
    }
  }
}

// --- freshness / quality envelope --------------------------------------------

/** A port result: validated rows plus an explicit freshness/quality marker. */
export interface SourceRead<T> {
  /** The owning package the value was gathered from (provenance). */
  readonly ownerPackage: string;
  readonly freshness: AdminOverviewFreshness;
  /** Stable refs to the owner rows the value was assembled from. */
  readonly rowRefs: readonly string[];
  /** Stable machine quality codes; never prose the operator must interpret. */
  readonly qualityCodes: readonly string[];
  /** Non-secret explanation of a degraded/insufficient read. */
  readonly detail: string | null;
  /** When the owner value was observed. */
  readonly computedAt: string;
  /** Instant after which this observation must be treated as STALE. */
  readonly expiresAt: string | null;
  /** `null` iff the read is UNKNOWN/REFUSED. */
  readonly payload: T | null;
}

/**
 * Freshness rank. A HIGHER rank is WORSE; the assembly's overall freshness is
 * the maximum over its sections, so one REFUSED source can never be averaged
 * away by fresh neighbours.
 */
const ADMIN_OVERVIEW_FRESHNESS_RANK: Readonly<Record<AdminOverviewFreshness, number>> =
  Object.freeze({
    FRESH: 0,
    STALE: 1,
    UNKNOWN: 2,
    REFUSED: 3,
  });

/** Numeric-index worst-of walk; never `.some`/`.reduce`. */
export function worstFreshness(values: readonly AdminOverviewFreshness[]): AdminOverviewFreshness {
  let worst: AdminOverviewFreshness = 'FRESH';
  let worstRank = ADMIN_OVERVIEW_FRESHNESS_RANK.FRESH;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    const rank = ADMIN_OVERVIEW_FRESHNESS_RANK[value];
    if (rank > worstRank) {
      worst = value;
      worstRank = rank;
    }
  }
  return worst;
}

/**
 * A source observation expires into STALE once `now` reaches `expiresAt`; an
 * absent expiry never expires. Pure and numeric — no array hook is consulted.
 */
export function freshnessForExpiry(expiresAt: string | null, now: string): AdminOverviewFreshness {
  if (expiresAt === null) return 'FRESH';
  return Date.parse(now) >= Date.parse(expiresAt) ? 'STALE' : 'FRESH';
}

/** A fail-closed UNKNOWN read: the owner could not be observed at all. */
export function unknownRead(
  ownerPackage: string,
  detail: string,
  computedAt: string,
): SourceRead<never> {
  return {
    ownerPackage,
    freshness: 'UNKNOWN',
    rowRefs: Object.freeze([]),
    qualityCodes: Object.freeze(['SOURCE_UNAVAILABLE']),
    detail,
    computedAt,
    expiresAt: null,
    payload: null,
  };
}

/** A fail-closed REFUSED read: the owner refused the request typed. */
export function refusedRead(
  ownerPackage: string,
  detail: string,
  computedAt: string,
): SourceRead<never> {
  return {
    ownerPackage,
    freshness: 'REFUSED',
    rowRefs: Object.freeze([]),
    qualityCodes: Object.freeze(['SOURCE_REFUSED']),
    detail,
    computedAt,
    expiresAt: null,
    payload: null,
  };
}

// --- alert confidence intervals ---------------------------------------------

export interface ConfidenceIntervalView {
  readonly method: string;
  readonly pointEstimate: number | null;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly effectiveIndependentSampleSize: number;
  readonly naiveSampleSize: number;
  readonly essGatePassed: boolean;
}

/**
 * Wilson score 95% interval for a proportion. This is a DISPLAY-ONLY
 * uncertainty bound over the owner's already-computed numerator/denominator/
 * sample size — never a metric, denominator, or gate decision (plan D1). The
 * alert metrics owner supplies the counts; the overview shows their interval.
 */
export function wilsonScoreInterval(
  numerator: number,
  denominator: number,
  sampleSize: number,
): ConfidenceIntervalView | null {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    !Number.isFinite(sampleSize) ||
    denominator <= 0 ||
    sampleSize <= 0 ||
    numerator < 0 ||
    numerator > denominator
  ) {
    return null;
  }
  const zScore = 1.959963984540054;
  // The interval's n is the EFFECTIVE independent sample size (never the raw
  // record count), so correlated observations cannot produce an over-narrow
  // interval. `sampleSize` is clamped to its own denominator by construction.
  const n = sampleSize;
  const proportion = numerator / denominator;
  const zSquared = zScore * zScore;
  const denominatorTerm = 1 + zSquared / n;
  const centre = (proportion + zSquared / (2 * n)) / denominatorTerm;
  const spread =
    (zScore * Math.sqrt((proportion * (1 - proportion)) / n + zSquared / (4 * n * n))) /
    denominatorTerm;
  const lower = Math.max(0, centre - spread);
  const upper = Math.min(1, centre + spread);
  return Object.freeze({
    method: 'WILSON_SCORE_95',
    pointEstimate: proportion,
    lowerBound: lower,
    upperBound: upper,
    effectiveIndependentSampleSize: sampleSize,
    naiveSampleSize: denominator,
    essGatePassed: sampleSize > 0,
  });
}

// --- validated section payload schemas ---------------------------------------

const countRecord = z.record(z.number().int().nonnegative());
const refList = z.array(z.string().min(1));
const nonNegativeInt = z.number().int().nonnegative();
const nullableNumber = z.number().nullable();
const nullableInt = z.number().int().nonnegative().nullable();

export const SystemModePayloadSchema = z
  .object({
    systemMode: SystemModeSchema,
    lifecycleCounts: countRecord,
    containmentOpenCount: nonNegativeInt,
    containmentRefs: refList,
    posture: z.string().min(1),
    postureMissingSlaRefs: refList,
    postureEvidenceRefs: refList,
    activationScopeCount: nonNegativeInt,
    activationAnyRefused: z.boolean(),
    activationAnyExpired: z.boolean(),
    activationRefs: refList,
  })
  .strict();
export type SystemModePayload = z.infer<typeof SystemModePayloadSchema>;

export const KillSwitchSubStateSchema = z
  .object({
    switchKind: KillSwitchKindSchema,
    state: KillSwitchStateSchema,
    closed: z.boolean(),
    degraded: z.boolean(),
    reason: z.string().nullable(),
    stateRowId: z.string().nullable(),
  })
  .strict();
export type KillSwitchSubState = z.infer<typeof KillSwitchSubStateSchema>;

export const KillSwitchStatePayloadSchema = z
  .object({
    switches: z.array(KillSwitchSubStateSchema),
    engaged: z.array(KillSwitchKindSchema),
    readOnlyEmergencyEngaged: z.boolean(),
  })
  .strict();
export type KillSwitchStatePayload = z.infer<typeof KillSwitchStatePayloadSchema>;

export const ProviderIncidentViewSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    incidentRef: z.string().min(1),
    healthStatus: z.string().min(1),
    currentState: z.string().min(1),
    reasonClass: z.string().nullable(),
    occurredAt: z.string().nullable(),
  })
  .strict();
export type ProviderIncidentView = z.infer<typeof ProviderIncidentViewSchema>;

export const ProviderIncidentsPayloadSchema = z
  .object({
    incidents: z.array(ProviderIncidentViewSchema),
    openCount: nonNegativeInt,
  })
  .strict();
export type ProviderIncidentsPayload = z.infer<typeof ProviderIncidentsPayloadSchema>;

export const QuotaBalanceViewSchema = z
  .object({
    providerId: z.string().min(1),
    quotaModelId: z.string().min(1),
    capLimit: nullableNumber,
    remainingUnits: nullableNumber,
    periodWindowStart: z.string().nullable(),
    resetAt: z.string().nullable(),
  })
  .strict();

export const QuotaForecastPayloadSchema = z
  .object({
    forecastId: z.string().nullable(),
    planVersionId: z.string().nullable(),
    scheduleId: z.string().nullable(),
    computedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    runsPerDay: nullableNumber,
    providerCallsPerDay: nullableNumber,
    modelTokensPerDay: nullableNumber,
    estimatedModelSpendPerDay: z.string().nullable(),
    quotaExhaustionDate: z.string().nullable(),
    storageGrowthPerMonth: nullableNumber,
    quotaBalances: z.array(QuotaBalanceViewSchema),
  })
  .strict();
export type QuotaForecastPayload = z.infer<typeof QuotaForecastPayloadSchema>;

export const ActiveScheduleViewSchema = z
  .object({
    scheduleId: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    shadow: z.boolean(),
    currentVersionId: z.string().nullable(),
  })
  .strict();

export const ActiveSchedulesPayloadSchema = z
  .object({
    schedules: z.array(ActiveScheduleViewSchema),
    activeCount: nonNegativeInt,
    pausedCount: nonNegativeInt,
    disabledCount: nonNegativeInt,
    draftCount: nonNegativeInt,
  })
  .strict();
export type ActiveSchedulesPayload = z.infer<typeof ActiveSchedulesPayloadSchema>;

export const ScheduleDriftReportViewSchema = z
  .object({
    reportId: z.string().min(1),
    checkedAt: z.string().min(1),
    skewCount: nonNegativeInt,
    incidentRefs: refList,
  })
  .strict();

export const ScheduleDriftPayloadSchema = z
  .object({
    reports: z.array(ScheduleDriftReportViewSchema),
    latestCheckedAt: z.string().nullable(),
    incidentRefs: refList,
    repairedRefs: refList,
    driftDetected: z.boolean(),
  })
  .strict();
export type ScheduleDriftPayload = z.infer<typeof ScheduleDriftPayloadSchema>;

export const WorkflowCountsPayloadSchema = z
  .object({
    runsByStatus: countRecord,
    deadLetterCounts: countRecord,
    outboxCounts: countRecord,
    pendingRuns: nonNegativeInt,
    runningRuns: nonNegativeInt,
    waitingRuns: nonNegativeInt,
    openDeadLetters: nonNegativeInt,
    waitingSteps: nonNegativeInt,
  })
  .strict();
export type WorkflowCountsPayload = z.infer<typeof WorkflowCountsPayloadSchema>;

export const CandidateCountsPayloadSchema = z
  .object({
    byLifecycleState: countRecord,
    byRiskState: countRecord,
    total: nonNegativeInt,
  })
  .strict();
export type CandidateCountsPayload = z.infer<typeof CandidateCountsPayloadSchema>;

export const ConfidenceIntervalViewSchema = z
  .object({
    method: z.string().min(1),
    pointEstimate: z.number().nullable(),
    lowerBound: z.number(),
    upperBound: z.number(),
    effectiveIndependentSampleSize: nonNegativeInt,
    naiveSampleSize: nonNegativeInt,
    essGatePassed: z.boolean(),
  })
  .strict();

export const AlertMetricViewSchema = z
  .object({
    alertClass: AlertClassSchema,
    metricKey: AlertMetricKeySchema,
    numerator: nonNegativeInt,
    denominator: nonNegativeInt,
    sampleSize: nonNegativeInt,
    observationCount: nonNegativeInt,
    rate: z.number().nullable(),
    windowStart: UtcTimestampSchema,
    windowEnd: UtcTimestampSchema,
    confidenceInterval: ConfidenceIntervalViewSchema.nullable(),
  })
  .strict();
export type AlertMetricView = z.infer<typeof AlertMetricViewSchema>;

export const AlertPrecisionRecallPayloadSchema = z
  .object({
    windowStart: UtcTimestampSchema,
    windowEnd: UtcTimestampSchema,
    confirmed: z.array(AlertMetricViewSchema),
    earlyWatch: z.array(AlertMetricViewSchema),
    perClassDenominators: countRecord,
    perClassSampleSizes: countRecord,
    perMetricDenominators: countRecord,
    sampleSize: nonNegativeInt,
    confidenceInterval: ConfidenceIntervalViewSchema.nullable(),
    /** Structurally pinned: the confirmed denominator never pools EARLY_WATCH. */
    neverPoolsEarlyWatch: z.literal(true),
    ownerGuards: refList,
  })
  .strict();
export type AlertPrecisionRecallPayload = z.infer<typeof AlertPrecisionRecallPayloadSchema>;

export const MissedGemGroupSchema = z
  .object({
    category: MissedGemCategorySchema,
    count: nonNegativeInt,
    candidateRefs: refList,
  })
  .strict();

export const MissedGemsPayloadSchema = z
  .object({
    groups: z.array(MissedGemGroupSchema),
    categories: z.array(MissedGemCategorySchema),
    total: nonNegativeInt,
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
  })
  .strict();
export type MissedGemsPayload = z.infer<typeof MissedGemsPayloadSchema>;

export const FunnelFailureViewSchema = z
  .object({
    stage: z.string().min(1),
    gateCode: z.string().nullable(),
    count: nonNegativeInt,
  })
  .strict();

export const FunnelFailuresPayloadSchema = z
  .object({
    failures: z.array(FunnelFailureViewSchema),
    total: nonNegativeInt,
  })
  .strict();
export type FunnelFailuresPayload = z.infer<typeof FunnelFailuresPayloadSchema>;

export const CostPayloadSchema = z
  .object({
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
    modelCostUsd: z.number().nonnegative(),
    providerCostUsd: z.number().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
    byDimension: z.record(z.number().nonnegative()),
    budgetLimitUsd: z.number().nonnegative(),
    budgetUtilization: z.number().nullable(),
  })
  .strict();
export type CostPayload = z.infer<typeof CostPayloadSchema>;

export const StorageGrowthPayloadSchema = z
  .object({
    measuredAt: UtcTimestampSchema,
    totalBytes: nullableNumber,
    objectCount: nullableInt,
    bytesPerDay: nullableNumber,
    bytesPerMonth: nullableNumber,
    growthPerMonth: nullableNumber,
  })
  .strict();
export type StorageGrowthPayload = z.infer<typeof StorageGrowthPayloadSchema>;

export const BackupStatusPayloadSchema = z
  .object({
    latestRunId: z.string().nullable(),
    latestBackupAt: z.string().nullable(),
    latestBackupStatus: z.string().nullable(),
    artifactRefs: refList,
    policyId: z.string().nullable(),
    policyValidated: z.boolean(),
    rpoTargetMinutes: nullableNumber,
    measuredRpoMinutes: nullableNumber,
    drillId: z.string().nullable(),
    drillOutcome: z.string().nullable(),
    drillFinishedAt: z.string().nullable(),
    credentialProviderPresent: z.boolean().nullable(),
    healthKind: z.string().nullable(),
    confirmedOpportunityInfluenceBlocked: z.boolean().nullable(),
    deterministicRiskMonitoringAllowed: z.boolean().nullable(),
  })
  .strict();
export type BackupStatusPayload = z.infer<typeof BackupStatusPayloadSchema>;

export const RecoveryVerificationViewSchema = z
  .object({
    name: z.string().min(1),
    passed: z.boolean(),
    detail: z.string(),
  })
  .strict();

export const RecoveryReadinessPayloadSchema = z
  .object({
    drillId: z.string().nullable(),
    outcome: z.string().nullable(),
    verifications: z.array(RecoveryVerificationViewSchema),
    executedChecks: refList,
    resumeBlockers: refList,
    automationResumeAllowed: z.boolean(),
    measuredRpoMinutesByTier: z.record(z.number().nonnegative()),
    rpoTargetMinutesByTier: z.record(z.number().nonnegative()),
    openIncidentRefs: refList,
  })
  .strict();
export type RecoveryReadinessPayload = z.infer<typeof RecoveryReadinessPayloadSchema>;

/** The payload schema for every §28.2 section; assembly validates through it. */
export const SECTION_PAYLOAD_SCHEMAS: Readonly<Record<OverviewSectionKeyType, z.ZodTypeAny>> =
  Object.freeze({
    SYSTEM_MODE: SystemModePayloadSchema,
    KILL_SWITCH_STATE: KillSwitchStatePayloadSchema,
    PROVIDER_INCIDENTS: ProviderIncidentsPayloadSchema,
    QUOTA_EXHAUSTION_FORECAST: QuotaForecastPayloadSchema,
    ACTIVE_SCHEDULES: ActiveSchedulesPayloadSchema,
    SCHEDULE_DRIFT: ScheduleDriftPayloadSchema,
    WORKFLOW_COUNTS: WorkflowCountsPayloadSchema,
    CANDIDATE_LIFECYCLE_RISK_COUNTS: CandidateCountsPayloadSchema,
    ALERT_PRECISION_RECALL: AlertPrecisionRecallPayloadSchema,
    MISSED_GEMS: MissedGemsPayloadSchema,
    FUNNEL_FAILURES: FunnelFailuresPayloadSchema,
    MODEL_PROVIDER_COST: CostPayloadSchema,
    STORAGE_GROWTH: StorageGrowthPayloadSchema,
    LATEST_BACKUP_STATUS: BackupStatusPayloadSchema,
    RECOVERY_READINESS: RecoveryReadinessPayloadSchema,
  });

// --- the read-only port interface --------------------------------------------

/**
 * The §28.2 read ports. STRICTLY READ-ONLY and provider-free BY TYPE: there is
 * no method that constructs a provider/model/notification call and no method
 * that mutates any row. The overview assembly receives exactly this surface
 * (plus the single snapshot sink), so §28.2 holds structurally.
 */
export interface AdminOverviewSourcePorts {
  readonly readSystemMode: () => Promise<SourceRead<SystemModePayload>>;
  readonly readKillSwitchState: () => Promise<SourceRead<KillSwitchStatePayload>>;
  readonly readProviderIncidents: () => Promise<SourceRead<ProviderIncidentsPayload>>;
  readonly readQuotaExhaustionForecast: () => Promise<SourceRead<QuotaForecastPayload>>;
  readonly readActiveSchedules: () => Promise<SourceRead<ActiveSchedulesPayload>>;
  readonly readScheduleDrift: () => Promise<SourceRead<ScheduleDriftPayload>>;
  readonly readWorkflowCounts: () => Promise<SourceRead<WorkflowCountsPayload>>;
  readonly readCandidateCounts: () => Promise<SourceRead<CandidateCountsPayload>>;
  readonly readAlertPrecisionRecall: () => Promise<SourceRead<AlertPrecisionRecallPayload>>;
  readonly readMissedGems: () => Promise<SourceRead<MissedGemsPayload>>;
  readonly readFunnelFailures: () => Promise<SourceRead<FunnelFailuresPayload>>;
  readonly readModelProviderCost: () => Promise<SourceRead<CostPayload>>;
  readonly readStorageGrowth: () => Promise<SourceRead<StorageGrowthPayload>>;
  readonly readLatestBackupStatus: () => Promise<SourceRead<BackupStatusPayload>>;
  readonly readRecoveryReadiness: () => Promise<SourceRead<RecoveryReadinessPayload>>;
}

// --- shared helpers ----------------------------------------------------------

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integerOf(value: unknown): number {
  const parsed = numberOf(value);
  return parsed === null ? 0 : Math.trunc(parsed);
}

function isoOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const raw = textOf(value);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : 'unknown failure';
}

/** Numeric-index count of rows by a string key; never `.map`/`.filter`. */
function countByKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const key = keyOf(row);
    if (key === null) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Numeric-index de-duplicating append; never `push`/spread/`new Set`. */
function appendUnique(target: string[], source: readonly string[]): void {
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value === undefined || value.length === 0) continue;
    let seen = false;
    for (let seenIndex = 0; seenIndex < target.length; seenIndex += 1) {
      if (target[seenIndex] === value) {
        seen = true;
        break;
      }
    }
    if (!seen) target[target.length] = value;
  }
}

/**
 * A section whose owner read hit its row cap must SAY so: a truncated sample
 * presented as a total is a freshness/quality lie.
 */
function truncationQualityCodes(truncated: boolean): string[] {
  return truncated ? ['RESULT_TRUNCATED'] : [];
}

function providerIncidentQualityCodes(openCount: number, truncated: boolean): string[] {
  const codes: string[] = [];
  if (openCount > 0) codes[codes.length] = 'PROVIDER_INCIDENT_OPEN';
  if (truncated) codes[codes.length] = 'RESULT_TRUNCATED';
  return codes;
}

interface ReadInit {
  readonly ownerPackage: string;
  readonly rowRefs: readonly string[];
  readonly qualityCodes: readonly string[];
  readonly detail: string | null;
  readonly freshness?: AdminOverviewFreshness;
  readonly computedAt: string;
  readonly expiresAt: string | null;
  readonly payload: unknown;
}

/** Numeric-index array copy; never spread or `.slice` (audit NEW-M4). */
function numericCopy<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    copy[copy.length] = source[index] as T;
  }
  return copy;
}

function validatedRead<T>(schema: z.ZodType<T>, init: ReadInit): SourceRead<T> {
  return {
    ownerPackage: init.ownerPackage,
    freshness: init.freshness ?? 'FRESH',
    rowRefs: Object.freeze(numericCopy(init.rowRefs)),
    qualityCodes: Object.freeze(numericCopy(init.qualityCodes)),
    detail: init.detail,
    computedAt: init.computedAt,
    expiresAt: init.expiresAt,
    payload: schema.parse(init.payload),
  };
}

// --- default (owner-backed) ports --------------------------------------------

/** A minimal read-only kill-switch resolver seam (the T012 owner). */
export interface KillSwitchReader {
  resolve(kind: KillSwitchKind, scope: KillSwitchScope): Promise<KillSwitchResolution>;
}

export interface CreateAdminOverviewSourcePortsOptions {
  readonly engine: DatabaseEngine;
  readonly clock?: (() => number) | undefined;
  /** The §28.13 resolver (T012). Defaults to a read-only resolver over `engine`. */
  readonly killSwitchResolver?: KillSwitchReader | undefined;
  /** How long an assembled observation stays FRESH. Defaults to 5 minutes. */
  readonly freshnessTtlMs?: number | undefined;
  /** Trailing window (ms) for the alert metric read. Defaults to 30 days. */
  readonly alertWindowMs?: number | undefined;
  /** Max rows named in a section's row refs. Defaults to 200. */
  readonly rowRefLimit?: number | undefined;
  /** Age after which a §25.10 reconciliation report is STALE. Defaults to 24h. */
  readonly driftFreshnessMs?: number | undefined;
}

const GLOBAL_KILL_SWITCH_SCOPE: KillSwitchScope = Object.freeze({
  scopeKind: 'GLOBAL',
  scopeRef: 'global',
});

const GLOBAL_SYSTEM_MODE = 'global';

/**
 * Build the default, owner-backed read-only source ports. Every reader is
 * read-only at the SQL level (`SELECT` only), every failure degrades to an
 * explicit UNKNOWN rather than throwing, and none can construct a provider,
 * model, or notification call.
 */
export function createAdminOverviewSourcePorts(
  options: CreateAdminOverviewSourcePortsOptions,
): AdminOverviewSourcePorts {
  const engine = options.engine;
  const clock = options.clock ?? (() => Date.now());
  const freshnessTtlMs = options.freshnessTtlMs ?? 5 * 60 * 1000;
  const alertWindowMs = options.alertWindowMs ?? 30 * 24 * 60 * 60 * 1000;
  const rowRefLimit = options.rowRefLimit ?? 200;
  const driftFreshnessMs = options.driftFreshnessMs ?? 24 * 60 * 60 * 1000;
  const killSwitchResolver: KillSwitchReader =
    options.killSwitchResolver ?? createKillSwitchResolver({ engine, clock });

  const now = (): string => new Date(clock()).toISOString();
  const expiry = (): string => new Date(clock() + freshnessTtlMs).toISOString();

  async function readSystemMode(): Promise<SourceRead<SystemModePayload>> {
    const computedAt = now();
    try {
      const states = await engine.query<{
        state_row_id: string;
        module_id: string;
        lifecycle_state: string;
      }>(
        `SELECT state_row_id, module_id, lifecycle_state
           FROM prod.module_states
          WHERE superseded_by IS NULL
          ORDER BY module_id`,
      );
      // Containment and posture are read as the owner's PERSISTED governed
      // rows (`prod.*`); no gate, containment, or posture law is re-evaluated
      // here (plan D1). `@foresift/capability-registry` owns these tables.
      const containment = await engine.query<{
        containment_id: string;
        action: string;
      }>(
        `SELECT containment_id, action
           FROM prod.containment_events
          WHERE cleared_by_event_ref IS NULL
          ORDER BY created_at ASC, containment_id ASC`,
      );
      const posture = await engine.query<{
        declaration_id: string;
        posture: string;
        missing_sla_refs: unknown;
      }>(
        `SELECT declaration_id, posture, missing_sla_refs
           FROM prod.best_effort_declarations
          ORDER BY declared_at DESC
          LIMIT 1`,
      );
      const evaluations = await engine.query<{
        evaluation_id: string;
        gate_kind: string;
        verdict: string;
        failing_gate: string | null;
        evaluated_at: string;
        expires_at: string;
      }>(
        `SELECT evaluation_id, gate_kind, verdict, failing_gate, evaluated_at, expires_at
           FROM prod.activation_gate_evaluations
          ORDER BY evaluated_at DESC
          LIMIT 200`,
      );

      const lifecycleCounts: Record<string, number> = {};
      const refs: string[] = [];
      for (let index = 0; index < states.rows.length; index += 1) {
        const row = states.rows[index];
        if (row === undefined) continue;
        lifecycleCounts[row.lifecycle_state] = (lifecycleCounts[row.lifecycle_state] ?? 0) + 1;
        if (refs.length < rowRefLimit) refs[refs.length] = `prod.module_states:${row.state_row_id}`;
      }

      // Display projection of the owner's persisted, governed state only — no
      // gate is evaluated here. Fail-closed precedence: anything contained,
      // disabled, or degraded outranks an ACTIVE claim.
      let systemMode: SystemModePayload['systemMode'] = 'DISABLED';
      if ((lifecycleCounts['ACTIVE'] ?? 0) > 0) systemMode = 'ACTIVE';
      else if ((lifecycleCounts['SHADOW'] ?? 0) > 0) systemMode = 'SHADOW';
      else if ((lifecycleCounts['PROVEN'] ?? 0) > 0 || (lifecycleCounts['AVAILABLE'] ?? 0) > 0) {
        systemMode = 'READ_ONLY';
      }
      if ((lifecycleCounts['PAUSED'] ?? 0) > 0) systemMode = 'PAUSED';
      if ((lifecycleCounts['DEGRADED'] ?? 0) > 0) systemMode = 'DEGRADED';
      if ((lifecycleCounts['DISABLED'] ?? 0) > 0 || containment.rows.length > 0) {
        systemMode = 'DISABLED';
      }

      const containmentRefs: string[] = [];
      for (let index = 0; index < containment.rows.length; index += 1) {
        const row = containment.rows[index];
        if (row === undefined) continue;
        if (containmentRefs.length < rowRefLimit) {
          containmentRefs[containmentRefs.length] = `prod.containment_events:${row.containment_id}`;
        }
      }

      const postureRow = posture.rows[0];
      const postureMissingSlaRefs: string[] = [];
      if (postureRow !== undefined && Array.isArray(postureRow.missing_sla_refs)) {
        const raw = postureRow.missing_sla_refs as unknown[];
        for (let index = 0; index < raw.length; index += 1) {
          const value = raw[index];
          if (typeof value === 'string')
            postureMissingSlaRefs[postureMissingSlaRefs.length] = value;
        }
      }
      const postureEvidenceRefs: string[] = [];
      if (postureRow !== undefined) {
        postureEvidenceRefs[postureEvidenceRefs.length] =
          `prod.best_effort_declarations:${postureRow.declaration_id}`;
      }

      const activationRefs: string[] = [];
      let anyRefused = false;
      let anyExpired = false;
      for (let index = 0; index < evaluations.rows.length; index += 1) {
        const row = evaluations.rows[index];
        if (row === undefined) continue;
        if (activationRefs.length < rowRefLimit) {
          activationRefs[activationRefs.length] = row.evaluation_id;
        }
        if (row.verdict === 'REFUSE') anyRefused = true;
        const expiresAt = isoOf(row.expires_at);
        if (expiresAt !== null && Date.parse(computedAt) >= Date.parse(expiresAt))
          anyExpired = true;
      }

      const refsOut: string[] = [];
      appendUnique(refsOut, refs);
      appendUnique(refsOut, containmentRefs);
      appendUnique(refsOut, activationRefs);
      if (refsOut.length === 0)
        refsOut[refsOut.length] = `prod.module_states:${GLOBAL_SYSTEM_MODE}@${computedAt}`;

      const qualityCodes: string[] = [];
      if (anyRefused) qualityCodes[qualityCodes.length] = 'ACTIVATION_GATE_REFUSED';
      if (anyExpired) qualityCodes[qualityCodes.length] = 'ACTIVATION_EVIDENCE_EXPIRED';
      if (containment.rows.length > 0) qualityCodes[qualityCodes.length] = 'CONTAINMENT_OPEN';

      return validatedRead(SystemModePayloadSchema, {
        ownerPackage: OverviewOwnerPackage.CAPABILITY_REGISTRY,
        rowRefs: refsOut,
        qualityCodes,
        detail:
          containment.rows.length > 0
            ? `${containment.rows.length} open containment(s) keep the system out of a normal mode`
            : null,
        freshness: anyExpired ? 'STALE' : 'FRESH',
        computedAt,
        expiresAt: expiry(),
        payload: {
          systemMode,
          lifecycleCounts,
          containmentOpenCount: containment.rows.length,
          containmentRefs,
          posture: postureRow === undefined ? 'UNKNOWN' : postureRow.posture,
          postureMissingSlaRefs,
          postureEvidenceRefs,
          activationScopeCount: evaluations.rows.length,
          activationAnyRefused: anyRefused,
          activationAnyExpired: anyExpired,
          activationRefs,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.CAPABILITY_REGISTRY,
        `capability/activation state unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readKillSwitchState(): Promise<SourceRead<KillSwitchStatePayload>> {
    const computedAt = now();
    const switches: KillSwitchSubState[] = [];
    const engaged: KillSwitchKind[] = [];
    let degraded = false;
    for (let index = 0; index < ALL_KILL_SWITCH_KINDS.length; index += 1) {
      const kind = ALL_KILL_SWITCH_KINDS[index];
      if (kind === undefined) continue;
      try {
        const resolution = await killSwitchResolver.resolve(kind, GLOBAL_KILL_SWITCH_SCOPE);
        switches[switches.length] = {
          switchKind: resolution.switchKind,
          state: resolution.state,
          closed: resolution.closed,
          degraded: resolution.degraded,
          reason: resolution.reason,
          stateRowId: resolution.stateRowId,
        };
        if (resolution.closed) engaged[engaged.length] = resolution.switchKind;
        if (resolution.degraded) degraded = true;
      } catch (error) {
        // Fail closed per switch: an unreadable state IS the closed state.
        degraded = true;
        switches[switches.length] = {
          switchKind: kind,
          state: 'ENGAGED',
          closed: true,
          degraded: true,
          reason: `kill-switch state unreadable: ${errorDetail(error)}`,
          stateRowId: null,
        };
        engaged[engaged.length] = kind;
      }
    }
    const rowRefs: string[] = [];
    for (let index = 0; index < switches.length; index += 1) {
      const entry = switches[index];
      if (entry === undefined || entry.stateRowId === null) continue;
      rowRefs[rowRefs.length] = `adm.kill_switch_states:${entry.stateRowId}`;
    }
    if (rowRefs.length === 0) {
      rowRefs[rowRefs.length] =
        `adm.kill_switch_states:${GLOBAL_KILL_SWITCH_SCOPE.scopeRef}@${computedAt}`;
    }
    let readOnlyEmergencyEngaged = false;
    for (let index = 0; index < switches.length; index += 1) {
      const entry = switches[index];
      if (entry !== undefined && entry.switchKind === 'EMERGENCY_READ_ONLY_MODE' && entry.closed) {
        readOnlyEmergencyEngaged = true;
      }
    }
    return validatedRead(KillSwitchStatePayloadSchema, {
      ownerPackage: OverviewOwnerPackage.ADMIN,
      rowRefs,
      qualityCodes: degraded
        ? ['KILL_SWITCH_STATE_DEGRADED']
        : engaged.length > 0
          ? ['KILL_SWITCH_ENGAGED']
          : [],
      detail: degraded ? 'one or more kill-switch states were unreadable and resolve closed' : null,
      freshness: degraded ? 'STALE' : 'FRESH',
      computedAt,
      expiresAt: expiry(),
      payload: { switches, engaged, readOnlyEmergencyEngaged },
    });
  }

  async function readProviderIncidents(): Promise<SourceRead<ProviderIncidentsPayload>> {
    const computedAt = now();
    try {
      const operations = await engine.query<{
        provider_id: string;
        operation_id: string;
        version: string;
        current_state: string;
        health_status: string;
        updated_at: string;
      }>(
        `SELECT provider_id, operation_id, version, current_state, health_status, updated_at
           FROM prov.prov_operations
          WHERE health_status <> 'HEALTHY'
             OR current_state IN ('DEGRADED', 'BLOCKED', 'DEPRECATED', 'REMOVED')
          ORDER BY updated_at DESC
          LIMIT $1`,
        [rowRefLimit],
      );
      const events = await engine.query<{
        event_id: string;
        provider_id: string;
        operation_id: string;
        version: string;
        to_state: string;
        reason_class: string;
        occurred_at: string;
      }>(
        `SELECT event_id, provider_id, operation_id, version, to_state, reason_class, occurred_at
           FROM prov.prov_lifecycle_events
          ORDER BY seq DESC
          LIMIT $1`,
        [rowRefLimit],
      );
      const reasonByOperation: Record<string, { reasonClass: string; occurredAt: string | null }> =
        {};
      for (let index = 0; index < events.rows.length; index += 1) {
        const row = events.rows[index];
        if (row === undefined) continue;
        const key = `${row.provider_id}:${row.operation_id}:${row.version}`;
        if (reasonByOperation[key] === undefined) {
          reasonByOperation[key] = {
            reasonClass: row.reason_class,
            occurredAt: isoOf(row.occurred_at),
          };
        }
      }
      const incidents: ProviderIncidentView[] = [];
      const rowRefs: string[] = [];
      for (let index = 0; index < operations.rows.length; index += 1) {
        const row = operations.rows[index];
        if (row === undefined) continue;
        const incidentRef = `prov:${row.provider_id}:${row.operation_id}:${row.version}`;
        const reason = reasonByOperation[`${row.provider_id}:${row.operation_id}:${row.version}`];
        incidents[incidents.length] = {
          providerId: row.provider_id,
          operationId: row.operation_id,
          version: row.version,
          incidentRef,
          healthStatus: row.health_status,
          currentState: row.current_state,
          reasonClass: reason?.reasonClass ?? null,
          occurredAt: reason?.occurredAt ?? isoOf(row.updated_at),
        };
        rowRefs[rowRefs.length] = incidentRef;
      }
      if (rowRefs.length === 0) {
        rowRefs[rowRefs.length] = `prov.prov_operations:healthy@${computedAt}`;
      }
      const openCount = incidents.length;
      return validatedRead(ProviderIncidentsPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.PROVIDER_LIFECYCLE,
        rowRefs,
        qualityCodes: providerIncidentQualityCodes(
          openCount,
          operations.rows.length >= rowRefLimit,
        ),
        detail:
          openCount > 0
            ? `${openCount} provider operation(s) are not healthy; affected sections degrade`
            : null,
        // An open incident is an explicit degradation, NEVER a fresh-complete claim.
        freshness: openCount > 0 ? 'STALE' : 'FRESH',
        computedAt,
        expiresAt: expiry(),
        payload: { incidents, openCount },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.PROVIDER_LIFECYCLE,
        `provider incident state unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readQuotaExhaustionForecast(): Promise<SourceRead<QuotaForecastPayload>> {
    const computedAt = now();
    try {
      const forecast = await engine.query<{
        forecast_id: string;
        schedule_id: string;
        version_id: string;
        computed_at: string;
        payload: unknown;
      }>(
        `SELECT forecast_id, schedule_id, version_id, computed_at, payload
           FROM wf.schedule_forecasts
          ORDER BY computed_at DESC
          LIMIT 1`,
      );
      // ONLY the active quota period counts (owner read: quota-adapter.ts
      // filters `period_window_start <= now AND period_reset_at > now`); a
      // closed period's remaining units are history, not current headroom.
      const balances = await engine.query<{
        provider_id: string;
        quota_model_id: string;
        cap_limit: unknown;
        remaining_units: unknown;
        period_window_start: string;
        period_reset_at: string;
      }>(
        `SELECT DISTINCT ON (provider_id, quota_model_id)
                provider_id, quota_model_id, cap_limit, remaining_units,
                period_window_start, period_reset_at
           FROM cost.cost_quota_balances
          WHERE period_window_start <= $1::timestamptz
            AND period_reset_at > $1::timestamptz
          ORDER BY provider_id, quota_model_id, period_window_start DESC`,
        [computedAt],
      );
      const quotaBalances: QuotaForecastPayload['quotaBalances'] = [];
      const rowRefs: string[] = [];
      for (let index = 0; index < balances.rows.length; index += 1) {
        const row = balances.rows[index];
        if (row === undefined) continue;
        quotaBalances[quotaBalances.length] = {
          providerId: row.provider_id,
          quotaModelId: row.quota_model_id,
          capLimit: numberOf(row.cap_limit),
          remainingUnits: numberOf(row.remaining_units),
          periodWindowStart: isoOf(row.period_window_start),
          resetAt: isoOf(row.period_reset_at),
        };
        if (rowRefs.length < rowRefLimit) {
          rowRefs[rowRefs.length] =
            `cost.cost_quota_balances:${row.provider_id}:${row.quota_model_id}`;
        }
      }
      const head = forecast.rows[0];
      if (head !== undefined) {
        rowRefs[rowRefs.length] = `wf.schedule_forecasts:${head.forecast_id}`;
      }
      if (rowRefs.length === 0) {
        rowRefs[rowRefs.length] = `wf.schedule_forecasts:none@${computedAt}`;
      }
      const payloadObject =
        head !== undefined && head.payload !== null && typeof head.payload === 'object'
          ? (head.payload as Record<string, unknown>)
          : null;
      // The owner's own §33.6 freshness window decides staleness; the overview
      // never invents a window of its own (plan D1).
      const computedAtMs = head === undefined ? null : Date.parse(head.computed_at);
      const expiresAt =
        computedAtMs === null || !Number.isFinite(computedAtMs)
          ? null
          : new Date(computedAtMs + FORECAST_FRESHNESS_WINDOW_MS).toISOString();
      return validatedRead(QuotaForecastPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.WORKFLOW_RUNTIME,
        rowRefs,
        qualityCodes: head === undefined ? ['QUOTA_FORECAST_ABSENT'] : [],
        detail: head === undefined ? 'no §33.6 schedule forecast has been recorded' : null,
        // Absence of a forecast is an explicit insufficient read, never fresh;
        // a forecast past the owner's freshness window is STALE.
        freshness:
          head === undefined
            ? 'UNKNOWN'
            : expiresAt === null
              ? 'STALE'
              : freshnessForExpiry(expiresAt, computedAt),
        computedAt,
        expiresAt,
        payload: {
          forecastId: head?.forecast_id ?? null,
          planVersionId: head?.version_id ?? null,
          scheduleId: head?.schedule_id ?? null,
          computedAt: head === undefined ? null : isoOf(head.computed_at),
          expiresAt,
          runsPerDay: payloadObject === null ? null : numberOf(payloadObject['runsPerDay']),
          providerCallsPerDay:
            payloadObject === null ? null : numberOf(payloadObject['providerCallsPerDay']),
          modelTokensPerDay:
            payloadObject === null ? null : numberOf(payloadObject['modelTokensPerDay']),
          estimatedModelSpendPerDay:
            payloadObject === null ? null : textOf(payloadObject['estimatedModelSpendPerDay']),
          quotaExhaustionDate:
            payloadObject === null ? null : textOf(payloadObject['quotaExhaustionDate']),
          storageGrowthPerMonth:
            payloadObject === null ? null : numberOf(payloadObject['storageGrowthPerMonth']),
          quotaBalances,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.WORKFLOW_RUNTIME,
        `quota-exhaustion forecast unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readActiveSchedules(): Promise<SourceRead<ActiveSchedulesPayload>> {
    const computedAt = now();
    try {
      const result = await engine.query<{
        schedule_id: string;
        name: string;
        status: string;
        current_version_id: string | null;
        shadow: boolean | null;
      }>(
        `SELECT s.schedule_id, s.name, s.status, s.current_version_id, v.shadow
           FROM wf.schedules s
           LEFT JOIN wf.schedule_versions v ON v.version_id = s.current_version_id
          ORDER BY s.schedule_id`,
      );
      const schedules: ActiveSchedulesPayload['schedules'] = [];
      const rowRefs: string[] = [];
      let activeCount = 0;
      let pausedCount = 0;
      let disabledCount = 0;
      let draftCount = 0;
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        if (row === undefined) continue;
        if (row.status === 'ACTIVE') activeCount += 1;
        else if (row.status === 'PAUSED') pausedCount += 1;
        else if (row.status === 'DISABLED') disabledCount += 1;
        else if (row.status === 'DRAFT') draftCount += 1;
        schedules[schedules.length] = {
          scheduleId: row.schedule_id,
          name: row.name,
          status: row.status,
          shadow: row.shadow === true,
          currentVersionId: row.current_version_id,
        };
        if (rowRefs.length < rowRefLimit)
          rowRefs[rowRefs.length] = `wf.schedules:${row.schedule_id}`;
      }
      if (rowRefs.length === 0) rowRefs[rowRefs.length] = `wf.schedules:none@${computedAt}`;
      return validatedRead(ActiveSchedulesPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.WORKFLOW_RUNTIME,
        rowRefs,
        qualityCodes: [],
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: { schedules, activeCount, pausedCount, disabledCount, draftCount },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.WORKFLOW_RUNTIME,
        `workflow schedules unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readScheduleDrift(): Promise<SourceRead<ScheduleDriftPayload>> {
    const computedAt = now();
    try {
      const result = await engine.query<{
        report_id: string;
        checked_at: string;
        diff: unknown;
        incident_refs: unknown;
      }>(
        `SELECT report_id, checked_at, diff, incident_refs
           FROM wf.reconciliation_reports
          ORDER BY checked_at DESC
          LIMIT 20`,
      );
      const reports: ScheduleDriftPayload['reports'] = [];
      const incidentRefs: string[] = [];
      let latestCheckedAt: string | null = null;
      let driftDetected = false;
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        if (row === undefined) continue;
        const refs: string[] = [];
        if (Array.isArray(row.incident_refs)) {
          const raw = row.incident_refs as unknown[];
          for (let refIndex = 0; refIndex < raw.length; refIndex += 1) {
            const value = raw[refIndex];
            if (typeof value === 'string') refs[refs.length] = value;
          }
        }
        const diff = row.diff as { skews?: unknown } | null;
        const skews = diff !== null && typeof diff === 'object' ? diff.skews : undefined;
        const skewCount = Array.isArray(skews) ? skews.length : 0;
        if (skewCount > 0 || refs.length > 0) driftDetected = true;
        if (latestCheckedAt === null) latestCheckedAt = isoOf(row.checked_at);
        reports[reports.length] = {
          reportId: row.report_id,
          checkedAt: isoOf(row.checked_at) ?? row.checked_at,
          skewCount,
          incidentRefs: refs,
        };
        appendUnique(incidentRefs, refs);
      }
      const rowRefs: string[] = [];
      for (let index = 0; index < reports.length; index += 1) {
        const report = reports[index];
        if (report !== undefined)
          rowRefs[rowRefs.length] = `wf.reconciliation_reports:${report.reportId}`;
      }
      if (rowRefs.length === 0) {
        rowRefs[rowRefs.length] = `wf.reconciliation_reports:none@${computedAt}`;
      }
      return validatedRead(ScheduleDriftPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.WORKFLOW_RUNTIME,
        rowRefs,
        qualityCodes: drillCodes(driftDetected),
        detail: driftDetected
          ? '§25.10 reconciliation reports drift between the database and the external scheduler'
          : null,
        // No report at all is UNKNOWN; an aged report is STALE, never fresh
        // complete (a months-old §25.10 diff is not current coverage).
        freshness:
          result.rows.length === 0
            ? 'UNKNOWN'
            : latestCheckedAt !== null && clock() - Date.parse(latestCheckedAt) > driftFreshnessMs
              ? 'STALE'
              : 'FRESH',
        computedAt,
        expiresAt: expiry(),
        payload: {
          reports,
          latestCheckedAt,
          incidentRefs,
          repairedRefs: Object.freeze([]),
          driftDetected,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.WORKFLOW_RUNTIME,
        `§25.10 schedule drift unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  function drillCodes(driftDetected: boolean): string[] {
    return driftDetected ? ['SCHEDULE_DRIFT_DETECTED'] : [];
  }

  async function readWorkflowCounts(): Promise<SourceRead<WorkflowCountsPayload>> {
    const computedAt = now();
    try {
      const runs = await engine.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM wf.runs GROUP BY status`,
      );
      const deadLetters = await engine.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM wf.dead_letters GROUP BY status`,
      );
      const outbox = await engine.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM wf.notification_outbox GROUP BY status`,
      );
      // `WAITING` is a RUN status, not a step status (see g2_wf_0001): count the
      // steps belonging to waiting runs.
      const waitingSteps = await engine.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM wf.steps s
           JOIN wf.runs r ON r.run_id = s.run_id
          WHERE r.status = 'WAITING'`,
      );
      const runsByStatus = countByKey(runs.rows, (row) => row.status);
      const deadLetterCounts = countByKey(deadLetters.rows, (row) => row.status);
      const outboxCounts = countByKey(outbox.rows, (row) => row.status);
      const rowRefs: string[] = [`wf.runs:count@${computedAt}`];
      return validatedRead(WorkflowCountsPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.WORKFLOW_RUNTIME,
        rowRefs,
        qualityCodes: (deadLetterCounts['OPEN'] ?? 0) > 0 ? ['DEAD_LETTERS_OPEN'] : [],
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: {
          runsByStatus,
          deadLetterCounts,
          outboxCounts,
          pendingRuns: runsByStatus['PENDING'] ?? 0,
          runningRuns: runsByStatus['RUNNING'] ?? 0,
          waitingRuns: runsByStatus['WAITING'] ?? 0,
          openDeadLetters: deadLetterCounts['OPEN'] ?? 0,
          waitingSteps: integerOf(waitingSteps.rows[0]?.count),
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.WORKFLOW_RUNTIME,
        `workflow/run/dead-letter counts unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readCandidateCounts(): Promise<SourceRead<CandidateCountsPayload>> {
    const computedAt = now();
    try {
      const lifecycle = await engine.query<{ state: string; count: number }>(
        `SELECT to_state AS state, count(*)::int AS count
           FROM (
             SELECT DISTINCT ON (candidate_id) candidate_id, to_state
               FROM sig.candidate_lifecycle
              ORDER BY candidate_id, transitioned_at DESC, transition_id DESC
           ) latest
          GROUP BY to_state
          ORDER BY to_state`,
      );
      // Risk counts are the owner's LATEST persisted `CandidateRiskState` per
      // alert fingerprint (the alert lifecycle owns the risk vocabulary); the
      // overview never reclassifies risk.
      const risk = await engine.query<{ state: string; count: number }>(
        `SELECT risk_state AS state, count(*)::int AS count
           FROM (
             SELECT DISTINCT ON (fingerprint) fingerprint, risk_state
               FROM alert.alert_records
              ORDER BY fingerprint, created_at DESC, alert_id DESC
           ) latest
          GROUP BY risk_state
          ORDER BY risk_state`,
      );
      const byLifecycleState = countByKey(lifecycle.rows, (row) => row.state);
      const byRiskState: Record<string, number> = {};
      let total = 0;
      for (let index = 0; index < risk.rows.length; index += 1) {
        const row = risk.rows[index];
        if (row === undefined) continue;
        const parsed = CandidateRiskStateSchema.safeParse(row.state);
        if (!parsed.success) continue;
        byRiskState[parsed.data] = integerOf(row.count);
        total += integerOf(row.count);
      }
      const rowRefs: string[] = [`sig.candidate_lifecycle:latest@${computedAt}`];
      return validatedRead(CandidateCountsPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.SIGNAL_INTELLIGENCE,
        rowRefs,
        qualityCodes: [],
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: { byLifecycleState, byRiskState, total },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.SIGNAL_INTELLIGENCE,
        `candidate lifecycle/risk counts unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readAlertPrecisionRecall(): Promise<SourceRead<AlertPrecisionRecallPayload>> {
    const computedAt = now();
    const windowEnd = computedAt;
    const windowStart = new Date(clock() - alertWindowMs).toISOString();
    try {
      const confirmedResults = await computeConfirmedOpportunityMetrics(engine, {
        windowStart,
        windowEnd,
      });
      const earlyWatchResults: AlertMetricResult[] = [];
      const earlyWatchKeys = declaredAlertMetricKeys('EARLY_WATCH');
      for (let index = 0; index < earlyWatchKeys.length; index += 1) {
        const metricKey = earlyWatchKeys[index];
        if (metricKey === undefined) continue;
        earlyWatchResults[earlyWatchResults.length] = await computeAlertMetric(engine, {
          alertClass: 'EARLY_WATCH',
          metricKey,
          windowStart,
          windowEnd,
          scope: AlertMetricScope.CLASS,
          populationClasses: ['EARLY_WATCH'],
        });
      }
      // Delegated owner guard: the confirmed denominator can never include an
      // EARLY_WATCH observation or early-watch metric key.
      const confirmedObservations: {
        alertClass: 'CONFIRMED_OPPORTUNITY';
        metricKey: AlertMetricResult['metricKey'];
        numerator: number;
        denominator: number;
        sampleSize: number;
        windowStart: string;
        windowEnd: string;
      }[] = [];
      for (let index = 0; index < confirmedResults.length; index += 1) {
        const result = confirmedResults[index];
        if (result === undefined) continue;
        confirmedObservations[confirmedObservations.length] = {
          alertClass: 'CONFIRMED_OPPORTUNITY',
          metricKey: result.metricKey,
          numerator: result.numerator,
          denominator: result.denominator,
          sampleSize: result.sampleSize,
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
        };
      }
      assertNoEarlyWatchInConfirmedDenominator(confirmedObservations);

      // A class's metrics share a population, so the class denominator/sample
      // size is the MAXIMUM over its declared metric keys, never a sum across
      // precision+recall (which would double-count the same observations).
      // Per-metric denominators are reported separately for full transparency.
      const perClassDenominators: Record<string, number> = {};
      const perClassSampleSizes: Record<string, number> = {};
      const perMetricDenominators: Record<string, number> = {};
      for (let classIndex = 0; classIndex < ALL_ALERT_CLASSES.length; classIndex += 1) {
        const alertClass = ALL_ALERT_CLASSES[classIndex];
        if (alertClass === undefined) continue;
        perClassDenominators[alertClass] = 0;
        perClassSampleSizes[alertClass] = 0;
      }
      for (let classIndex = 0; classIndex < ALL_ALERT_CLASSES.length; classIndex += 1) {
        const alertClass = ALL_ALERT_CLASSES[classIndex];
        if (alertClass === undefined) continue;
        const keys = declaredAlertMetricKeys(alertClass);
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          const metricKey = keys[keyIndex];
          if (metricKey === undefined) continue;
          const result = await computeAlertMetric(engine, {
            alertClass,
            metricKey,
            windowStart,
            windowEnd,
            scope: AlertMetricScope.CLASS,
            populationClasses: [alertClass],
          });
          perMetricDenominators[`${alertClass}:${metricKey}`] = result.denominator;
          const currentDenominator = perClassDenominators[alertClass] ?? 0;
          if (result.denominator > currentDenominator) {
            perClassDenominators[alertClass] = result.denominator;
          }
          const currentSample = perClassSampleSizes[alertClass] ?? 0;
          if (result.sampleSize > currentSample) {
            perClassSampleSizes[alertClass] = result.sampleSize;
          }
        }
      }

      const confirmed = toAlertMetricViews(confirmedResults);
      const earlyWatch = toAlertMetricViews(earlyWatchResults);
      // The confirmed sample size is the sample behind EACH confirmed metric
      // (max over the shared-population metrics), so it is consistent with the
      // reported confidence interval rather than an inflated sum.
      let sampleSize = 0;
      for (let index = 0; index < confirmed.length; index += 1) {
        const metricSample = confirmed[index]?.sampleSize ?? 0;
        if (metricSample > sampleSize) sampleSize = metricSample;
      }
      let confidenceInterval: ConfidenceIntervalView | null = null;
      for (let index = 0; index < confirmed.length; index += 1) {
        const view = confirmed[index];
        if (view === undefined) continue;
        if (view.metricKey === 'CONFIRMED_PRECISION' || confidenceInterval === null) {
          confidenceInterval = view.confidenceInterval;
        }
        if (view.metricKey === 'CONFIRMED_PRECISION') break;
      }

      const rowRefs: string[] = [`alert.alert_metric_observations:window@${windowStart}`];
      return validatedRead(AlertPrecisionRecallPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.ALERTS,
        rowRefs,
        qualityCodes: sampleSize === 0 ? ['ALERT_SAMPLE_INSUFFICIENT'] : [],
        detail:
          sampleSize === 0
            ? 'no confirmed-opportunity observations in the window: precision/recall is insufficient'
            : null,
        freshness: sampleSize === 0 ? 'STALE' : 'FRESH',
        computedAt,
        expiresAt: expiry(),
        payload: {
          windowStart,
          windowEnd,
          confirmed,
          earlyWatch,
          perClassDenominators,
          perClassSampleSizes,
          perMetricDenominators,
          sampleSize,
          confidenceInterval,
          neverPoolsEarlyWatch: true,
          ownerGuards: [
            'computeConfirmedOpportunityMetrics',
            'assertNoEarlyWatchInConfirmedDenominator',
          ],
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.ALERTS,
        `alert precision/recall metrics unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  function toAlertMetricViews(results: readonly AlertMetricResult[]): AlertMetricView[] {
    const views: AlertMetricView[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result === undefined) continue;
      views[views.length] = {
        alertClass: result.alertClass,
        metricKey: result.metricKey,
        numerator: result.numerator,
        denominator: result.denominator,
        sampleSize: result.sampleSize,
        observationCount: result.observationCount,
        rate: result.rate,
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        confidenceInterval: wilsonScoreInterval(
          result.numerator,
          result.denominator,
          result.sampleSize,
        ),
      };
    }
    return views;
  }

  async function readMissedGems(): Promise<SourceRead<MissedGemsPayload>> {
    const computedAt = now();
    try {
      const result = await engine.query<{
        candidate_id: string;
        miss_classification: string;
      }>(
        `SELECT candidate_id, miss_classification
           FROM missed_opportunities
          ORDER BY analyzed_at DESC
          LIMIT $1`,
        [rowRefLimit],
      );
      const rows: MissedGemClassificationRow[] = [];
      const rowRefs: string[] = [];
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        if (row === undefined) continue;
        if (!isMissClassification(row.miss_classification)) continue;
        rows[rows.length] = {
          candidateRef: row.candidate_id,
          missClassification: row.miss_classification,
        };
        if (rowRefs.length < rowRefLimit) {
          rowRefs[rowRefs.length] = `missed_opportunities:${row.candidate_id}`;
        }
      }
      if (rowRefs.length === 0) {
        rowRefs[rowRefs.length] = `missed_opportunities:none@${computedAt}`;
      }
      const grouped = groupMissedGemClassifications(rows);
      return validatedRead(MissedGemsPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.EVALUATION,
        rowRefs,
        qualityCodes: truncationQualityCodes(result.rows.length >= rowRefLimit),
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: {
          groups: grouped.groups,
          categories: ALL_MISSED_GEM_CATEGORIES,
          total: grouped.total,
          windowStart: null,
          windowEnd: null,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.EVALUATION,
        `missed-gems analysis unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readFunnelFailures(): Promise<SourceRead<FunnelFailuresPayload>> {
    const computedAt = now();
    try {
      const result = await engine.query<{
        stage: string;
        gate_code: string | null;
        count: number;
      }>(
        `SELECT stage, gate_code, count(*)::int AS count
           FROM sig.candidate_funnel_stages
          WHERE passed = false
          GROUP BY stage, gate_code
          ORDER BY count DESC
          LIMIT $1`,
        [rowRefLimit],
      );
      const failures: FunnelFailuresPayload['failures'] = [];
      let total = 0;
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        if (row === undefined) continue;
        failures[failures.length] = {
          stage: row.stage,
          gateCode: row.gate_code,
          count: integerOf(row.count),
        };
        total += integerOf(row.count);
      }
      const rowRefs = [`sig.candidate_funnel_stages:failed@${computedAt}`];
      const funnelQualityCodes: string[] = [];
      if (total > 0) funnelQualityCodes[funnelQualityCodes.length] = 'FUNNEL_FAILURES_PRESENT';
      if (result.rows.length >= rowRefLimit) {
        funnelQualityCodes[funnelQualityCodes.length] = 'RESULT_TRUNCATED';
      }
      return validatedRead(FunnelFailuresPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.SIGNAL_INTELLIGENCE,
        rowRefs,
        qualityCodes: funnelQualityCodes,
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: { failures, total },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.SIGNAL_INTELLIGENCE,
        `funnel failure counts unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readModelProviderCost(): Promise<SourceRead<CostPayload>> {
    const computedAt = now();
    try {
      // ONLY the active budget period counts (owner read: budget-policy.ts
      // filters `period_window_start <= now AND period_reset_at > now`). The
      // PK includes `period_window_start`, so without this filter the section
      // would report lifetime-cumulative spend against a one-window label.
      const result = await engine.query<{
        dimension: string;
        period_window_start: string;
        period_reset_at: string;
        cap_limit: unknown;
        consumed: unknown;
        rendered_classes: string;
      }>(
        `SELECT DISTINCT ON (dimension)
                dimension, period_window_start, period_reset_at, cap_limit, consumed, rendered_classes
           FROM cost.budget_consumption_totals
          WHERE period_window_start <= $1::timestamptz
            AND period_reset_at > $1::timestamptz
          ORDER BY dimension, period_window_start DESC`,
        [computedAt],
      );
      const byDimension: Record<string, number> = {};
      let modelCostUsd = 0;
      let providerCostUsd = 0;
      let totalCostUsd = 0;
      let budgetLimitUsd = 0;
      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      const rowRefs = [`cost.budget_consumption_totals@${computedAt}`];
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        if (row === undefined) continue;
        const consumed = numberOf(row.consumed) ?? 0;
        const cap = numberOf(row.cap_limit) ?? 0;
        let classes: Record<string, unknown> = {};
        try {
          classes = JSON.parse(row.rendered_classes) as Record<string, unknown>;
        } catch {
          classes = {};
        }
        const model = numberOf(classes['MODEL_SPEND']) ?? 0;
        const paidData = numberOf(classes['PAID_DATA_SPEND']) ?? 0;
        byDimension[row.dimension] = (byDimension[row.dimension] ?? 0) + consumed;
        modelCostUsd += model;
        providerCostUsd += paidData;
        totalCostUsd += consumed;
        budgetLimitUsd += cap;
        if (windowStart === null) windowStart = isoOf(row.period_window_start);
        if (windowEnd === null) windowEnd = isoOf(row.period_reset_at);
      }
      return validatedRead(CostPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.COST_ROUTER,
        rowRefs,
        qualityCodes:
          budgetLimitUsd > 0 && totalCostUsd > budgetLimitUsd ? ['BUDGET_EXCEEDED'] : [],
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: {
          windowStart,
          windowEnd,
          modelCostUsd,
          providerCostUsd,
          totalCostUsd,
          byDimension,
          budgetLimitUsd,
          budgetUtilization: budgetLimitUsd > 0 ? totalCostUsd / budgetLimitUsd : null,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.COST_ROUTER,
        `model/provider cost unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readStorageGrowth(): Promise<SourceRead<StorageGrowthPayload>> {
    const computedAt = now();
    const windowStart = new Date(clock() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await engine.query<{
        total_bytes: unknown;
        object_count: unknown;
        bytes_recent: unknown;
      }>(
        `SELECT coalesce(sum(size_bytes), 0) AS total_bytes,
                count(*)::int AS object_count,
                coalesce(sum(CASE WHEN uploaded_at >= $1 THEN size_bytes ELSE 0 END), 0) AS bytes_recent
           FROM object_artifacts`,
        [windowStart],
      );
      const row = result.rows[0];
      const totalBytes = row === undefined ? null : numberOf(row.total_bytes);
      const bytesRecent = row === undefined ? null : numberOf(row.bytes_recent);
      const bytesPerDay = bytesRecent === null ? null : bytesRecent / 30;
      return validatedRead(StorageGrowthPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.PERSISTENCE_RECOVERY,
        rowRefs: [`object_artifacts:sum@${computedAt}`],
        qualityCodes: [],
        detail: null,
        computedAt,
        expiresAt: expiry(),
        payload: {
          measuredAt: computedAt,
          totalBytes,
          objectCount: row === undefined ? null : integerOf(row.object_count),
          bytesPerDay,
          bytesPerMonth: bytesRecent,
          growthPerMonth: bytesRecent,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.PERSISTENCE_RECOVERY,
        `storage growth unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readLatestBackupStatus(): Promise<SourceRead<BackupStatusPayload>> {
    const computedAt = now();
    try {
      const run = await engine.query<{
        run_id: string;
        policy_id: string;
        started_at: string;
        finished_at: string | null;
        status: string;
        artifact_refs: unknown;
      }>(
        `SELECT run_id, policy_id, started_at, finished_at, status, artifact_refs
           FROM backup_runs
          ORDER BY created_at DESC
          LIMIT 1`,
      );
      const policy = await engine.query<{
        policy_id: string;
        retention_days: unknown;
        encryption_status: string;
        location_ref: string;
        rights_ref: string;
        legal_hold: boolean;
        deletion_policy: string;
        key_reference: string;
      }>(
        `SELECT policy_id, retention_days, encryption_status, location_ref, rights_ref,
                legal_hold, deletion_policy, key_reference
           FROM backup_policies
          ORDER BY created_at DESC
          LIMIT 1`,
      );
      const drill = await engine.query<{
        drill_id: string;
        started_at: string;
        finished_at: string | null;
        outcome: string;
        checks: unknown;
        credential_provider_present: boolean;
      }>(
        `SELECT drill_id, started_at, finished_at, outcome, checks, credential_provider_present
           FROM restore_drills
          ORDER BY created_at DESC
          LIMIT 1`,
      );
      const tiers = await engine.query<{ tier_id: string; rpo_target_minutes: unknown }>(
        `SELECT tier_id, rpo_target_minutes FROM recovery_tiers ORDER BY tier_id`,
      );
      const measurements = await engine.query<{
        tier_id: string;
        achieved_rpo_minutes: unknown;
        outcome: string;
        measured_at: string;
      }>(
        `SELECT DISTINCT ON (tier_id) tier_id, achieved_rpo_minutes, outcome, measured_at
           FROM tier_measurements
          ORDER BY tier_id, measured_at DESC`,
      );
      const health = await engine.query<{
        health_state_id: string;
        kind: string;
        confirmed_opportunity_influence_blocked: boolean;
        deterministic_risk_monitoring_allowed: boolean;
      }>(
        `SELECT health_state_id, kind, confirmed_opportunity_influence_blocked,
                deterministic_risk_monitoring_allowed
           FROM recovery_health_states
          ORDER BY evaluated_at DESC
          LIMIT 1`,
      );
      const rowRefs: string[] = [];
      const runRow = run.rows[0];
      if (runRow !== undefined) rowRefs[rowRefs.length] = `backup_runs:${runRow.run_id}`;
      const policyRow = policy.rows[0];
      if (policyRow !== undefined)
        rowRefs[rowRefs.length] = `backup_policies:${policyRow.policy_id}`;
      const drillRow = drill.rows[0];
      if (drillRow !== undefined) rowRefs[rowRefs.length] = `restore_drills:${drillRow.drill_id}`;
      if (rowRefs.length === 0) rowRefs[rowRefs.length] = `backup_runs:none@${computedAt}`;

      let policyValidated = false;
      if (policyRow !== undefined) {
        try {
          validateBackupPolicy({
            policyId: policyRow.policy_id,
            retentionDays: integerOf(policyRow.retention_days),
            encryptionStatus: policyRow.encryption_status,
            locationRef: policyRow.location_ref,
            rightsRef: policyRow.rights_ref,
            legalHold: policyRow.legal_hold === true,
            deletionPolicy: policyRow.deletion_policy,
            keyReference: policyRow.key_reference,
          });
          policyValidated = true;
        } catch {
          policyValidated = false;
        }
      }

      let rpoTargetMinutes: number | null = null;
      let measuredRpoMinutes: number | null = null;
      // A tier that MISSED its RPO/RTO objective is never green, even when the
      // numeric maximum looks within target.
      let anyTierMissed = false;
      for (let index = 0; index < tiers.rows.length; index += 1) {
        const row = tiers.rows[index];
        if (row === undefined) continue;
        const value = numberOf(row.rpo_target_minutes);
        if (value !== null && (rpoTargetMinutes === null || value > rpoTargetMinutes)) {
          rpoTargetMinutes = value;
        }
      }
      for (let index = 0; index < measurements.rows.length; index += 1) {
        const row = measurements.rows[index];
        if (row === undefined) continue;
        if (row.outcome !== 'WITHIN_TIER') anyTierMissed = true;
        const value = numberOf(row.achieved_rpo_minutes);
        if (value !== null && (measuredRpoMinutes === null || value > measuredRpoMinutes)) {
          measuredRpoMinutes = value;
        }
      }

      const healthRow = health.rows[0];
      const artifacts: string[] = [];
      if (runRow !== undefined && Array.isArray(runRow.artifact_refs)) {
        const refs = runRow.artifact_refs as unknown[];
        for (let index = 0; index < refs.length; index += 1) {
          const ref = refs[index];
          if (typeof ref === 'string') artifacts[artifacts.length] = ref;
        }
      }

      // A missing or failed backup/drill renders explicit blocked/UNKNOWN, never
      // an optimistic green.
      let freshness: AdminOverviewFreshness = 'FRESH';
      if (runRow === undefined || drillRow === undefined) freshness = 'UNKNOWN';
      else if (runRow.status !== 'SUCCEEDED' || drillRow.outcome !== 'PASSED') freshness = 'STALE';
      if (!policyValidated || anyTierMissed) freshness = 'STALE';

      const qualityCodes: string[] = [];
      if (runRow === undefined) qualityCodes[qualityCodes.length] = 'BACKUP_ABSENT';
      else if (runRow.status !== 'SUCCEEDED')
        qualityCodes[qualityCodes.length] = 'BACKUP_NOT_SUCCEEDED';
      if (drillRow === undefined) qualityCodes[qualityCodes.length] = 'DRILL_ABSENT';
      else if (drillRow.outcome !== 'PASSED')
        qualityCodes[qualityCodes.length] = 'DRILL_NOT_PASSED';
      if (!policyValidated) qualityCodes[qualityCodes.length] = 'BACKUP_POLICY_UNVALIDATED';
      if (anyTierMissed) qualityCodes[qualityCodes.length] = 'TIER_RPO_MISSED';

      return validatedRead(BackupStatusPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.PERSISTENCE_RECOVERY,
        rowRefs,
        qualityCodes,
        detail:
          freshness === 'UNKNOWN'
            ? 'no latest backup run or restore drill is recorded'
            : freshness === 'STALE'
              ? 'the latest backup or restore drill did not pass'
              : null,
        freshness,
        computedAt,
        expiresAt: expiry(),
        payload: {
          latestRunId: runRow?.run_id ?? null,
          latestBackupAt:
            runRow === undefined ? null : isoOf(runRow.finished_at ?? runRow.started_at),
          latestBackupStatus: runRow?.status ?? null,
          artifactRefs: artifacts,
          policyId: policyRow?.policy_id ?? null,
          policyValidated,
          rpoTargetMinutes,
          measuredRpoMinutes,
          drillId: drillRow?.drill_id ?? null,
          drillOutcome: drillRow?.outcome ?? null,
          drillFinishedAt: drillRow === undefined ? null : isoOf(drillRow.finished_at),
          credentialProviderPresent: drillRow?.credential_provider_present ?? null,
          healthKind: healthRow?.kind ?? null,
          confirmedOpportunityInfluenceBlocked:
            healthRow?.confirmed_opportunity_influence_blocked ?? null,
          deterministicRiskMonitoringAllowed:
            healthRow?.deterministic_risk_monitoring_allowed ?? null,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.PERSISTENCE_RECOVERY,
        `latest backup/drill status unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  async function readRecoveryReadiness(): Promise<SourceRead<RecoveryReadinessPayload>> {
    const computedAt = now();
    try {
      const drill = await engine.query<{
        drill_id: string;
        outcome: string;
        checks: unknown;
        finished_at: string | null;
      }>(
        `SELECT drill_id, outcome, checks, finished_at
           FROM restore_drills
          ORDER BY created_at DESC
          LIMIT 1`,
      );
      const tiers = await engine.query<{ tier_id: string; rpo_target_minutes: unknown }>(
        `SELECT tier_id, rpo_target_minutes FROM recovery_tiers ORDER BY tier_id`,
      );
      const measurements = await engine.query<{
        tier_id: string;
        achieved_rpo_minutes: unknown;
        outcome: string;
      }>(
        `SELECT DISTINCT ON (tier_id) tier_id, achieved_rpo_minutes, outcome
           FROM tier_measurements
          ORDER BY tier_id, measured_at DESC`,
      );
      const incidents = await engine.query<{ incident_id: string }>(
        `SELECT incident_id FROM recovery_incidents WHERE resolved_at IS NULL ORDER BY opened_at`,
      );

      const row = drill.rows[0];
      const verifications: RecoveryReadinessPayload['verifications'] = [];
      if (row !== undefined && Array.isArray(row.checks)) {
        const checks = row.checks as unknown[];
        for (let index = 0; index < checks.length; index += 1) {
          const check = checks[index];
          if (check === null || typeof check !== 'object') continue;
          const entry = check as Record<string, unknown>;
          verifications[verifications.length] = {
            name: textOf(entry['name']) ?? `check-${index}`,
            passed: entry['passed'] === true,
            detail: textOf(entry['detail']) ?? '',
          };
        }
      }

      const rpoTargetMinutesByTier: Record<string, number> = {};
      for (let index = 0; index < tiers.rows.length; index += 1) {
        const tierRow = tiers.rows[index];
        if (tierRow === undefined) continue;
        const value = numberOf(tierRow.rpo_target_minutes);
        if (value !== null) rpoTargetMinutesByTier[tierRow.tier_id] = value;
      }
      const measuredRpoMinutesByTier: Record<string, number> = {};
      const resumeBlockers: string[] = [];
      for (let index = 0; index < measurements.rows.length; index += 1) {
        const measureRow = measurements.rows[index];
        if (measureRow === undefined) continue;
        const value = numberOf(measureRow.achieved_rpo_minutes);
        if (value !== null) measuredRpoMinutesByTier[measureRow.tier_id] = value;
        // A tier objective that was MISSED is a resume blocker in its own right
        // (never inferred from an aggregate maximum).
        if (measureRow.outcome !== 'WITHIN_TIER') {
          resumeBlockers[resumeBlockers.length] =
            `TIER_MEASUREMENT_${measureRow.outcome}:${measureRow.tier_id}`;
        }
      }

      if (row === undefined) resumeBlockers[resumeBlockers.length] = 'RESTORE_DRILL_ABSENT';
      else if (row.outcome !== 'PASSED')
        resumeBlockers[resumeBlockers.length] = `RESTORE_DRILL_${row.outcome}`;
      for (let index = 0; index < verifications.length; index += 1) {
        const verification = verifications[index];
        if (verification !== undefined && !verification.passed) {
          resumeBlockers[resumeBlockers.length] = `VERIFICATION_FAILED:${verification.name}`;
        }
      }
      const openIncidentRefs: string[] = [];
      for (let index = 0; index < incidents.rows.length; index += 1) {
        const incident = incidents.rows[index];
        if (incident === undefined) continue;
        openIncidentRefs[openIncidentRefs.length] = `recovery_incidents:${incident.incident_id}`;
        resumeBlockers[resumeBlockers.length] = `RECOVERY_INCIDENT_OPEN:${incident.incident_id}`;
      }

      const executedChecks: string[] = [];
      for (let index = 0; index < verifications.length; index += 1) {
        const verification = verifications[index];
        if (verification === undefined) continue;
        executedChecks[executedChecks.length] = verification.name;
      }

      const rowRefs: string[] = [];
      if (row !== undefined) rowRefs[rowRefs.length] = `restore_drills:${row.drill_id}`;
      appendUnique(rowRefs, openIncidentRefs);
      if (rowRefs.length === 0) rowRefs[rowRefs.length] = `restore_drills:none@${computedAt}`;

      const freshness: AdminOverviewFreshness =
        row === undefined
          ? 'UNKNOWN'
          : row.outcome === 'PASSED' && resumeBlockers.length === 0
            ? 'FRESH'
            : 'STALE';
      return validatedRead(RecoveryReadinessPayloadSchema, {
        ownerPackage: OverviewOwnerPackage.PERSISTENCE_RECOVERY,
        rowRefs,
        qualityCodes: resumeBlockers.length > 0 ? ['RECOVERY_RESUME_BLOCKED'] : [],
        detail:
          resumeBlockers.length > 0
            ? `${resumeBlockers.length} recovery resume blocker(s) are open`
            : null,
        freshness,
        computedAt,
        expiresAt: expiry(),
        payload: {
          drillId: row?.drill_id ?? null,
          outcome: row?.outcome ?? null,
          verifications,
          executedChecks,
          resumeBlockers,
          automationResumeAllowed: resumeBlockers.length === 0,
          measuredRpoMinutesByTier,
          rpoTargetMinutesByTier,
          openIncidentRefs,
        },
      });
    } catch (error) {
      return unknownRead(
        OverviewOwnerPackage.PERSISTENCE_RECOVERY,
        `recovery readiness unavailable: ${errorDetail(error)}`,
        computedAt,
      );
    }
  }

  return Object.freeze({
    readSystemMode,
    readKillSwitchState,
    readProviderIncidents,
    readQuotaExhaustionForecast,
    readActiveSchedules,
    readScheduleDrift,
    readWorkflowCounts,
    readCandidateCounts,
    readAlertPrecisionRecall,
    readMissedGems,
    readFunnelFailures,
    readModelProviderCost,
    readStorageGrowth,
    readLatestBackupStatus,
    readRecoveryReadiness,
  });
}

// --- local closed-vocabulary guard -------------------------------------------

/** Numeric-index membership in the evaluation owner's miss vocabulary. */
function isMissClassification(value: unknown): value is MissClassification {
  return isOneOf(value, ALL_MISS_CLASSIFICATIONS);
}

// --- section → owner/reader mapping (assembly consume surface) ---------------

/** Provenance owner per section; used when a port throws before naming one. */
export const OVERVIEW_SECTION_OWNERS: Readonly<Record<OverviewSectionKeyType, string>> =
  Object.freeze({
    SYSTEM_MODE: OverviewOwnerPackage.CAPABILITY_REGISTRY,
    KILL_SWITCH_STATE: OverviewOwnerPackage.ADMIN,
    PROVIDER_INCIDENTS: OverviewOwnerPackage.PROVIDER_LIFECYCLE,
    QUOTA_EXHAUSTION_FORECAST: OverviewOwnerPackage.WORKFLOW_RUNTIME,
    ACTIVE_SCHEDULES: OverviewOwnerPackage.WORKFLOW_RUNTIME,
    SCHEDULE_DRIFT: OverviewOwnerPackage.WORKFLOW_RUNTIME,
    WORKFLOW_COUNTS: OverviewOwnerPackage.WORKFLOW_RUNTIME,
    CANDIDATE_LIFECYCLE_RISK_COUNTS: OverviewOwnerPackage.SIGNAL_INTELLIGENCE,
    ALERT_PRECISION_RECALL: OverviewOwnerPackage.ALERTS,
    MISSED_GEMS: OverviewOwnerPackage.EVALUATION,
    FUNNEL_FAILURES: OverviewOwnerPackage.SIGNAL_INTELLIGENCE,
    MODEL_PROVIDER_COST: OverviewOwnerPackage.COST_ROUTER,
    STORAGE_GROWTH: OverviewOwnerPackage.PERSISTENCE_RECOVERY,
    LATEST_BACKUP_STATUS: OverviewOwnerPackage.PERSISTENCE_RECOVERY,
    RECOVERY_READINESS: OverviewOwnerPackage.PERSISTENCE_RECOVERY,
  });

/** The exact section keys this package serves, mirroring §28.2 + recovery. */
export const ADMIN_OVERVIEW_SECTION_KEYS: readonly OverviewSectionKeyType[] = Object.freeze([
  OverviewSectionKey.SYSTEM_MODE,
  OverviewSectionKey.KILL_SWITCH_STATE,
  OverviewSectionKey.PROVIDER_INCIDENTS,
  OverviewSectionKey.QUOTA_EXHAUSTION_FORECAST,
  OverviewSectionKey.ACTIVE_SCHEDULES,
  OverviewSectionKey.SCHEDULE_DRIFT,
  OverviewSectionKey.WORKFLOW_COUNTS,
  OverviewSectionKey.CANDIDATE_LIFECYCLE_RISK_COUNTS,
  OverviewSectionKey.ALERT_PRECISION_RECALL,
  OverviewSectionKey.MISSED_GEMS,
  OverviewSectionKey.FUNNEL_FAILURES,
  OverviewSectionKey.MODEL_PROVIDER_COST,
  OverviewSectionKey.STORAGE_GROWTH,
  OverviewSectionKey.LATEST_BACKUP_STATUS,
  OverviewSectionKey.RECOVERY_READINESS,
]);
