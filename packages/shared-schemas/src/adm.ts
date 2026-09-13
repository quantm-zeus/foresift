/**
 * Runtime schemas for the admin control plane
 * (FR-ADM-001/003/007, PRD §28 in full, §24, §27, §32, §28.13, §25.11, §35.1,
 * and §69).
 *
 * Admin-only closed vocabularies live here — not in `@foresift/domain` —
 * because `packages/domain/**` is outside this package's writeScopes (plan D8,
 * ADR-G2ADM-6). Each vocabulary is declared ONCE as an `as const` object and
 * compiled into its Zod enum from that object, so a literal can only drift by
 * editing the single authority below. The future extraction of these literals
 * into `packages/domain` is a recorded out-of-scope note.
 *
 * Every object is `.strict()`: unknown keys are refused, never ignored. Content
 * hashes are `sha256:<64 lowercase hex>`; timestamps are ISO-8601 UTC strings
 * ending in `Z` (see `./data.ts`).
 *
 * Immutability by construction (ADR-0019): kill-switch state/event rows,
 * configuration versions, resolved-config previews, overview snapshots, and the
 * high-impact action audit each have an INSERT schema only. No update schema is
 * exported anywhere in this module — a change records a NEW row. The lifecycle
 * state of a configuration version is the one governed exception and is
 * validated by the §28.3 transition law in the control plane.
 *
 * Fail-closed laws encoded here (never weakened downstream):
 *   - an ENGAGED kill switch always carries the acting actor and a reason;
 *   - a closed (`EMERGENCY_READ_ONLY_MODE` engaged) state still permits reads,
 *     so "closed" is never a fabricated default;
 *   - an overview snapshot can never claim a provider call or external write;
 *   - a resolved-configuration preview chain follows the §28.4 precedence order
 *     exactly;
 *   - a high-impact action envelope always carries idempotency and a reason;
 *   - the admin error envelope carries a correlation id and a stable code and
 *     refuses every extra field (no stack trace).
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';
import { HighImpactActionScopeSchema } from './sec.ts';

export const ADM_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const contentAddress = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const positiveInt = z.number().int().positive();
const jsonRecord = z.record(z.unknown());
const closedEnum = <T extends string>(values: readonly T[]) => z.enum([...values] as [T, ...T[]]);

// --- §28.13 kill switches ----------------------------------------------------

/** The six §28.13 global kill switches. */
export const KillSwitchKind = {
  DISABLE_ALL_AUTOMATION: 'DISABLE_ALL_AUTOMATION',
  DISABLE_ALL_MODEL_CALLS: 'DISABLE_ALL_MODEL_CALLS',
  DISABLE_ALL_PROVIDER_CALLS: 'DISABLE_ALL_PROVIDER_CALLS',
  DISABLE_NOTIFICATIONS: 'DISABLE_NOTIFICATIONS',
  REVOKE_ALL_MCP_CLIENTS: 'REVOKE_ALL_MCP_CLIENTS',
  EMERGENCY_READ_ONLY_MODE: 'EMERGENCY_READ_ONLY_MODE',
} as const;
export type KillSwitchKind = (typeof KillSwitchKind)[keyof typeof KillSwitchKind];
export const ALL_KILL_SWITCH_KINDS: readonly KillSwitchKind[] = Object.values(KillSwitchKind);
export const KillSwitchKindSchema = closedEnum(ALL_KILL_SWITCH_KINDS);

/** Switch state. A missing/unreadable/expired/unknown state resolves ENGAGED. */
export const KillSwitchState = {
  ENGAGED: 'ENGAGED',
  DISENGAGED: 'DISENGAGED',
} as const;
export type KillSwitchState = (typeof KillSwitchState)[keyof typeof KillSwitchState];
export const ALL_KILL_SWITCH_STATES: readonly KillSwitchState[] = Object.values(KillSwitchState);
export const KillSwitchStateSchema = closedEnum(ALL_KILL_SWITCH_STATES);

