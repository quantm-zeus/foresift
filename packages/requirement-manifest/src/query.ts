import type { RequirementManifest, RequirementItem } from './types.ts';
const byId = (items: readonly RequirementItem[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));
export const queryByFamily = (manifest: RequirementManifest, family: string) =>
  byId(manifest.requirements.filter((r) => r.family === family));
export const queryByDependencyGroup = (manifest: RequirementManifest, group: string) =>
  byId(manifest.requirements.filter((r) => r.dependencyGroup === group));
export const queryByOwner = (manifest: RequirementManifest, owner: string) =>
  byId(manifest.requirements.filter((r) => r.owner === owner));
export const queryByStatus = (manifest: RequirementManifest, status: string) =>
  byId(manifest.requirements.filter((r) => r.status === status));
export const queryRequirementsByAc = (manifest: RequirementManifest, acId: string) =>
  byId(manifest.requirements.filter((r) => r.acceptanceCriteria.includes(acId)));
const MAPPING_KEYS = [
  'implementationRefs',
  'schemaRefs',
  'persistenceRefs',
  'apiToolUiRefs',
  'telemetryRefs',
  'fixtureRefs',
  'testRefs',
] as const;
export function resolveMappings(manifest: RequirementManifest, requirementId: string) {
  const requirement = manifest.requirements.find((r) => r.id === requirementId);
  if (!requirement) return undefined;
  return Object.fromEntries(MAPPING_KEYS.map((key) => [key, [...(requirement[key] ?? [])]]));
}
