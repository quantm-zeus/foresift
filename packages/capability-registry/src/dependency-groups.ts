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
import { appendSafe } from './shadow-safe.ts';
import {
  ErrorCode,
  ForesiftError,
  assertDependencyGroupOrder,
  dependencyGroupCompletionActivatesOpportunities,
  dependencyGroupIndex,
  isOneOf,
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
import { numericCopy, numericSortBy, numericSortStrings, numericUnique } from './shadow-safe.ts';

/** §40 build/test status vocabulary (mirrors the SQL CHECK). */
export const DependencyGroupStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETE: 'COMPLETE',
  BLOCKED: 'BLOCKED',
} as const;
export type DependencyGroupStatus =
  (typeof DependencyGroupStatus)[keyof typeof DependencyGroupStatus];
export const ALL_DEPENDENCY_GROUP_STATUSES: readonly DependencyGroupStatus[] = Object.freeze(
  Object.values(DependencyGroupStatus),
);

function parseDependencyGroupStatus(value: unknown): DependencyGroupStatus {
  // `isOneOf` is a numeric-index walk, never a shadowable `.includes`.
  if (typeof value === 'string' && isOneOf(value, ALL_DEPENDENCY_GROUP_STATUSES)) {
    return value;
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

/** Numeric-index cycle formatting for refusal messages; never `.map`/`.join`. */
function formatCycles(cycles: readonly (readonly string[])[], separator: string): string {
  let formatted = '';
  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
    const cycle = cycles[cycleIndex];
    if (cycle === undefined) continue;
    if (cycleIndex > 0) formatted += '; ';
    for (let stepIndex = 0; stepIndex < cycle.length; stepIndex += 1) {
      if (stepIndex > 0) formatted += separator;
      formatted += cycle[stepIndex] as string;
    }
  }
  return formatted;
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
      `dependency-group DAG contains a cycle: ${formatCycles(acyclicity.cycles, ' -> ')}`,
      { cycles: formatCycles(acyclicity.cycles, '->') },
    );
  }
  // Numeric-index construction only (audit HIGH): `.map`/`for...of`/
  // `new Set(array)`/`indexOf` are all shadowable, and a shadowed iterator left
  // `dependsOn` EMPTY — which opened the premature gate for every group.
  const groups: DependencyGroupOrderEntry[] = [];
  for (let groupIndex = 0; groupIndex < rawGroups.length; groupIndex += 1) {
    const group = rawGroups[groupIndex];
    if (group === undefined) continue;
    const groupId = parseDependencyGroupId(group.id);
    const declared = group.dependsOn ?? group.dependencies ?? [];
    const parsedDependencies: DependencyGroupId[] = [];
    for (let dependencyIndex = 0; dependencyIndex < declared.length; dependencyIndex += 1) {
      appendSafe(parsedDependencies, parseDependencyGroupId(declared[dependencyIndex]));
    }
    const dependsOn = numericUnique(parsedDependencies);
    for (let dependencyIndex = 0; dependencyIndex < dependsOn.length; dependencyIndex += 1) {
      assertDependencyGroupOrder(dependsOn[dependencyIndex], groupId);
    }
    appendSafe(groups, {
      groupId,
      name: typeof group.name === 'string' && group.name.length > 0 ? group.name : null,
      dependsOn,
      position: dependencyGroupIndex(groupId),
    });
  }
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group === undefined) continue;
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex += 1) {
      if (groups[earlierIndex]?.groupId === group.groupId) {
        throw new ForesiftError(
          ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
          `duplicate dependency group ${group.groupId}`,
          { groupId: group.groupId },
        );
      }
    }
  }
  const ordered = numericSortBy(groups, (group) => group.position);
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
  // Numeric scan only (audit HIGH): a shadowed `find` would report an
  // authoritative requirement as absent.
  let requirement: RequirementManifest['requirements'][number] | undefined;
  for (let index = 0; index < manifest.requirements.length; index += 1) {
    const candidate = manifest.requirements[index];
    if (candidate !== undefined && candidate.id === requirementId) {
      requirement = candidate;
      break;
    }
  }
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
  // Numeric-index projection only; never `parsed.map(...)`.
  const entries: string[] = [];
  for (let index = 0; index < parsed.length; index += 1) appendSafe(entries, String(parsed[index]));
  return entries;
}

function decodeStatusRow(row: RawDependencyGroupRow): DependencyGroupStatusRow {
  const dependsOn: DependencyGroupId[] = [];
  const decodedDependsOn = parseJsonArray(row.depends_on, 'dependsOn');
  for (let index = 0; index < decodedDependsOn.length; index += 1) {
    appendSafe(dependsOn, parseDependencyGroupId(decodedDependsOn[index]));
  }
  return {
    groupId: parseDependencyGroupId(row.group_id),
    dependsOn,
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
  const decoded: DependencyGroupStatusRow[] = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    if (row !== undefined) appendSafe(decoded, decodeStatusRow(row));
  }
  // Numeric-only canonical sort (audit HIGH): `indexOf`/`sort` are shadowable.
  return numericSortBy(decoded, (row) => dependencyGroupIndex(row.groupId));
}

/**
 * The `DEPENDENCY_GATE_NOT_OPEN` premature finding for a group whose
 * prerequisites are not COMPLETE, or `undefined` when the gate is open.
 */