/** Where a switch applies. The global §28.13 controls are `GLOBAL`. */
export const KillSwitchScopeKind = {
  GLOBAL: 'GLOBAL',
  WORKSPACE: 'WORKSPACE',
  TENANT: 'TENANT',
} as const;
export type KillSwitchScopeKind = (typeof KillSwitchScopeKind)[keyof typeof KillSwitchScopeKind];
export const ALL_KILL_SWITCH_SCOPE_KINDS: readonly KillSwitchScopeKind[] =
  Object.values(KillSwitchScopeKind);
export const KillSwitchScopeKindSchema = closedEnum(ALL_KILL_SWITCH_SCOPE_KINDS);

// --- §28.3 configuration lifecycle ------------------------------------------

export const ConfigLifecycleState = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  APPROVED: 'APPROVED',
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  ROLLED_BACK: 'ROLLED_BACK',
} as const;
export type ConfigLifecycleState = (typeof ConfigLifecycleState)[keyof typeof ConfigLifecycleState];
export const ALL_CONFIG_LIFECYCLE_STATES: readonly ConfigLifecycleState[] =
  Object.values(ConfigLifecycleState);
export const ConfigLifecycleStateSchema = closedEnum(ALL_CONFIG_LIFECYCLE_STATES);

/** Configuration kinds governed by the immutable-version lifecycle (§28.3). */
export const ConfigKind = {
  PROMPT: 'PROMPT',
  AGENT_PROFILE: 'AGENT_PROFILE',
  MODEL_PROFILE: 'MODEL_PROFILE',
  TOOL_PROFILE: 'TOOL_PROFILE',
  WORKFLOW: 'WORKFLOW',
  FEATURE_DEFINITION: 'FEATURE_DEFINITION',
  RANKING_POLICY: 'RANKING_POLICY',
  OUTCOME_PROFILE: 'OUTCOME_PROFILE',
  ALERT_POLICY: 'ALERT_POLICY',
  SCHEDULE: 'SCHEDULE',
} as const;
export type ConfigKind = (typeof ConfigKind)[keyof typeof ConfigKind];
export const ALL_CONFIG_KINDS: readonly ConfigKind[] = Object.values(ConfigKind);
export const ConfigKindSchema = closedEnum(ALL_CONFIG_KINDS);

// --- §25.11 schedule/configuration control actions ---------------------------

/** The twelve §25.11 admin actions (configuration changes create a version). */
export const AdminControlAction = {
  CREATE: 'CREATE',
  EDIT_DRAFT: 'EDIT_DRAFT',
  VALIDATE: 'VALIDATE',
  FORECAST: 'FORECAST',
  ENABLE: 'ENABLE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  RUN_NOW: 'RUN_NOW',
  DRY_RUN: 'DRY_RUN',
  DUPLICATE: 'DUPLICATE',
  DISABLE: 'DISABLE',
  DELETE: 'DELETE',
} as const;
export type AdminControlAction = (typeof AdminControlAction)[keyof typeof AdminControlAction];
export const ALL_ADMIN_CONTROL_ACTIONS: readonly AdminControlAction[] =
  Object.values(AdminControlAction);
export const AdminControlActionSchema = closedEnum(ALL_ADMIN_CONTROL_ACTIONS);

/**
 * The audited action kinds persisted to `adm.admin_action_audit` (plan data
 * model) — the §25.11 actions expressed with their effect domain, plus the two
 * kill-switch transitions. Successful and refused actions are recorded alike.
 */
