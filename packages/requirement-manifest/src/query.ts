import type { RequirementManifest } from './validate.ts';

type Requirement = RequirementManifest['requirements'][number];

export function queryByFamily(
  manifest: RequirementManifest,
  family: string,
): readonly Requirement[] {
  return manifest.requirements.filter((requirement) => requirement.family === family);
}

export function queryByDependencyGroup(
  manifest: RequirementManifest,
  dependencyGroup: string,
): readonly Requirement[] {
  return manifest.requirements.filter(
    (requirement) => requirement.dependencyGroup === dependencyGroup,
  );
}

export function queryByOwner(manifest: RequirementManifest, owner: string): readonly Requirement[] {
  return manifest.requirements.filter((requirement) => requirement.owner === owner);
}

export function queryByStatus(
  manifest: RequirementManifest,
  status: string,
): readonly Requirement[] {
  return manifest.requirements.filter((requirement) => requirement.status === status);
}

export function queryRequirementsByAc(
  manifest: RequirementManifest,
  acceptanceId: string,
): readonly Requirement[] {
  return manifest.requirements.filter((requirement) =>
    requirement.acceptanceCriteria.includes(acceptanceId),
  );
}

export function resolveMappings(
  manifest: RequirementManifest,
  requirementId: string,
):
  | {
      readonly implementationRefs: readonly string[];
      readonly schemaRefs: readonly string[];
      readonly persistenceRefs: readonly string[];
      readonly apiToolUiRefs: readonly string[];
      readonly telemetryRefs: readonly string[];
      readonly fixtureRefs: readonly string[];
      readonly testRefs: readonly string[];
      readonly activationGateRefs: readonly string[];
      readonly rollbackRefs: readonly string[];
    }
  | undefined {
  const requirement = manifest.requirements.find((item) => item.id === requirementId);
  if (!requirement) return undefined;
  return {
    implementationRefs: requirement.implementationRefs,
    schemaRefs: requirement.schemaRefs,
    persistenceRefs: requirement.persistenceRefs,
    apiToolUiRefs: requirement.apiToolUiRefs,
    telemetryRefs: requirement.telemetryRefs,
    fixtureRefs: requirement.fixtureRefs,
    testRefs: requirement.testRefs,
    activationGateRefs: requirement.activationGateRefs,
    rollbackRefs: requirement.rollbackRefs,
  };
}
