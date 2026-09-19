import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ManifestError, ManifestErrorCode } from './errors.ts';
import { validateIds, type IdValidationOptions } from './ids.ts';
import { loadRequirementManifest } from './load.ts';
import type { LoadedManifest, RequirementManifest } from './types.ts';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export interface ValidationVerdict {
  readonly valid: true;
  readonly counts: Readonly<
    Record<'requirements' | 'acceptanceCriteria' | 'invariants' | 'adrs', number>
  >;
  readonly manifestSha256: string;
  readonly documentSha256: string;
}

function refuse(
  code: ManifestErrorCode,
  message: string,
  detail: Record<string, string | number>,
): never {
  throw new ManifestError(code, message, detail);
}

function validateReferences(manifest: RequirementManifest): void {
  const fr = new Set(manifest.requirements.map((item) => item.id));
  const ac = new Set(manifest.acceptanceCriteria.map((item) => item.id));
  const inv = new Set(manifest.invariants.map((item) => item.id));
  const groups = new Set(manifest.dependencyGroups.map((item) => item.id));
  for (const item of manifest.requirements) {
    if (!groups.has(item.dependencyGroup))
      refuse(ManifestErrorCode.REFERENCE_INVALID, `${item.id} references unknown group`, {
        id: item.id,
        target: item.dependencyGroup,
      });
    for (const target of item.acceptanceCriteria)
      if (!ac.has(target))
        refuse(ManifestErrorCode.REFERENCE_INVALID, `${item.id} references unknown AC`, {
          id: item.id,
          target,
        });
    for (const target of item.securityRightsCostControls.filter((ref) => ref.startsWith('INV-')))
      if (!inv.has(target))
        refuse(ManifestErrorCode.REFERENCE_INVALID, `${item.id} references unknown invariant`, {
          id: item.id,
          target,
        });
  }
  for (const item of manifest.acceptanceCriteria) {
    if (item.requirementRefs.length === 0)
      refuse(ManifestErrorCode.REFERENCE_INVALID, `${item.id} is orphaned`, { id: item.id });
    for (const target of item.requirementRefs)
      if (!fr.has(target))
        refuse(ManifestErrorCode.REFERENCE_INVALID, `${item.id} references unknown FR`, {
          id: item.id,
          target,
        });
  }
  for (const id of fr) {
    if (!manifest.acceptanceCriteria.some((item) => item.requirementRefs.includes(id)))
      refuse(ManifestErrorCode.REFERENCE_INVALID, `${id} has no reverse AC reference`, { id });
  }
}

function validateDag(manifest: RequirementManifest): void {
  const graph = new Map(manifest.dependencyGroups.map((group) => [group.id, group.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      refuse(ManifestErrorCode.DEPENDENCY_CYCLE, `dependency group cycle reaches ${id}`, { id });
    if (visited.has(id)) return;
    if (!graph.has(id))
      refuse(ManifestErrorCode.REFERENCE_INVALID, `unknown dependency group ${id}`, { id });
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
}

function validateCounts(loaded: LoadedManifest): ValidationVerdict['counts'] {
  const { manifest, audit } = loaded;
  const counts = {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
  };
  const sources = [
    [
      'audit.inventory',
      {
        requirements: audit.inventory.functionalRequirements,
        acceptanceCriteria: audit.inventory.acceptanceCriteria,
        invariants: audit.inventory.architectureInvariants,
        adrs: audit.inventory.acceptedADRs,
      },
    ],
    [
      'audit.manifest',
      {
        requirements: audit.manifest.requirements,
        acceptanceCriteria: audit.manifest.acceptanceCriteria,
        invariants: audit.manifest.invariants,
        adrs: audit.manifest.adrs,
      },
    ],
    [
      'releaseConformance',
      {
        requirements: manifest.releaseConformance.requirementCount,
        acceptanceCriteria: manifest.releaseConformance.acceptanceCriteriaCount,
        invariants: manifest.releaseConformance.invariantCount,
        adrs: manifest.releaseConformance.adrCount,
      },
    ],
  ] as const;
  for (const [source, candidate] of sources) {
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      if (candidate[key] !== counts[key])
        refuse(ManifestErrorCode.COUNT_MISMATCH, `${source}.${key} disagrees`, {
          source,
          key,
          expected: counts[key],
          actual: Number(candidate[key]),
        });
    }
  }
  return counts;
}

export async function validateRequirementManifest(
  input: LoadedManifest | string = process.cwd(),
  idOptions: IdValidationOptions = {},
): Promise<ValidationVerdict> {
  const loaded = typeof input === 'string' ? await loadRequirementManifest(input) : input;
  const expected = new Map(
    loaded.checksumsText
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [hash, filename] = line.trim().split(/\s+/, 2);
        return [filename, hash] as [string, string];
      }),
  );
  for (const artifactPath of [loaded.manifestPath, loaded.auditPath, loaded.documentPath]) {
    const content = await readFile(artifactPath, 'utf8');
    const filename = path.basename(artifactPath);
    if (expected.get(filename) !== sha256(content))
      refuse(ManifestErrorCode.ARTIFACT_HASH_MISMATCH, `${filename} disagrees with SHA256SUMS`, {
        path: artifactPath,
      });
  }
  const manifestHash = sha256(await readFile(loaded.manifestPath, 'utf8'));
  const documentHash = sha256(loaded.documentText);
  if (
    loaded.audit.hashes.requirementManifestSha256 !== manifestHash ||
    loaded.audit.hashes.documentArtifactSha256 !== documentHash ||
    loaded.audit.hashes.documentNormalizedSha256 !== loaded.manifest.document.normalizedSha256
  )
    refuse(ManifestErrorCode.ARTIFACT_HASH_MISMATCH, 'audit hash provenance disagrees', {
      path: loaded.auditPath,
    });

  const lines = loaded.documentText.split(/\r?\n/);
  for (const item of [
    ...loaded.manifest.requirements,
    ...loaded.manifest.acceptanceCriteria,
    ...loaded.manifest.invariants,
  ]) {
    if (sha256(item.text) !== item.textSha256)
      refuse(ManifestErrorCode.TEXT_HASH_MISMATCH, `${item.id} text hash disagrees`, {
        id: item.id,
      });
    if (!lines[item.line - 1]?.includes(item.id))
      refuse(ManifestErrorCode.ANCHOR_INVALID, `${item.id} line anchor does not resolve`, {
        id: item.id,
        line: item.line,
      });
  }
  for (const item of loaded.manifest.adrs) {
    if (
      !/^ADR-\d{3}$/.test(item.id) ||
      !/^[0-9a-f]{64}$/.test(item.textSha256) ||
      !lines[item.line - 1]?.includes(item.id)
    )
      refuse(ManifestErrorCode.ANCHOR_INVALID, `${item.id} ADR format or anchor is invalid`, {
        id: item.id,
        line: item.line,
      });
  }
  validateIds(loaded.manifest, idOptions);
  validateReferences(loaded.manifest);
  validateDag(loaded.manifest);
  return {
    valid: true,
    counts: validateCounts(loaded),
    manifestSha256: manifestHash,
    documentSha256: documentHash,
  };
}

export const validateManifest = validateRequirementManifest;