export const AdminActionAuditKind = {
  CONFIG_VALIDATE: 'CONFIG_VALIDATE',
  CONFIG_ACTIVATE: 'CONFIG_ACTIVATE',
  CONFIG_ROLLBACK: 'CONFIG_ROLLBACK',
  SCHEDULE_ENABLE: 'SCHEDULE_ENABLE',
  SCHEDULE_PAUSE: 'SCHEDULE_PAUSE',
  SCHEDULE_RESUME: 'SCHEDULE_RESUME',
  SCHEDULE_RUN_NOW: 'SCHEDULE_RUN_NOW',
  SCHEDULE_DRY_RUN: 'SCHEDULE_DRY_RUN',
  SCHEDULE_DISABLE: 'SCHEDULE_DISABLE',
  SCHEDULE_DELETE: 'SCHEDULE_DELETE',
  KILL_SWITCH_ENGAGE: 'KILL_SWITCH_ENGAGE',
  KILL_SWITCH_DISENGAGE: 'KILL_SWITCH_DISENGAGE',
} as const;
export type AdminActionAuditKind = (typeof AdminActionAuditKind)[keyof typeof AdminActionAuditKind];
export const ALL_ADMIN_ACTION_AUDIT_KINDS: readonly AdminActionAuditKind[] =
  Object.values(AdminActionAuditKind);
export const AdminActionAuditKindSchema = closedEnum(ALL_ADMIN_ACTION_AUDIT_KINDS);

/** Audit outcome; a refusal always names one stable machine code. */
export const AdminActionOutcome = {
  ALLOWED: 'ALLOWED',
  REFUSED: 'REFUSED',
} as const;
export type AdminActionOutcome = (typeof AdminActionOutcome)[keyof typeof AdminActionOutcome];
export const ALL_ADMIN_ACTION_OUTCOMES: readonly AdminActionOutcome[] =
  Object.values(AdminActionOutcome);
export const AdminActionOutcomeSchema = closedEnum(ALL_ADMIN_ACTION_OUTCOMES);

/** The `admin:high:*` scope a control action requires (Appendix B). */
export const ADMIN_CONTROL_ACTION_SCOPE: Readonly<Record<AdminActionAuditKind, string>> =
  Object.freeze({
    CONFIG_VALIDATE: 'admin:high:configuration-activate',
    CONFIG_ACTIVATE: 'admin:high:configuration-activate',
    CONFIG_ROLLBACK: 'admin:high:configuration-activate',
    SCHEDULE_ENABLE: 'admin:high:configuration-activate',
    SCHEDULE_PAUSE: 'admin:high:configuration-activate',
    SCHEDULE_RESUME: 'admin:high:configuration-activate',
    SCHEDULE_RUN_NOW: 'admin:high:configuration-activate',
    SCHEDULE_DRY_RUN: 'admin:high:configuration-activate',
    SCHEDULE_DISABLE: 'admin:high:configuration-activate',
    SCHEDULE_DELETE: 'admin:high:configuration-activate',
    KILL_SWITCH_ENGAGE: 'admin:high:kill-switch',
    KILL_SWITCH_DISENGAGE: 'admin:high:kill-switch',
  });

// --- §28.2 overview read model ----------------------------------------------

/** The §28.2/§33.6 sections every overview snapshot carries. */
export const OverviewSectionKey = {
  SYSTEM_MODE: 'SYSTEM_MODE',
  KILL_SWITCH_STATE: 'KILL_SWITCH_STATE',
  PROVIDER_INCIDENTS: 'PROVIDER_INCIDENTS',
  QUOTA_EXHAUSTION_FORECAST: 'QUOTA_EXHAUSTION_FORECAST',
  ACTIVE_SCHEDULES: 'ACTIVE_SCHEDULES',
  SCHEDULE_DRIFT: 'SCHEDULE_DRIFT',
  WORKFLOW_COUNTS: 'WORKFLOW_COUNTS',
  CANDIDATE_LIFECYCLE_RISK_COUNTS: 'CANDIDATE_LIFECYCLE_RISK_COUNTS',
  ALERT_PRECISION_RECALL: 'ALERT_PRECISION_RECALL',
  MISSED_GEMS: 'MISSED_GEMS',
  FUNNEL_FAILURES: 'FUNNEL_FAILURES',
  MODEL_PROVIDER_COST: 'MODEL_PROVIDER_COST',
  STORAGE_GROWTH: 'STORAGE_GROWTH',
  LATEST_BACKUP_STATUS: 'LATEST_BACKUP_STATUS',
  RECOVERY_READINESS: 'RECOVERY_READINESS',
} as const;
export type OverviewSectionKey = (typeof OverviewSectionKey)[keyof typeof OverviewSectionKey];
export const ALL_OVERVIEW_SECTION_KEYS: readonly OverviewSectionKey[] =
  Object.values(OverviewSectionKey);
