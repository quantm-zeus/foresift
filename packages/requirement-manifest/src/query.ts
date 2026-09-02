/** @requirement FR-TRACE-001 @acceptance AC-265 */
import type { RequirementManifest, RequirementItem } from './load.ts';

export const MAPPING_FIELDS = [
  'implementationRefs',
  'schemaRefs',
  'persistenceRefs',
  'apiToolUiRefs',
  'telemetryRefs',
  'fixtureRefs',
] as const;

export type MappingField = (typeof MAPPING_FIELDS)[number];
export type RequirementMappings = Readonly<Record<MappingField, readonly string[]>> & {
  readonly testRefs: readonly string[];
  readonly activationGateRefs: readonly string[];
  readonly rollbackRefs: readonly string[];
};

type QueryableRequirement = RequirementItem & {
  readonly family?: string;
  readonly owner?: string;
  readonly status?: string;
  readonly implementationRefs?: readonly string[];
  readonly schemaRefs?: readonly string[];
  readonly persistenceRefs?: readonly string[];
  readonly apiToolUiRefs?: readonly string[];
  readonly telemetryRefs?: readonly string[];
  readonly fixtureRefs?: readonly string[];
  readonly testRefs?: readonly string[];
  readonly activationGateRefs?: readonly string[];
  readonly rollbackRefs?: readonly string[];
};

function requirements(
  manifest: Pick<RequirementManifest, 'requirements'>,
): readonly QueryableRequirement[] {
  return Array.isArray(manifest.requirements)
    ? (manifest.requirements as readonly QueryableRequirement[])
    : [];
}

function by(
  manifest: Pick<RequirementManifest, 'requirements'>,
  predicate: (item: QueryableRequirement) => boolean,
): QueryableRequirement[] {
  return requirements(manifest).filter(predicate);
}

function mappingValues(
  requirementId: string,
  field: keyof RequirementMappings,
  value: unknown,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new TypeError(
      `MAPPING_INVALID: ${requirementId}.${field} must contain non-empty strings`,
    );
  }
  return Object.freeze([...new Set(value as readonly string[])]);
}

export function queryByFamily(
  manifest: Pick<RequirementManifest, 'requirements'>,
  family: string,
): QueryableRequirement[] {
  return by(manifest, (item) => item.family === family);
}

export function queryByDependencyGroup(
  manifest: Pick<RequirementManifest, 'requirements'>,
  dependencyGroup: string,
): QueryableRequirement[] {
  return by(manifest, (item) => item.dependencyGroup === dependencyGroup);
}

export function queryByOwner(
  manifest: Pick<RequirementManifest, 'requirements'>,
  owner: string,
): QueryableRequirement[] {
  return by(manifest, (item) => item.owner === owner);
}

export function queryByStatus(
  manifest: Pick<RequirementManifest, 'requirements'>,
  status: string,
): QueryableRequirement[] {
  return by(manifest, (item) => item.status === status);
}

export function queryRequirementsByAc(
  manifest: Pick<RequirementManifest, 'requirements' | 'acceptanceCriteria'>,
  acceptanceCriterionId: string,
): QueryableRequirement[] {
  const criterion = manifest.acceptanceCriteria.find((item) => item.id === acceptanceCriterionId);
  const reverseRefs = new Set<string>(criterion?.requirementRefs ?? []);
  return by(
    manifest,
    (item) =>
      reverseRefs.has(item.id) || (item.acceptanceCriteria ?? []).includes(acceptanceCriterionId),
  );
}

/** The canonical mapping resolver shared by generation and conformance consumers. */
export function resolveMappings(
  manifest: Pick<RequirementManifest, 'requirements'>,
  requirementId: string,
): RequirementMappings {
  const requirement = requirements(manifest).find((item) => item.id === requirementId);
  if (!requirement) throw new Error(`REQUIREMENT_NOT_FOUND: ${requirementId}`);
  const result: Record<string, readonly string[]> = {};
  for (const field of [
    ...MAPPING_FIELDS,
    'testRefs',
    'activationGateRefs',
    'rollbackRefs',
  ] as const) {
    result[field] = mappingValues(requirement.id, field, requirement[field]);
  }
  return Object.freeze(result) as RequirementMappings;
}
