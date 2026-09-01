import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ManifestErrorCode, RequirementManifestError } from './errors.ts';
import { checkGlobalIdUniqueness, validateIdGrammar } from './ids.ts';

interface RequirementItem {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly textSha256: string;
  readonly dependencyGroup: string;
  readonly family: string;
  readonly owner: string;
  readonly status: string;
  readonly acceptanceCriteria: readonly string[];
  readonly securityRightsCostControls: readonly string[];
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

interface AcceptanceItem {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly textSha256: string;
  readonly requirementRefs: readonly string[];
}

interface InvariantItem {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly textSha256: string;
}

interface AdrItem {
  readonly id: string;
  readonly line: number;
  readonly title: string;
}

export interface DependencyGroup {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly dependencies?: readonly string[];
}

export interface RequirementManifest {
  readonly schemaVersion: string;
  readonly requirements: readonly RequirementItem[];
  readonly acceptanceCriteria: readonly AcceptanceItem[];
  readonly invariants: readonly InvariantItem[];
  readonly adrs: readonly AdrItem[];
  readonly dependencyGroups: readonly DependencyGroup[];
  readonly releaseConformance: {
    readonly requirementCount: number;
    readonly acceptanceCriteriaCount: number;
    readonly invariantCount: number;
    readonly adrCount: number;
    readonly unmappedRequirementCount?: number;
    readonly unmappedAcceptanceCount?: number;
  };
}

interface AuditArtifact {
  readonly hashes: {
    readonly documentArtifactSha256: string;
    readonly requirementManifestSha256: string;
  };
  readonly inventory: {
    readonly functionalRequirements: number;
    readonly acceptanceCriteria: number;
    readonly architectureInvariants: number;
    readonly acceptedADRs: number;
  };
  readonly manifest: {
    readonly requirements: number;
    readonly acceptanceCriteria: number;
    readonly invariants: number;
    readonly adrs: number;
  };
}

export interface ValidateRequirementManifestOptions {
  readonly manifestData?: RequirementManifest;
  readonly manifestPath?: string;
  readonly auditPath?: string;
  readonly prdPath?: string;
  readonly sha256sumsPath?: string;
}

export function computeTextSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashBytes(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function parseJsonFile<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (cause) {
    throw new RequirementManifestError(
      ManifestErrorCode.MANIFEST_PARSE_FAILED,
      `could not read or parse ${file}: ${String(cause)}`,
      { path: file },
    );
  }
}

function requireManifest(options: ValidateRequirementManifestOptions): RequirementManifest {
  if (options.manifestData) return options.manifestData;
  if (!options.manifestPath) {
    throw new RequirementManifestError(
      ManifestErrorCode.MANIFEST_PARSE_FAILED,
      'manifestData or manifestPath is required',
    );
  }
  return parseJsonFile<RequirementManifest>(options.manifestPath);
}

function assertIdsAndHashes(manifest: RequirementManifest): void {
  const uniqueness = checkGlobalIdUniqueness(manifest);
  if (!uniqueness.isUnique) {
    throw new RequirementManifestError(
      ManifestErrorCode.DUPLICATE_ID,
      `globally duplicated normative IDs: ${uniqueness.duplicates.join(', ')}`,
    );
  }
  for (const item of [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
    ...manifest.adrs,
  ]) {
    if (!validateIdGrammar(item.id).valid) {
      throw new RequirementManifestError(
        ManifestErrorCode.ID_GRAMMAR_INVALID,
        `invalid normative ID ${item.id}`,
        { id: item.id },
      );
    }
  }
  for (const item of [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
  ]) {
    if (computeTextSha256(item.text) !== item.textSha256) {
      throw new RequirementManifestError(
        ManifestErrorCode.TEXT_HASH_MISMATCH,
        `text hash mismatch for ${item.id}`,
        { id: item.id },
      );
    }
  }
}

function assertReferenceIntegrity(manifest: RequirementManifest): void {
  const frById = new Map(manifest.requirements.map((item) => [item.id, item]));
  const acById = new Map(manifest.acceptanceCriteria.map((item) => [item.id, item]));
  const invIds = new Set(manifest.invariants.map((item) => item.id));
  const groupIds = new Set(manifest.dependencyGroups.map((item) => item.id));

  for (const ac of manifest.acceptanceCriteria) {
    if (ac.requirementRefs.length === 0) refuseOrphan(ac.id, 'acceptance criterion has no FR');
    for (const frRef of ac.requirementRefs) {
      const fr = frById.get(frRef);
      if (!fr) refuseDangling(ac.id, frRef);
      if (!fr.acceptanceCriteria.includes(ac.id)) refuseDangling(frRef, ac.id, 'reverse');
    }
  }
  for (const fr of manifest.requirements) {
    if (!groupIds.has(fr.dependencyGroup)) refuseDangling(fr.id, fr.dependencyGroup);
    if (fr.acceptanceCriteria.length === 0) refuseOrphan(fr.id, 'requirement has no AC');
    for (const acRef of fr.acceptanceCriteria) {
      const ac = acById.get(acRef);
      if (!ac) refuseDangling(fr.id, acRef);
      if (!ac.requirementRefs.includes(fr.id)) refuseDangling(acRef, fr.id, 'reverse');
    }
    for (const ref of fr.securityRightsCostControls) {
      if (ref.startsWith('INV-') && !invIds.has(ref)) refuseDangling(fr.id, ref);
    }
    const mappings = [
      fr.implementationRefs,
      fr.schemaRefs,
      fr.persistenceRefs,
      fr.apiToolUiRefs,
      fr.telemetryRefs,
      fr.fixtureRefs,
      fr.testRefs,
      fr.activationGateRefs,
      fr.rollbackRefs,
    ];
    if (mappings.some((refs) => !Array.isArray(refs) || refs.length === 0)) {
      refuseOrphan(fr.id, 'requirement has an empty release mapping');
    }
  }
}

function refuseDangling(owner: string, ref: string, direction = 'forward'): never {
  throw new RequirementManifestError(
    ManifestErrorCode.DANGLING_REFERENCE,
    `reference integrity failure: ${owner} has missing ${direction} reference ${ref}`,
    { owner, ref },
  );
}

function refuseOrphan(id: string, reason: string): never {
  throw new RequirementManifestError(
    ManifestErrorCode.ORPHAN_NORMATIVE_ITEM,
    `${id} is orphaned: ${reason}`,
    { id },
  );
}

function assertAnchors(manifest: RequirementManifest, prdPath: string): void {
  const lines = readFileSync(prdPath, 'utf8').split(/\r?\n/);
  for (const item of [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
    ...manifest.adrs,
  ]) {
    if (!Number.isInteger(item.line) || item.line < 1 || !lines[item.line - 1]?.includes(item.id)) {
      throw new RequirementManifestError(
        ManifestErrorCode.ANCHOR_UNRESOLVED,
        `PRD line anchor for ${item.id} does not resolve to a line containing that ID`,
        { id: item.id, line: item.line },
      );
    }
  }
}

export function checkDependencyDagAcyclicity(groups: readonly DependencyGroup[]): {
  readonly isAcyclic: boolean;
  readonly cycles: readonly string[][];
} {
  const edges = new Map(groups.map((g) => [g.id, [...(g.dependsOn ?? g.dependencies ?? [])]]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const walk = (id: string): void => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of edges.get(id) ?? []) walk(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) walk(id);
  return { isAcyclic: cycles.length === 0, cycles };
}

export function verifyFourWayCountAgreement(options: {
  readonly manifestData?: RequirementManifest;
  readonly manifestPath?: string;
  readonly auditPath: string;
}): {
  readonly agreed: boolean;
  readonly requirements: number;
  readonly acceptanceCriteria: number;
  readonly invariants: number;
  readonly adrs: number;
} {
  const manifest = requireManifest(options);
  const audit = parseJsonFile<AuditArtifact>(options.auditPath);
  const sources = {
    requirements: [
      manifest.requirements.length,
      audit.inventory.functionalRequirements,
      audit.manifest.requirements,
      manifest.releaseConformance.requirementCount,
    ],
    acceptanceCriteria: [
      manifest.acceptanceCriteria.length,
      audit.inventory.acceptanceCriteria,
      audit.manifest.acceptanceCriteria,
      manifest.releaseConformance.acceptanceCriteriaCount,
    ],
    invariants: [
      manifest.invariants.length,
      audit.inventory.architectureInvariants,
      audit.manifest.invariants,
      manifest.releaseConformance.invariantCount,
    ],
    adrs: [
      manifest.adrs.length,
      audit.inventory.acceptedADRs,
      audit.manifest.adrs,
      manifest.releaseConformance.adrCount,
    ],
  };
  const disagreements = Object.entries(sources).filter(([, values]) => new Set(values).size !== 1);
  if (disagreements.length > 0) {
    throw new RequirementManifestError(
      ManifestErrorCode.COUNT_MISMATCH,
      `four-way count disagreement: ${disagreements.map(([name]) => name).join(', ')}`,
    );
  }
  return {
    agreed: true,
    requirements: sources.requirements[0]!,
    acceptanceCriteria: sources.acceptanceCriteria[0]!,
    invariants: sources.invariants[0]!,
    adrs: sources.adrs[0]!,
  };
}

function verifyArtifactHashes(options: ValidateRequirementManifestOptions): {
  readonly manifestSha256?: string;
  readonly documentSha256?: string;
  readonly auditSha256?: string;
} {
  if (!options.sha256sumsPath) return {};
  const sumsDir = path.dirname(options.sha256sumsPath);
  const sums = new Map(
    readFileSync(options.sha256sumsPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
        if (!match) {
          throw new RequirementManifestError(
            ManifestErrorCode.ARTIFACT_HASH_MISMATCH,
            `invalid SHA256SUMS line: ${line}`,
          );
        }
        return [match[2], match[1]] as const;
      }),
  );
  const verify = (file: string | undefined): string | undefined => {
    if (!file) return undefined;
    const actual = hashBytes(readFileSync(file));
    const relative = path.relative(sumsDir, file);
    const expected = sums.get(relative) ?? sums.get(path.basename(file));
    if (!expected || expected !== actual) {
      throw new RequirementManifestError(
        ManifestErrorCode.ARTIFACT_HASH_MISMATCH,
        `SHA256SUMS disagreement for ${file}`,
        { path: file },
      );
    }
    return actual;
  };
  const result: {
    manifestSha256?: string;
    documentSha256?: string;
    auditSha256?: string;
  } = {};
  const manifestSha256 = verify(options.manifestPath);
  const documentSha256 = verify(options.prdPath);
  const auditSha256 = verify(options.auditPath);
  if (manifestSha256) result.manifestSha256 = manifestSha256;
  if (documentSha256) result.documentSha256 = documentSha256;
  if (auditSha256) result.auditSha256 = auditSha256;
  return result;
}

export function validateRequirementManifest(options: ValidateRequirementManifestOptions): {
  readonly isValid: true;
  readonly hashes: {
    readonly manifestSha256?: string;
    readonly documentSha256?: string;
    readonly auditSha256?: string;
  };
} {
  const manifest = requireManifest(options);
  assertIdsAndHashes(manifest);
  assertReferenceIntegrity(manifest);
  const dag = checkDependencyDagAcyclicity(manifest.dependencyGroups);
  if (!dag.isAcyclic) {
    throw new RequirementManifestError(
      ManifestErrorCode.DEPENDENCY_GROUP_CYCLE,
      `dependency-group DAG contains cycle: ${dag.cycles[0]?.join(' -> ')}`,
    );
  }
  if (options.prdPath) assertAnchors(manifest, options.prdPath);
  if (options.auditPath) {
    verifyFourWayCountAgreement({
      manifestData: manifest,
      auditPath: options.auditPath,
      ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
    });
  }
  const hashes = verifyArtifactHashes(options);
  if (options.auditPath) {
    const audit = parseJsonFile<AuditArtifact>(options.auditPath);
    if (
      (hashes.manifestSha256 && audit.hashes.requirementManifestSha256 !== hashes.manifestSha256) ||
      (hashes.documentSha256 && audit.hashes.documentArtifactSha256 !== hashes.documentSha256)
    ) {
      throw new RequirementManifestError(
        ManifestErrorCode.ARTIFACT_HASH_MISMATCH,
        'audit hash inventory disagrees with validated artifacts',
      );
    }
  }
  return { isValid: true, hashes };
}