export const OverviewSectionKeySchema = closedEnum(ALL_OVERVIEW_SECTION_KEYS);

/** Section freshness/quality; an unknown or refused source is rendered as such. */
export const AdminOverviewFreshness = {
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
  REFUSED: 'REFUSED',
} as const;
export type AdminOverviewFreshness =
  (typeof AdminOverviewFreshness)[keyof typeof AdminOverviewFreshness];
export const ALL_ADMIN_OVERVIEW_FRESHNESS: readonly AdminOverviewFreshness[] =
  Object.values(AdminOverviewFreshness);
export const AdminOverviewFreshnessSchema = closedEnum(ALL_ADMIN_OVERVIEW_FRESHNESS);

/** Whole-system mode rendered by the overview (§28.2). */
export const SystemMode = {
  ACTIVE: 'ACTIVE',
  SHADOW: 'SHADOW',
  DEGRADED: 'DEGRADED',
  PAUSED: 'PAUSED',
  READ_ONLY: 'READ_ONLY',
  DISABLED: 'DISABLED',
} as const;
export type SystemMode = (typeof SystemMode)[keyof typeof SystemMode];
export const ALL_SYSTEM_MODES: readonly SystemMode[] = Object.values(SystemMode);
export const SystemModeSchema = closedEnum(ALL_SYSTEM_MODES);

// --- §28.4 resolved configuration precedence ---------------------------------

/** The §28.4 precedence chain, ascending (later layers override earlier ones). */
export const ResolvedConfigPrecedence = {
  SYSTEM_DEFAULTS: 'SYSTEM_DEFAULTS',
  WORKFLOW_VERSION: 'WORKFLOW_VERSION',
  AGENT_PROFILE_VERSION: 'AGENT_PROFILE_VERSION',
  SCHEDULE_VERSION: 'SCHEDULE_VERSION',
  RUN_NOW_OVERRIDE: 'RUN_NOW_OVERRIDE',
} as const;
export type ResolvedConfigPrecedence =
  (typeof ResolvedConfigPrecedence)[keyof typeof ResolvedConfigPrecedence];
export const ALL_RESOLVED_CONFIG_PRECEDENCE: readonly ResolvedConfigPrecedence[] =
  Object.values(ResolvedConfigPrecedence);
export const ResolvedConfigPrecedenceSchema = closedEnum(ALL_RESOLVED_CONFIG_PRECEDENCE);

/** Ascending rank of each §28.4 layer; never restated by a consumer. */
export const RESOLVED_CONFIG_PRECEDENCE_RANK: Readonly<Record<ResolvedConfigPrecedence, number>> =
  Object.freeze({
    SYSTEM_DEFAULTS: 1,
    WORKFLOW_VERSION: 2,
    AGENT_PROFILE_VERSION: 3,
    SCHEDULE_VERSION: 4,
    RUN_NOW_OVERRIDE: 5,
  });

/**
 * §28.4 order law: a stored chain is a strictly ascending subsequence of the
 * canonical layering, so a reordered ("schedule before workflow") preview is
 * refused rather than silently misinterpreted.
 */
export function isOrderedPrecedenceChain(chain: readonly string[]): boolean {
  let previous = 0;
  for (const layer of chain) {
    const rank = RESOLVED_CONFIG_PRECEDENCE_RANK[layer as ResolvedConfigPrecedence];
    if (rank === undefined || rank <= previous) return false;
    previous = rank;
  }
  return chain.length > 0;
}

// --- §28.13 kill-switch rows -------------------------------------------------

