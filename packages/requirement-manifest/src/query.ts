/** @requirement FR-TRACE-001 @acceptance AC-265 */
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

function requirements(manifest: any): readonly any[] {
  return Array.isArray(manifest?.requirements) ? manifest.requirements : [];
}

function by(manifest: any, predicate: (item: any) => boolean): any[] {
  return requirements(manifest).filter(predicate);
}

export function queryByFamily(manifest: any, family: string): any[] {
  return by(manifest, (item) => item.family === family);
}

export function queryByDependencyGroup(manifest: any, dependencyGroup: string): any[] {
  return by(manifest, (item) => item.dependencyGroup === dependencyGroup);
}

export function queryByOwner(manifest: any, owner: string): any[] {
  return by(manifest, (item) => item.owner === owner);
}

export function queryByStatus(manifest: any, status: string): any[] {
  return by(manifest, (item) => item.status === status);
}

export function queryRequirementsByAc(manifest: any, acceptanceCriterionId: string): any[] {
  const criterion = (manifest?.acceptanceCriteria ?? []).find((item: any) => item.id === acceptanceCriterionId);
  const reverseRefs = new Set<string>(criterion?.requirementRefs ?? []);
  return by(manifest, (item) =>
    reverseRefs.has(item.id) || (item.acceptanceCriteria ?? []).includes(acceptanceCriterionId),
  );
}

/** The canonical mapping resolver shared by generation and conformance consumers. */
export function resolveMappings(manifest: any, requirementId: string): RequirementMappings {
  const requirement = requirements(manifest).find((item) => item.id === requirementId);
  if (!requirement) throw new Error(`REQUIREMENT_NOT_FOUND: ${requirementId}`);
  const result: Record<string, readonly string[]> = {};
  for (const field of [...MAPPING_FIELDS, 'testRefs', 'activationGateRefs', 'rollbackRefs'] as const) {
    const values = requirement[field];
    result[field] = Array.isArray(values) ? [...values] : [];
  }
  return result as RequirementMappings;
}
