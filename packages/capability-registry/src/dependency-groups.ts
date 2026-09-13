/**
 * §40 dependency-group build/test ordering view (T016, FR-PROD-003, AC-152;
 * plan D3).
 *
 * The authoritative G0…G7 DAG lives in the requirement manifest, not here:
 * `dependencyGroups` and `checkDependencyDagAcyclicity` come from
 * `@foresift/requirement-manifest`, and the strict §40 position law comes from
 * `@foresift/domain`. This module only exposes the ordering view and persists
 * each group's build/test status in `prod.dependency_groups`.
 *
 * §40 separation is explicit and total: group COMPLETION means
 * production-ready code (migrations, tests, observability, diagnostics,
 * runbooks, conformance, recovery) and NEVER automatic opportunity activation.
 * The persisted `activates_opportunities` flag is pinned false in SQL and the
 * value law here always reports `false`.
 *
 * Enforcement reuses `@foresift/release-conformance`'s
 * `DEPENDENCY_GATE_NOT_OPEN` premature rule (`CONFORMANCE_RULES.premature`) as
 * the single named gate: a group may not be marked COMPLETE while an earlier
 * group is still open, and the finding carries the rule name rather than a
 * second, private ordering vocabulary.
 *
 * Requirement→group mapping is NEVER re-derived: it is read from the manifest
 * and a caller-claimed mapping that disagrees refuses fail-closed.
 *
 * Strictly read-only: build ordering is implementation governance, never an
 * opportunity activation and never an execution capability.
 */
import {
  DEPENDENCY_GROUP_ORDER,
  ErrorCode,
  ForesiftError,
  assertDependencyGroupOrder,
  dependencyGroupCompletionActivatesOpportunities,
  parseDependencyGroupId,
  type DependencyGroupId,
} from '@foresift/domain';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import { CONFORMANCE_RULES, type ConformanceFinding } from '@foresift/release-conformance';
import {
  checkDependencyDagAcyclicity,
  loadRequirementManifest,
  type DependencyGroup,
  type RequirementManifest,
} from '@foresift/requirement-manifest';

/** §40 build/test status vocabulary (mirrors the SQL CHECK). */
export const DependencyGroupStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETE: 'COMPLETE',
  BLOCKED: 'BLOCKED',
} as const;
export type DependencyGroupStatus =
  (typeof DependencyGroupStatus)[keyof typeof DependencyGroupStatus];
export const ALL_DEPENDENCY_GROUP_STATUSES: readonly DependencyGroupStatus[] =
  Object.values(DependencyGroupStatus);

function parseDependencyGroupStatus(value: unknown): DependencyGroupStatus {
  if (
    typeof value === 'string' &&
    (ALL_DEPENDENCY_GROUP_STATUSES as readonly string[]).includes(value)
  ) {
    return value as DependencyGroupStatus;
  }
  throw new ForesiftError(
    ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
    'unknown dependency-group status',
    { value: typeof value === 'string' ? value : null },
  );
}

/** One group of the validated §40 ordering view. */
export interface DependencyGroupOrderEntry {
  readonly groupId: DependencyGroupId;
  readonly name: string | null;
  readonly dependsOn: readonly DependencyGroupId[];
  /** Zero-based §40 position; prerequisites always sort strictly earlier. */
  readonly position: number;
}

/** The validated §40 build/test ordering view. */
export interface DependencyGroupOrderView {
  readonly groups: readonly DependencyGroupOrderEntry[];
  readonly activatesOpportunities: false;
  readonly completionMeans: 'PRODUCTION_READY_CODE';
}