/** Exact switch scope; `(switchKind, scopeHash)` identifies the open row. */
export const KillSwitchScopeSchema = z
  .object({
    scopeKind: KillSwitchScopeKindSchema,
    scopeRef: id,
  })
  .strict();

/**
 * Append-only, scope-exact kill-switch state row. The latest open row
 * (`supersededBy === null`) is authoritative; a change inserts a NEW row and
 * sets the old row's `supersededBy` exactly once. An ENGAGED row always names
 * the actor and reason that engaged it.
 */
export const KillSwitchStateRowSchema = z
  .object({
    stateRowId: id,
    switchKind: KillSwitchKindSchema,
    scope: KillSwitchScopeSchema,
    scopeHash: contentAddress,
    state: KillSwitchStateSchema,
    reason: id.nullable(),
    actorRef: id.nullable(),
    stepUpRef: id.nullable(),
    auditRef: id.nullable(),
    /** A state that expires resolves closed once `expiresAt` has passed. */
    expiresAt: UtcTimestampSchema.nullable(),
    supersededBy: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.state !== 'ENGAGED' || (row.actorRef !== null && row.reason !== null), {
    message: 'an ENGAGED kill switch requires the acting actor and a reason',
  })
  .refine((row) => row.supersededBy === null || row.supersededBy !== row.stateRowId, {
    message: 'a kill-switch state row can never supersede itself',
  });

/** Insert-only mirror of the state row; no update schema by design. */
export const KillSwitchStateInsertSchema = KillSwitchStateRowSchema;

/**
 * Immutable kill-switch event: one row per state transition, replayed
 * transitions collapse on the unique `idempotencyKey`, and a no-op transition
 * (same from/to state) is refused.
 */
export const KillSwitchEventRowSchema = z
  .object({
    eventId: id,
    switchKind: KillSwitchKindSchema,
    fromState: KillSwitchStateSchema.nullable(),
    toState: KillSwitchStateSchema,
    scope: KillSwitchScopeSchema,
    scopeHash: contentAddress,
    reason: id,
    actorRef: id,
    stepUpRef: id,
    csrfRef: id,
    idempotencyKey: id,
    auditRef: id,
    occurredAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.fromState === null || row.fromState !== row.toState, {
    message: 'a kill-switch event must change state',
  });

/** Insert-only mirror of the event row; no update schema by design. */
export const KillSwitchEventInsertSchema = KillSwitchEventRowSchema;

// --- §28.3/§28.4 configuration versions and previews -------------------------

/**
 * Immutable configuration version. `(configKind, configId, version)` is unique;
 * content and resolved-configuration hashes pin the exact bytes an active run
 * resolves. `ACTIVE` requires an approval reference, and a version can never
 * supersede or roll back to itself.
 */
export const ConfigVersionRowSchema = z
  .object({
    configVersionId: id,
    configKind: ConfigKindSchema,
    configId: id,
    version: positiveInt,
    ownerVersionRef: id.nullable(),
    configHash: contentAddress,
    lifecycleState: ConfigLifecycleStateSchema,
    resolvedConfig: jsonRecord,
    resolvedConfigHash: contentAddress,
    supersededBy: id.nullable(),
    rolledBackFrom: id.nullable(),
    approvedByRef: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.lifecycleState !== 'ACTIVE' || row.approvedByRef !== null, {
    message: 'an ACTIVE configuration version requires an approval reference',
  })
  .refine((row) => row.supersededBy === null || row.supersededBy !== row.configVersionId, {
    message: 'a configuration version can never supersede itself',
  })
  .refine((row) => row.rolledBackFrom === null || row.rolledBackFrom !== row.configVersionId, {
    message: 'a configuration version can never roll back to itself',
  });

/** Insert-only mirror of the configuration version; no update schema by design. */
export const ConfigVersionInsertSchema = ConfigVersionRowSchema;

/** Lifecycle transitions accepted by the §28.3 law (terminal states have none). */
export const CONFIG_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ConfigLifecycleState, readonly ConfigLifecycleState[]>
> = Object.freeze({
  DRAFT: ['VALIDATED'],
  VALIDATED: ['APPROVED'],
  APPROVED: ['ACTIVE', 'DEPRECATED'],
  ACTIVE: ['DEPRECATED', 'ROLLED_BACK'],
  DEPRECATED: ['ROLLED_BACK'],
  ROLLED_BACK: [],
});

/** True when `toState` is a legal §28.3 successor of `fromState`. */
export function isAllowedLifecycleTransition(
  fromState: ConfigLifecycleState,
  toState: ConfigLifecycleState,
): boolean {
  return CONFIG_LIFECYCLE_TRANSITIONS[fromState].includes(toState);
}

/**
 * Immutable resolved-configuration preview. `precedence` is the ordered §28.4
 * chain that produced `resolvedHash`; an out-of-order chain or a preview that
 * does not expire after it was computed is refused.
 */
export const ResolvedConfigPreviewRowSchema = z
  .object({
    previewId: id,
    configVersionId: id,
    precedence: z.array(ResolvedConfigPrecedenceSchema).min(1),
    resolvedConfig: jsonRecord,
    resolvedHash: contentAddress,
    computedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => isOrderedPrecedenceChain(row.precedence), {
    message: 'the resolved-configuration precedence chain must follow the §28.4 order',
  })
  .refine((row) => Date.parse(row.expiresAt) > Date.parse(row.computedAt), {
    message: 'a resolved-configuration preview must expire after it was computed',
  });

/** Insert-only mirror of the preview; no update schema by design. */
export const ResolvedConfigPreviewInsertSchema = ResolvedConfigPreviewRowSchema;

// --- §28.2 overview snapshot -------------------------------------------------

/** One read-model section with its owning package, row refs, and freshness. */
export const OverviewSectionSchema = z
  .object({
    sectionKey: OverviewSectionKeySchema,
    ownerPackage: id,
    freshness: AdminOverviewFreshnessSchema,
    rowRefs: z.array(id),
    payloadHash: contentAddress,
    computedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((section) => section.freshness !== 'FRESH' || section.rowRefs.length > 0, {
    message: 'a FRESH section must name the rows it was assembled from',
  });

/** Insert-only mirror of the section envelope; no update schema by design. */
export const OverviewSectionInsertSchema = OverviewSectionSchema;

/**
 * Immutable overview snapshot. `providerCallsTriggered` and
 * `externalWriteAttempts` are pinned literal `0` (§28.2: a dashboard refresh
 * MUST NOT trigger external provider calls), so a non-zero counter is refused
 * at validation and by SQL CHECK.
 */
export const OverviewSnapshotRowSchema = z
  .object({
    snapshotId: id,
    generatedAt: UtcTimestampSchema,
    systemMode: SystemModeSchema,
    sections: z.array(OverviewSectionSchema).min(1),
    sourceRefs: z.array(id),
    sectionHashes: z.record(contentAddress),
    readModelHash: contentAddress,
    providerCallsTriggered: z.literal(0),
    externalWriteAttempts: z.literal(0),
  })
  .strict()
  .refine(
    (row) =>
      new Set(row.sections.map((section) => section.sectionKey)).size === row.sections.length,
    { message: 'an overview snapshot names each section at most once' },
  );

/** Insert-only mirror of the snapshot; no update schema by design. */
export const OverviewSnapshotInsertSchema = OverviewSnapshotRowSchema;

// --- §35.1 high-impact action audit -----------------------------------------

/**
 * Typed admin failure codes. Values never change once released; callers and
 * telemetry branch on `code`, never on prose. They live here (not in
 * `@foresift/domain`) because that package is outside this package's
 * writeScopes; the security perimeter's `SecErrorCode` set the precedent.
 */
export const AdminErrorCode = {
  ADMIN_ACTION_REQUEST_INVALID: 'ADMIN_ACTION_REQUEST_INVALID',
  ADMIN_CONTROL_ACTION_UNKNOWN: 'ADMIN_CONTROL_ACTION_UNKNOWN',
  ADMIN_STEP_UP_MISSING: 'ADMIN_STEP_UP_MISSING',
  ADMIN_STEP_UP_STALE: 'ADMIN_STEP_UP_STALE',
  ADMIN_AUTHENTICATOR_CLASS_INSUFFICIENT: 'ADMIN_AUTHENTICATOR_CLASS_INSUFFICIENT',
  ADMIN_ACTION_SCOPE_MISMATCH: 'ADMIN_ACTION_SCOPE_MISMATCH',
  ADMIN_CSRF_INVALID: 'ADMIN_CSRF_INVALID',
  ADMIN_IDEMPOTENCY_KEY_MISSING: 'ADMIN_IDEMPOTENCY_KEY_MISSING',
  ADMIN_REASON_MISSING: 'ADMIN_REASON_MISSING',
  ADMIN_AUDIT_HEALTH_BLOCKED: 'ADMIN_AUDIT_HEALTH_BLOCKED',
  ADMIN_ACTION_REFUSED: 'ADMIN_ACTION_REFUSED',
  ADMIN_CONFIG_VERSION_UNKNOWN: 'ADMIN_CONFIG_VERSION_UNKNOWN',
  ADMIN_CONFIG_VERSION_IMMUTABLE: 'ADMIN_CONFIG_VERSION_IMMUTABLE',
  ADMIN_CONFIG_LIFECYCLE_TRANSITION_INVALID: 'ADMIN_CONFIG_LIFECYCLE_TRANSITION_INVALID',
  ADMIN_RESOLVED_PREVIEW_PRECEDENCE_INVALID: 'ADMIN_RESOLVED_PREVIEW_PRECEDENCE_INVALID',
  ADMIN_KILL_SWITCH_KIND_UNKNOWN: 'ADMIN_KILL_SWITCH_KIND_UNKNOWN',
  ADMIN_KILL_SWITCH_ENGAGED: 'ADMIN_KILL_SWITCH_ENGAGED',
  ADMIN_KILL_SWITCH_STATE_UNREADABLE: 'ADMIN_KILL_SWITCH_STATE_UNREADABLE',
  ADMIN_KILL_SWITCH_TRANSITION_INVALID: 'ADMIN_KILL_SWITCH_TRANSITION_INVALID',
  ADMIN_OVERVIEW_SECTION_UNKNOWN: 'ADMIN_OVERVIEW_SECTION_UNKNOWN',
  ADMIN_SURFACE_FAILURE: 'ADMIN_SURFACE_FAILURE',
} as const;
export type AdminErrorCode = (typeof AdminErrorCode)[keyof typeof AdminErrorCode];
export const ALL_ADMIN_ERROR_CODES: readonly AdminErrorCode[] = Object.values(AdminErrorCode);
export const AdminErrorCodeSchema = closedEnum(ALL_ADMIN_ERROR_CODES);

/**
 * The typed action envelope an authorized control action must produce: an
 * idempotency key and a non-empty reason are unconditionally required (§35.1).
 */
export const AdminControlActionRequestSchema = z
  .object({
    actionKind: AdminActionAuditKindSchema,
    targetRef: id,
    targetVersionRef: id.nullable(),
    actorRef: id,
    reason: id,
    idempotencyKey: id,
    authorizationScope: HighImpactActionScopeSchema,
    requestedAt: UtcTimestampSchema,
  })
  .strict();

/**
 * Append-only high-impact action audit row. Recorded for allowed AND refused
 * actions; a refusal always names its stable code, and an allowed action always
 * carries its idempotency key plus step-up and CSRF references.
 */
export const AdminActionAuditRowSchema = z
  .object({
    actionId: id,
    actionKind: AdminActionAuditKindSchema,
    targetRef: id,
    targetVersionRef: id.nullable(),
    actorRef: id,
    stepUpRef: id.nullable(),
    csrfRef: id.nullable(),
    idempotencyKey: id.nullable(),
    reason: id,
    outcome: AdminActionOutcomeSchema,
    refusalCode: AdminErrorCodeSchema.nullable(),
    beforeHash: contentAddress.nullable(),
    afterHash: contentAddress.nullable(),
    auditRef: id.nullable(),
    recordedAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.outcome !== 'ALLOWED' ||
      (row.idempotencyKey !== null && row.stepUpRef !== null && row.csrfRef !== null),
    { message: 'an allowed high-impact action requires idempotency, step-up, and CSRF refs' },
  )
  .refine((row) => row.outcome !== 'REFUSED' || row.refusalCode !== null, {
    message: 'a refused high-impact action must name its stable refusal code',
  });

/** Insert-only mirror of the action audit; no update schema by design. */
export const AdminActionAuditInsertSchema = AdminActionAuditRowSchema;

// --- typed admin error envelope ---------------------------------------------

/**
 * The only shape the admin surface may emit on failure: a correlation id for
 * support, one stable machine code, and a message. `.strict()` refuses an
 * accidental stack trace, secret, or provider detail.
 */
export const AdminErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: AdminErrorCodeSchema,
        message: id,
        correlationId: id,
      })
      .strict(),
  })
  .strict();

// --- registry ---------------------------------------------------------------

/**
 * Envelope registry (mirrors the `wf.ts`/`alert.ts`/`prod.ts` pattern). Names
 * are stable and map one-to-one to the telemetry catalog's data shapes.
 */
export const AdmSchemaRegistry = Object.freeze({
  KillSwitchStateRow: KillSwitchStateRowSchema,
  KillSwitchStateInsert: KillSwitchStateInsertSchema,
  KillSwitchEventRow: KillSwitchEventRowSchema,
  KillSwitchEventInsert: KillSwitchEventInsertSchema,
  ConfigVersionRow: ConfigVersionRowSchema,
  ConfigVersionInsert: ConfigVersionInsertSchema,
  ResolvedConfigPreviewRow: ResolvedConfigPreviewRowSchema,
  ResolvedConfigPreviewInsert: ResolvedConfigPreviewInsertSchema,
  OverviewSection: OverviewSectionSchema,
  OverviewSectionInsert: OverviewSectionInsertSchema,
  OverviewSnapshotRow: OverviewSnapshotRowSchema,
  OverviewSnapshotInsert: OverviewSnapshotInsertSchema,
  AdminControlActionRequest: AdminControlActionRequestSchema,
  AdminActionAuditRow: AdminActionAuditRowSchema,
  AdminActionAuditInsert: AdminActionAuditInsertSchema,
  AdminErrorEnvelope: AdminErrorEnvelopeSchema,
});

export type AdmSchemaName = keyof typeof AdmSchemaRegistry;

export function parseAdmSchema<T extends AdmSchemaName>(
  name: T,
  input: unknown,
): z.infer<(typeof AdmSchemaRegistry)[T]> {
  return AdmSchemaRegistry[name].parse(input);
}

export type KillSwitchScope = z.infer<typeof KillSwitchScopeSchema>;
export type KillSwitchStateRow = z.infer<typeof KillSwitchStateRowSchema>;
export type KillSwitchEventRow = z.infer<typeof KillSwitchEventRowSchema>;
export type ConfigVersionRow = z.infer<typeof ConfigVersionRowSchema>;
export type ResolvedConfigPreviewRow = z.infer<typeof ResolvedConfigPreviewRowSchema>;
export type OverviewSection = z.infer<typeof OverviewSectionSchema>;
export type OverviewSnapshotRow = z.infer<typeof OverviewSnapshotRowSchema>;
export type AdminControlActionRequest = z.infer<typeof AdminControlActionRequestSchema>;
export type AdminActionAuditRow = z.infer<typeof AdminActionAuditRowSchema>;
export type AdminErrorEnvelope = z.infer<typeof AdminErrorEnvelopeSchema>;
