/** Canonical manifest queries and mapping resolver. @requirement FR-TRACE-001 */

type Requirement = {
  id: string;
  family?: string;
  dependencyGroup?: string;
  owner?: string;
  status?: string;
  acceptanceCriteria?: string[];
  implementationRefs?: string[];
  schemaRefs?: string[];
  persistenceRefs?: string[];
  apiToolUiRefs?: string[];
  telemetryRefs?: string[];
  fixtureRefs?: string[];
  testRefs?: string[];
  activationGateRefs?: string[];
  rollbackRefs?: string[];
};

type Manifest = {
  requirements: Requirement[];
  acceptanceCriteria?: { id: string; requirementRefs?: string[] }[];
};

const copyMatches = (
  manifest: Manifest,
  predicate: (item: Requirement) => boolean,
): Requirement[] => manifest.requirements.filter(predicate);

export const queryByFamily = (manifest: Manifest, family: string): Requirement[] =>
  copyMatches(manifest, (item) => item.family === family);

export const queryByDependencyGroup = (manifest: Manifest, group: string): Requirement[] =>
  copyMatches(manifest, (item) => item.dependencyGroup === group);

export const queryByOwner = (manifest: Manifest, owner: string): Requirement[] =>
  copyMatches(manifest, (item) => item.owner === owner);

export const queryByStatus = (manifest: Manifest, status: string): Requirement[] =>
  copyMatches(manifest, (item) => item.status === status);

export function queryRequirementsByAc(
  manifest: Manifest,
  acceptanceCriterionId: string,
): Requirement[] {
  const criterion = manifest.acceptanceCriteria?.find((item) => item.id === acceptanceCriterionId);
  const directRefs = new Set(criterion?.requirementRefs ?? []);
  return copyMatches(
    manifest,
    (requirement) =>
      directRefs.has(requirement.id) ||
      (requirement.acceptanceCriteria ?? []).includes(acceptanceCriterionId),
  );
}

const MAPPING_FIELDS = [
  'implementationRefs',
  'schemaRefs',
  'persistenceRefs',
  'apiToolUiRefs',
  'telemetryRefs',
  'fixtureRefs',
  'testRefs',
  'activationGateRefs',
  'rollbackRefs',
] as const;

/** The sole mapping projection consumed by generators and conformance checks. */
export function resolveMappings(manifest: Manifest, requirementId: string) {
  const requirement = manifest.requirements.find((item) => item.id === requirementId);
  if (!requirement) throw new Error(`REQUIREMENT_NOT_FOUND: ${requirementId}`);
  return Object.fromEntries(
    MAPPING_FIELDS.map((field) => [field, [...(requirement[field] ?? [])]]),
  ) as Record<(typeof MAPPING_FIELDS)[number], string[]>;
}