/** Validate and normalize the manifest DAG into the §40 ordering view. */
export function buildDependencyGroupOrderView(
  manifest: Pick<RequirementManifest, 'dependencyGroups'>,
): DependencyGroupOrderView {
  const manifestGroups: unknown = manifest.dependencyGroups;
  if (!Array.isArray(manifestGroups) || manifestGroups.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      'the requirement manifest declares no dependency groups',
      {},
    );
  }
  const rawGroups = manifestGroups as readonly DependencyGroup[];
  const acyclicity = checkDependencyDagAcyclicity(rawGroups);
  if (!acyclicity.isAcyclic) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_ORDER_VIOLATED,
      `dependency-group DAG contains a cycle: ${acyclicity.cycles
        .map((cycle) => cycle.join(' -> '))
        .join('; ')}`,
      { cycles: acyclicity.cycles.map((cycle) => cycle.join('->')).join('; ') },
    );
  }
  const groups = rawGroups.map((group): DependencyGroupOrderEntry => {
    const groupId = parseDependencyGroupId(group.id);
    const declared = group.dependsOn ?? group.dependencies ?? [];
    const dependsOn = [
      ...new Set(declared.map((dependency) => parseDependencyGroupId(dependency))),
    ];
    for (const dependency of dependsOn) assertDependencyGroupOrder(dependency, groupId);
    return {
      groupId,
      name: typeof group.name === 'string' && group.name.length > 0 ? group.name : null,
      dependsOn,
      position: DEPENDENCY_GROUP_ORDER.indexOf(groupId),
    };
  });
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.groupId)) {
      throw new ForesiftError(
        ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
        `duplicate dependency group ${group.groupId}`,
        { groupId: group.groupId },
      );
    }
    seen.add(group.groupId);
  }
  const ordered = [...groups].sort((a, b) => a.position - b.position);
  return {
    groups: ordered,
    activatesOpportunities: dependencyGroupCompletionActivatesOpportunities() as false,
    completionMeans: 'PRODUCTION_READY_CODE',
  };
}

/** Load the authoritative manifest and build the §40 ordering view. */
export async function loadDependencyGroupOrderView(
  manifestPath?: string,
): Promise<DependencyGroupOrderView> {
  const manifest = await loadRequirementManifest(
    manifestPath === undefined ? {} : { manifestPath },
  );
  return buildDependencyGroupOrderView(manifest);
}

// --- requirement -> group mapping (never re-derived) ------------------------

/**
 * The manifest-authoritative group for a requirement. A missing requirement or
 * an unknown group refuses; this function NEVER derives a mapping from any
 * other signal.
 */
export function requirementDependencyGroup(
  manifest: Pick<RequirementManifest, 'requirements'>,
  requirementId: string,
): DependencyGroupId {
  const requirement = manifest.requirements.find((item) => item.id === requirementId);
  if (requirement === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      `requirement ${requirementId} is not in the authoritative manifest`,
      { requirementId },
    );
  }
  return parseDependencyGroupId(requirement.dependencyGroup);
}

/**
 * Refuse a caller-claimed requirement→group mapping that disagrees with the
 * manifest: the registry consumes the mapping, it never re-derives it.
 */
export function assertManifestGroupMapping(
  manifest: Pick<RequirementManifest, 'requirements'>,
  requirementId: string,
  claimedGroup: unknown,
): DependencyGroupId {
  const authoritative = requirementDependencyGroup(manifest, requirementId);
  const claimed = parseDependencyGroupId(claimedGroup);
  if (claimed !== authoritative) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_ORDER_VIOLATED,
      `requirement ${requirementId} belongs to ${authoritative}, not the re-derived ${claimed}`,
      { requirementId, authoritative, claimed },
    );
  }
  return authoritative;
}

// --- persisted status -------------------------------------------------------

/** One persisted `prod.dependency_groups` row. */
export interface DependencyGroupStatusRow {
  readonly groupId: DependencyGroupId;
  readonly dependsOn: readonly DependencyGroupId[];
  readonly status: DependencyGroupStatus;
  readonly manifestRequirementCount: number;
  readonly evidenceRefs: readonly string[];
  readonly activatesOpportunities: false;
  readonly updatedAt: string;
}

interface RawDependencyGroupRow {
  group_id: string;
  depends_on: unknown;
  status: string;
  manifest_requirement_count: number | string;
  evidence_refs: unknown;
  activates_opportunities: boolean;
  updated_at: unknown;
}

function parseJsonArray(value: unknown, field: string): string[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      `dependency-group ${field} must be a JSON array`,
      { field },
    );
  }
  return parsed.map((entry) => String(entry));
}

