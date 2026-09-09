import { DiscError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export type PopulationConstraintKind =
  | 'COLLECTOR_GAP'
  | 'DECODER_OUTAGE'
  | 'UNVERIFIED_PROGRAM_VERSION'
  | 'PROVIDER_UNAVAILABLE'
  | 'RIGHTS_EXCLUSION'
  | 'IDENTITY_UNRESOLVED';
export type PopulationConstraintEffect = 'NARROW_CLAIM' | 'EXCLUDE_WINDOW' | 'BLOCK_CLAIM';

export interface PopulationConstraint {
  readonly constraintId: string;
  readonly manifestId: string;
  readonly kind: PopulationConstraintKind;
  readonly effect: PopulationConstraintEffect;
  readonly sourceId?: string;
  readonly collectorScopeId?: string;
  readonly programVersion?: string;
  readonly windowStart?: string;
  readonly windowEnd?: string;
  readonly windowStartSlot?: string;
  readonly windowEndSlot?: string;
  readonly evidenceRefs: readonly string[];
  readonly resolvedAt?: string;
}

export interface ConstraintResolutionPolicy {
  /** A gap at or above this width blocks the entire claim instead of excluding its window. */
  readonly blockGapAboveSlots?: number;
}

export interface ReportGateResult {
  readonly publicationAllowed: boolean;
  readonly blockingConstraintIds: readonly string[];
  readonly disclosures: readonly PopulationConstraint[];
}

interface ManifestRow {
  manifest_id: string;
  source_scope: unknown;
  collector_scope: unknown;
  window_start: string | Date;
  window_end: string | Date;
  rights_exclusions: unknown;
  program_versions: unknown;
  known_missing_sources: unknown;
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function ref(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function constraintId(manifestId: string, kind: PopulationConstraintKind, source: string): string {
  return `constraint:${manifestId}:${kind}:${encodeURIComponent(source)}`;
}

function stringMembers(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function objectMembers(value: unknown): Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Readonly<Record<string, unknown>> =>
          item !== null && !Array.isArray(item) && typeof item === 'object',
      )
    : [];
}

function isUnverifiedProgram(value: Readonly<Record<string, unknown>>): boolean {
  return (
    value.verified === false ||
    (typeof value.status === 'string' && !['VERIFIED', 'REVALIDATED'].includes(value.status))
  );
}

function programKey(value: Readonly<Record<string, unknown>>): string | undefined {
  const program = value.programId ?? value.program_id;
  const version = value.version ?? value.programVersion ?? value.program_version;
  return typeof program === 'string' && typeof version === 'string'
    ? `${program}@${version}`
    : undefined;
}

/** Read G0 truth surfaces and append a reproducible constraint projection. */
export async function resolvePopulationConstraints(
  engine: DatabaseEngine,
  manifestId: string,
  policy: ConstraintResolutionPolicy = {},
): Promise<readonly PopulationConstraint[]> {
  const manifestResult = await engine.query<ManifestRow>(
    `SELECT manifest_id,source_scope,collector_scope,window_start,window_end,
            rights_exclusions,program_versions,known_missing_sources
     FROM disc.coverage_population_manifests WHERE manifest_id=$1`,
    [manifestId],
  );
  const manifest = manifestResult.rows[0];
  if (manifest === undefined) {
    throw new DiscError(
      'population constraints require an existing manifest',
      { manifestId },
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  }
  const sourceScope = json<Record<string, unknown>>(manifest.source_scope, {});
  const collectorScope = json<Record<string, unknown>>(manifest.collector_scope, {});
  const scopeIds = stringMembers(collectorScope.scopeIds);
  const sourceIds = stringMembers(sourceScope.sourceIds);
  const startSlot = BigInt(String(collectorScope.startSlot ?? '0'));
  const endSlot = BigInt(String(collectorScope.endSlot ?? startSlot));
  const constraints: PopulationConstraint[] = [];

  const gaps = await engine.query<{
    gap_id: string;
    shard_id: string;
    gap_start_slot: string | number;
    gap_end_slot: string | number;
    recovery_status: string;
  }>(
    `SELECT gap_id,shard_id,gap_start_slot,gap_end_slot,recovery_status
     FROM collector_gaps
     WHERE gap_start_slot<=$1 AND gap_end_slot>=$2`,
    [endSlot.toString(), startSlot.toString()],
  );
  for (const gap of gaps.rows) {
    if (scopeIds.length > 0 && !scopeIds.includes(gap.shard_id)) continue;
    if (['RECOVERED', 'RESOLVED', 'CLOSED'].includes(gap.recovery_status)) continue;
    const width = BigInt(gap.gap_end_slot) - BigInt(gap.gap_start_slot) + 1n;
    const policyExceeded =
      policy.blockGapAboveSlots !== undefined && width > BigInt(policy.blockGapAboveSlots);
    const irrecoverable = ['UNRESOLVED', 'DECLARED_UNRECOVERABLE'].includes(gap.recovery_status);
    constraints.push({
      constraintId: constraintId(manifestId, 'COLLECTOR_GAP', gap.gap_id),
      manifestId,
      kind: 'COLLECTOR_GAP',
      effect: policyExceeded || irrecoverable ? 'BLOCK_CLAIM' : 'EXCLUDE_WINDOW',
      collectorScopeId: gap.shard_id,
      windowStartSlot: String(gap.gap_start_slot),
      windowEndSlot: String(gap.gap_end_slot),
      evidenceRefs: [ref('collector-gap', gap.gap_id)],
    });
  }

  const pauses = await engine.query<{
    pause_id: string;
    program_id: string;
    program_version: string;
    paused_at: string | Date;
    revalidation_state: string;
  }>(
    `SELECT pause_id,program_id,program_version,paused_at,revalidation_state
     FROM col.collector_decode_pauses
     WHERE revalidation_state<>'REVALIDATED' AND paused_at<$1`,
    [iso(manifest.window_end)],
  );
  for (const pause of pauses.rows) {
    constraints.push({
      constraintId: constraintId(manifestId, 'DECODER_OUTAGE', pause.pause_id),
      manifestId,
      kind: 'DECODER_OUTAGE',
      effect: 'EXCLUDE_WINDOW',
      programVersion: `${pause.program_id}@${pause.program_version}`,
      windowStart: iso(pause.paused_at),
      windowEnd: iso(manifest.window_end),
      evidenceRefs: [ref('decoder-pause', pause.pause_id)],
    });
  }

  for (const program of objectMembers(json(manifest.program_versions, []))) {
    const key = programKey(program);
    if (key !== undefined && isUnverifiedProgram(program)) {
      constraints.push({
        constraintId: constraintId(manifestId, 'UNVERIFIED_PROGRAM_VERSION', key),
        manifestId,
        kind: 'UNVERIFIED_PROGRAM_VERSION',
        effect: 'BLOCK_CLAIM',
        programVersion: key,
        evidenceRefs: [ref('manifest-program-version', key)],
      });
    }
  }
  for (const key of stringMembers(collectorScope.unverifiedProgramVersions)) {
    constraints.push({
      constraintId: constraintId(manifestId, 'UNVERIFIED_PROGRAM_VERSION', key),
      manifestId,
      kind: 'UNVERIFIED_PROGRAM_VERSION',
      effect: 'BLOCK_CLAIM',
      programVersion: key,
      evidenceRefs: [ref('collector-scope-unverified-program-version', key)],
    });
  }

  const operations = await engine.query<{
    provider_id: string;
    operation_id: string;
    version: string;
    health_status: string;
  }>(
    `SELECT provider_id,operation_id,version,health_status FROM prov.prov_operations
     WHERE health_status<>'HEALTHY'`,
  );
  for (const operation of operations.rows) {
    if (sourceIds.length > 0 && !sourceIds.includes(operation.provider_id)) continue;
    const key = `${operation.provider_id}/${operation.operation_id}@${operation.version}`;
    constraints.push({
      constraintId: constraintId(manifestId, 'PROVIDER_UNAVAILABLE', key),
      manifestId,
      kind: 'PROVIDER_UNAVAILABLE',
      effect: 'NARROW_CLAIM',
      sourceId: operation.provider_id,
      evidenceRefs: [ref('provider-operation', key), ref('health', operation.health_status)],
    });
  }

  for (const exclusion of stringMembers(json(manifest.rights_exclusions, []))) {
    constraints.push({
      constraintId: constraintId(manifestId, 'RIGHTS_EXCLUSION', exclusion),
      manifestId,
      kind: 'RIGHTS_EXCLUSION',
      effect: 'NARROW_CLAIM',
      sourceId: exclusion,
      evidenceRefs: [ref('rights-exclusion', exclusion)],
    });
  }
  const unresolvedIdentities = [
    ...stringMembers(sourceScope.unresolvedIdentityIds),
    ...stringMembers(collectorScope.unresolvedIdentityIds),
  ];
  for (const identity of unresolvedIdentities) {
    constraints.push({
      constraintId: constraintId(manifestId, 'IDENTITY_UNRESOLVED', identity),
      manifestId,
      kind: 'IDENTITY_UNRESOLVED',
      effect: 'NARROW_CLAIM',
      evidenceRefs: [ref('identity', identity)],
    });
  }
  for (const missingSource of stringMembers(json(manifest.known_missing_sources, []))) {
    constraints.push({
      constraintId: constraintId(manifestId, 'PROVIDER_UNAVAILABLE', missingSource),
      manifestId,
      kind: 'PROVIDER_UNAVAILABLE',
      effect: 'NARROW_CLAIM',
      sourceId: missingSource,
      evidenceRefs: [ref('known-missing-source', missingSource)],
    });
  }

  for (const item of constraints) await persistPopulationConstraint(engine, item);
  return constraints;
}

export async function persistPopulationConstraint(
  engine: DatabaseEngine,
  constraint: PopulationConstraint,
): Promise<void> {
  if (constraint.evidenceRefs.length === 0) {
    throw new DiscError(
      'population constraint requires evidence',
      {},
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  }
  await engine.query(
    `INSERT INTO disc.population_constraints (
       constraint_id,manifest_id,kind,effect,source_id,collector_scope_id,program_version,
       window_start,window_end,window_start_slot,window_end_slot,evidence_refs,resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (constraint_id) DO NOTHING`,
    [
      constraint.constraintId,
      constraint.manifestId,
      constraint.kind,
      constraint.effect,
      constraint.sourceId ?? null,
      constraint.collectorScopeId ?? null,
      constraint.programVersion ?? null,
      constraint.windowStart ?? null,
      constraint.windowEnd ?? null,
      constraint.windowStartSlot ?? null,
      constraint.windowEndSlot ?? null,
      [...constraint.evidenceRefs],
      constraint.resolvedAt ?? null,
    ],
  );
}

export function gatePopulationReport(
  constraints: readonly PopulationConstraint[],
  asOf?: string,
): ReportGateResult {
  const active = constraints.filter(
    (constraint) =>
      constraint.resolvedAt === undefined ||
      asOf === undefined ||
      Date.parse(constraint.resolvedAt) > Date.parse(asOf),
  );
  const blockingConstraintIds = active
    .filter((constraint) => constraint.effect === 'BLOCK_CLAIM')
    .map((constraint) => constraint.constraintId);
  return {
    publicationAllowed: blockingConstraintIds.length === 0,
    blockingConstraintIds,
    disclosures: active.filter((constraint) => constraint.effect !== 'BLOCK_CLAIM'),
  };
}

/** Constraint windows are removed, never recorded as negative discoveries. */
export function excludeConstrainedWindows<T>(
  observations: readonly T[],
  timestampOf: (observation: T) => string | number,
  constraints: readonly PopulationConstraint[],
): readonly T[] {
  const windows = constraints.filter(
    (constraint) =>
      constraint.effect === 'EXCLUDE_WINDOW' &&
      ((constraint.windowStart !== undefined && constraint.windowEnd !== undefined) ||
        (constraint.windowStartSlot !== undefined && constraint.windowEndSlot !== undefined)),
  );
  return observations.filter((observation) => {
    const raw = timestampOf(observation);
    const at = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    return !windows.some((constraint) => {
      const start = (constraint.windowStart ?? constraint.windowStartSlot) as string;
      const end = (constraint.windowEnd ?? constraint.windowEndSlot) as string;
      const from = /^\d+$/.test(start) ? Number(start) : Date.parse(start);
      const to = /^\d+$/.test(end) ? Number(end) : Date.parse(end);
      return at >= from && at <= to;
    });
  });
}

export class PopulationConstraintResolver {
  constructor(private readonly engine: DatabaseEngine) {}
  resolve(
    manifestId: string,
    policy?: ConstraintResolutionPolicy,
  ): Promise<readonly PopulationConstraint[]> {
    return resolvePopulationConstraints(this.engine, manifestId, policy);
  }
}

export const evaluateReportGate = gatePopulationReport;
export const filterConstraintAffectedObservations = excludeConstrainedWindows;
