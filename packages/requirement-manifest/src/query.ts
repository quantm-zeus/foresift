import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Requirement, RequirementManifest } from './types.ts';

export type MappingKind =
  | 'implementationRefs'
  | 'schemaRefs'
  | 'persistenceRefs'
  | 'apiToolUiRefs'
  | 'telemetryRefs'
  | 'fixtureRefs'
  | 'testRefs';

export class ManifestQuery {
  readonly manifest: RequirementManifest;
  constructor(manifest: RequirementManifest) {
    this.manifest = manifest;
  }
  byFamily(family: string): readonly Requirement[] {
    return this.manifest.requirements.filter((r) => r.family === family);
  }
  byDependencyGroup(group: string): readonly Requirement[] {
    return this.manifest.requirements.filter((r) => r.dependencyGroup === group);
  }
  byOwner(owner: string): readonly Requirement[] {
    return this.manifest.requirements.filter((r) => r.owner === owner);
  }
  byStatus(status: string): readonly Requirement[] {
    return this.manifest.requirements.filter((r) => r.status === status);
  }
  acceptanceCriteriaFor(requirementId: string) {
    return this.manifest.acceptanceCriteria.filter((ac) =>
      ac.requirementRefs.includes(requirementId),
    );
  }
  requirementsForAcceptanceCriterion(acId: string): readonly Requirement[] {
    const ac = this.manifest.acceptanceCriteria.find((item) => item.id === acId);
    const ids = new Set(ac?.requirementRefs ?? []);
    return this.manifest.requirements.filter((item) => ids.has(item.id));
  }
}

export const queryManifest = (manifest: RequirementManifest): ManifestQuery =>
  new ManifestQuery(manifest);

function globRegex(pattern: string): RegExp {
  let output = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      output += '.*';
      index += 1;
    } else if (char === '*') output += '[^/]*';
    else output += char?.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') ?? '';
  }
  return new RegExp(`${output}$`);
}

async function filesUnder(rootDir: string): Promise<readonly string[]> {
  const output: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(rootDir, relative), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else output.push(child);
    }
  };
  await walk('');
  return output.sort();
}

export function mappingRefs(requirement: Requirement, kind: MappingKind): readonly string[] {
  return requirement[kind] as readonly string[];
}

/** The one resolver used by generators and conformance. Annotation suffixes are metadata. */
export async function resolveMappings(
  requirement: Requirement,
  kind: MappingKind,
  rootDir = process.cwd(),
): Promise<readonly string[]> {
  const refs = mappingRefs(requirement, kind);
  const allFiles = await filesUnder(rootDir);
  const resolved = new Set<string>();
  for (const reference of refs) {
    const clean = reference.split(/\s+@(?:requirement|acceptance)\s+/u, 1)[0] ?? reference;
    const normalized = clean.replace(/\/$/, '/**');
    if (/[*?]/.test(normalized)) {
      const matcher = globRegex(normalized);
      for (const file of allFiles) if (matcher.test(file)) resolved.add(file);
    } else {
      try {
        const info = await stat(path.join(rootDir, normalized));
        if (info.isFile()) resolved.add(normalized);
        else if (info.isDirectory())
          for (const file of allFiles) if (file.startsWith(`${normalized}/`)) resolved.add(file);
      } catch {
        /* unresolved refs intentionally return no paths */
      }
    }
  }
  return [...resolved].sort();
}

export const resolveMapping = resolveMappings;