function decodeStatusRow(row: RawDependencyGroupRow): DependencyGroupStatusRow {
  return {
    groupId: parseDependencyGroupId(row.group_id),
    dependsOn: parseJsonArray(row.depends_on, 'dependsOn').map((id) => parseDependencyGroupId(id)),
    status: parseDependencyGroupStatus(row.status),
    manifestRequirementCount: Number(row.manifest_requirement_count),
    evidenceRefs: parseJsonArray(row.evidence_refs, 'evidenceRefs'),
    activatesOpportunities: row.activates_opportunities as false,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** Read every persisted §40 group status, in canonical G0…G7 order. */
export async function dependencyGroupStatuses(
  engine: DatabaseEngine,
): Promise<readonly DependencyGroupStatusRow[]> {
  const result = await engine.query<RawDependencyGroupRow>(
    `SELECT group_id, depends_on, status, manifest_requirement_count, evidence_refs,
            activates_opportunities, updated_at
       FROM prod.dependency_groups`,
  );
  return result.rows
    .map(decodeStatusRow)
    .sort(
      (a, b) =>
        DEPENDENCY_GROUP_ORDER.indexOf(a.groupId) - DEPENDENCY_GROUP_ORDER.indexOf(b.groupId),
    );
}

/**
 * The `DEPENDENCY_GATE_NOT_OPEN` premature finding for a group whose
 * prerequisites are not COMPLETE, or `undefined` when the gate is open.
 */
export function dependencyGatePrematureFinding(
  entry: Pick<DependencyGroupOrderEntry, 'groupId' | 'dependsOn'>,
  statuses: ReadonlyMap<string, DependencyGroupStatus>,
): ConformanceFinding | undefined {
  const open = entry.dependsOn.filter(
    (dependency) => statuses.get(dependency) !== DependencyGroupStatus.COMPLETE,
  );
  if (open.length === 0) return undefined;
  return {
    requirementId: `dependency-group:${entry.groupId}`,
    rule: CONFORMANCE_RULES.premature,
    path: entry.groupId,
    message: `${entry.groupId} cannot be COMPLETE while ${open.join(', ')} remain open`,
  };
}

/** Refuse an out-of-order group completion with the shared premature rule. */
export async function assertDependencyGateOpen(
  engine: DatabaseEngine,
  input: { readonly groupId: unknown; readonly dependsOn: readonly unknown[] },
): Promise<void> {
  const groupId = parseDependencyGroupId(input.groupId);
  const dependsOn = input.dependsOn.map((dependency) => parseDependencyGroupId(dependency));
  const rows = await dependencyGroupStatuses(engine);
  const statuses = new Map<string, DependencyGroupStatus>(
    rows.map((row) => [row.groupId, row.status]),
  );
  const finding = dependencyGatePrematureFinding({ groupId, dependsOn }, statuses);
  if (finding !== undefined) {
    throw new ForesiftError(ErrorCode.PROD_DEPENDENCY_ORDER_VIOLATED, finding.message, {
      rule: finding.rule,
      requirementId: finding.requirementId,
      path: finding.path,
    });
  }
}

/** Upsert one group's build/test status after the premature-gate check. */
export async function upsertDependencyGroupStatus(
  engine: DatabaseEngine,
  input: {
    readonly groupId: unknown;
    readonly dependsOn: readonly unknown[];
    readonly status: unknown;
    readonly manifestRequirementCount: number;
    readonly evidenceRefs?: readonly string[];
    readonly at: string;
  },
): Promise<DependencyGroupStatusRow> {
  const groupId = parseDependencyGroupId(input.groupId);
  const dependsOn = [
    ...new Set(input.dependsOn.map((dependency) => parseDependencyGroupId(dependency))),
  ];
  for (const dependency of dependsOn) assertDependencyGroupOrder(dependency, groupId);
  const status = parseDependencyGroupStatus(input.status);
  if (!Number.isInteger(input.manifestRequirementCount) || input.manifestRequirementCount < 0) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      'manifestRequirementCount must be a non-negative integer',
      { manifestRequirementCount: input.manifestRequirementCount },
    );
  }
  const evidenceRefs = [...(input.evidenceRefs ?? [])];
  if (status === DependencyGroupStatus.COMPLETE) {
    await assertDependencyGateOpen(engine, { groupId, dependsOn });
  }
  await engine.query(
    `INSERT INTO prod.dependency_groups
       (group_id, depends_on, status, manifest_requirement_count, evidence_refs,
        activates_opportunities, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, false, $6::timestamptz)
     ON CONFLICT (group_id) DO UPDATE
       SET depends_on = EXCLUDED.depends_on,
           status = EXCLUDED.status,
           manifest_requirement_count = EXCLUDED.manifest_requirement_count,
           evidence_refs = EXCLUDED.evidence_refs,
           updated_at = EXCLUDED.updated_at`,
    [
      groupId,
      canonicalJson(dependsOn),
      status,
      input.manifestRequirementCount,
      canonicalJson(evidenceRefs),
      input.at,
    ],
  );
  const rows = await dependencyGroupStatuses(engine);
  const row = rows.find((candidate) => candidate.groupId === groupId);
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      `dependency group ${groupId} was not persisted`,
      { groupId },
    );
  }
  return row;
}