export function dependencyGatePrematureFinding(
  entry: Pick<DependencyGroupOrderEntry, 'groupId' | 'dependsOn'>,
  statuses: ReadonlyMap<string, DependencyGroupStatus>,
): ConformanceFinding | undefined {
  // Numeric-index scan only (audit HIGH): a shadowed `filter` returning `[]`
  // would report the gate OPEN while prerequisites were still incomplete.
  const open: string[] = [];
  for (let index = 0; index < entry.dependsOn.length; index += 1) {
    const dependency = entry.dependsOn[index] as string;
    if (statuses.get(dependency) !== DependencyGroupStatus.COMPLETE) appendSafe(open, dependency);
  }
  if (open.length === 0) return undefined;
  let openList = '';
  for (let index = 0; index < open.length; index += 1) {
    if (index > 0) openList += ', ';
    openList += open[index] as string;
  }
  return {
    requirementId: `dependency-group:${entry.groupId}`,
    rule: CONFORMANCE_RULES.premature,
    path: entry.groupId,
    message: `${entry.groupId} cannot be COMPLETE while ${openList} remain open`,
  };
}

/** Refuse an out-of-order group completion with the shared premature rule. */
export async function assertDependencyGateOpen(
  engine: DatabaseEngine,
  input: { readonly groupId: unknown; readonly dependsOn: readonly unknown[] },
): Promise<void> {
  const groupId = parseDependencyGroupId(input.groupId);
  const dependsOn: DependencyGroupId[] = [];
  for (let index = 0; index < input.dependsOn.length; index += 1) {
    appendSafe(dependsOn, parseDependencyGroupId(input.dependsOn[index]));
  }
  const rows = await dependencyGroupStatuses(engine);
  // Map is built with a numeric loop, never `new Map(rows.map(...))`.
  const statuses = new Map<string, DependencyGroupStatus>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined) statuses.set(row.groupId, row.status);
  }
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
    /** The caller's claim; it must AGREE with the manifest or the write refuses. */
    readonly dependsOn: readonly unknown[];
    readonly status: unknown;
    readonly manifestRequirementCount: number;
    readonly evidenceRefs?: readonly string[];
    readonly at: string;
  },
): Promise<DependencyGroupStatusRow> {
  const groupId = parseDependencyGroupId(input.groupId);
  // Numeric parse/de-dupe/sort only (audit HIGH/H9): `[...new Set(...)]` and
  // `.sort()` are shadowable, and an empty `callerDependsOn` silently matched an
  // empty manifest set — the dangerous empty-prerequisite bypass.
  const claimedDependencies: DependencyGroupId[] = [];
  for (let index = 0; index < input.dependsOn.length; index += 1) {
    appendSafe(claimedDependencies, parseDependencyGroupId(input.dependsOn[index]));
  }
  const callerDependsOn = numericSortStrings(numericUnique(claimedDependencies));
  // The prerequisite set is NEVER taken from the caller (audit H9): it is read
  // from the authoritative manifest. A caller claiming a different set — most
  // dangerously an empty one that would let G7 complete while G0…G6 are open —
  // refuses outright.
  const orderView = await loadDependencyGroupOrderView();
  let entry: DependencyGroupOrderEntry | undefined;
  for (let index = 0; index < orderView.groups.length; index += 1) {
    const candidate = orderView.groups[index];
    if (candidate !== undefined && candidate.groupId === groupId) {
      entry = candidate;
      break;
    }
  }
  if (entry === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      `dependency group ${groupId} is not in the authoritative manifest`,
      { groupId },
    );
  }
  const dependsOn = numericCopy(entry.dependsOn);
  const manifestDependsOn = numericSortStrings(numericCopy(dependsOn));
  // Numeric comparison only (audit HIGH): `[...].sort()` and `.some()` are
  // shadowable, so the manifest-agreement check must not read them.
  let mismatch = manifestDependsOn.length !== callerDependsOn.length;
  if (!mismatch) {
    for (let index = 0; index < manifestDependsOn.length; index += 1) {
      if (manifestDependsOn[index] !== callerDependsOn[index]) {
        mismatch = true;
        break;
      }
    }
  }
  if (mismatch) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_ORDER_VIOLATED,
      `dependency group ${groupId} prerequisite claim [${callerDependsOn.join(', ')}] disagrees with the authoritative manifest [${manifestDependsOn.join(', ')}]`,
      {
        groupId,
        claimedDependsOn: callerDependsOn.join(','),
        manifestDependsOn: manifestDependsOn.join(','),
      },
    );
  }
  for (let index = 0; index < dependsOn.length; index += 1) {
    assertDependencyGroupOrder(dependsOn[index], groupId);
  }
  const status = parseDependencyGroupStatus(input.status);
  if (!Number.isInteger(input.manifestRequirementCount) || input.manifestRequirementCount < 0) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      'manifestRequirementCount must be a non-negative integer',
      { manifestRequirementCount: input.manifestRequirementCount },
    );
  }
  const evidenceRefs = numericCopy(input.evidenceRefs ?? []);
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
  // Numeric scan only (audit HIGH): a shadowed `find` would falsely report the
  // row as unpersisted.
  let row: DependencyGroupStatusRow | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const candidate = rows[index];
    if (candidate !== undefined && candidate.groupId === groupId) {
      row = candidate;
      break;
    }
  }
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
      `dependency group ${groupId} was not persisted`,
      { groupId },
    );
  }
  return row;
}
