import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RequirementManifestError, RequirementManifestErrorCode } from './errors.ts';
import {
  assertManifestShape,
  readManifestFile,
  type DependencyGroup,
  type RequirementManifest,
} from './load.ts';

export interface ValidationPaths {
  readonly manifestPath: string;
  readonly auditPath: string;
  readonly prdPath: string;
  readonly sha256sumsPath: string;
}

export interface ValidateRequirementManifestOptions extends Partial<ValidationPaths> {
  readonly manifestData?: RequirementManifest;
}

export interface ManifestValidationResult {
  readonly isValid: true;
  readonly hashes: {
    readonly manifestSha256?: string;
    readonly documentSha256?: string;
    readonly auditSha256?: string;
  };
}

export interface CountAgreement {
  readonly agreed: true;
  readonly requirements: number;
  readonly acceptanceCriteria: number;
  readonly invariants: number;
  readonly adrs: number;
}

export function computeTextSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function contentSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function refuse(
  code: RequirementManifestErrorCode,
  message: string,
  detail: Readonly<Record<string, string | number | boolean | null>> = {},
): never {
  throw new RequirementManifestError(code, message, detail);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refuse(
      RequirementManifestErrorCode.MANIFEST_SHAPE_INVALID,
      `${label} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return refuse(
      RequirementManifestErrorCode.MANIFEST_SHAPE_INVALID,
      `${label} must be an array of strings`,
    );
  }
  return value as string[];
}

function validateTextHashes(manifest: RequirementManifest): void {
  for (const item of [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
  ]) {
    if (typeof item.text !== 'string' || computeTextSha256(item.text) !== item.textSha256) {
      refuse(RequirementManifestErrorCode.TEXT_HASH_MISMATCH, `text hash mismatch for ${item.id}`, {
        id: item.id,
      });
    }
  }

  for (const adr of manifest.adrs) {
    if (
      !/^ADR-\d{3,4}$/.test(adr.id) ||
      adr.status !== 'ACCEPTED' ||
      typeof adr.title !== 'string' ||
      adr.title.trim() === '' ||
      typeof adr.decision !== 'string' ||
      adr.decision.trim() === '' ||
      !/^[0-9a-f]{64}$/.test(adr.textSha256)
    ) {
      refuse(RequirementManifestErrorCode.ADR_FORMAT_INVALID, `ADR format invalid for ${adr.id}`, {
        id: adr.id,
      });
    }
  }
}

function validateUniqueIds(manifest: RequirementManifest): void {
  const seen = new Set<string>();
  for (const item of [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
    ...manifest.adrs,
  ]) {
    if (seen.has(item.id)) {
      refuse(
        RequirementManifestErrorCode.ORPHAN_REFERENCE,
        `duplicate normative identifier ${item.id}`,
        { id: item.id },
      );
    }
    seen.add(item.id);
  }
}

function validateReferences(manifest: RequirementManifest): void {
  const requirements = new Map(manifest.requirements.map((item) => [item.id, item]));
  const criteria = new Map(manifest.acceptanceCriteria.map((item) => [item.id, item]));
  const groups = new Set(manifest.dependencyGroups.map((group) => group.id));
  const invariants = new Set(manifest.invariants.map((item) => item.id));

  for (const criterion of manifest.acceptanceCriteria) {
    const refs = requireStringArray(criterion.requirementRefs, `${criterion.id}.requirementRefs`);
    if (refs.length === 0) {
      refuse(RequirementManifestErrorCode.ORPHAN_REFERENCE, `${criterion.id} is orphaned`);
    }
    for (const requirementId of refs) {
      const requirement = requirements.get(requirementId);
      if (requirement === undefined) {
        refuse(
          RequirementManifestErrorCode.DANGLING_REFERENCE,
          `${criterion.id} references missing requirement ${requirementId}`,
          { from: criterion.id, to: requirementId },
        );
      }
      if (!requirement.acceptanceCriteria.includes(criterion.id)) {
        refuse(
          RequirementManifestErrorCode.DANGLING_REFERENCE,
          `${criterion.id} and ${requirementId} do not reference each other`,
          { from: criterion.id, to: requirementId },
        );
      }
    }
  }

  for (const requirement of manifest.requirements) {
    if (!groups.has(requirement.dependencyGroup)) {
      refuse(
        RequirementManifestErrorCode.DANGLING_REFERENCE,
        `${requirement.id} references missing dependency group ${requirement.dependencyGroup}`,
        { from: requirement.id, to: requirement.dependencyGroup },
      );
    }
    if (requirement.acceptanceCriteria.length === 0) {
      refuse(
        RequirementManifestErrorCode.ORPHAN_REFERENCE,
        `${requirement.id} has no acceptance criterion`,
      );
    }
    for (const criterionId of requirement.acceptanceCriteria) {
      const criterion = criteria.get(criterionId);
      if (criterion === undefined || !criterion.requirementRefs.includes(requirement.id)) {
        refuse(
          RequirementManifestErrorCode.DANGLING_REFERENCE,
          `${requirement.id} references missing or asymmetric criterion ${criterionId}`,
          { from: requirement.id, to: criterionId },
        );
      }
    }
    for (const ref of requirement.securityRightsCostControls ?? []) {
      if (ref.startsWith('INV-') && !invariants.has(ref)) {
        refuse(
          RequirementManifestErrorCode.DANGLING_REFERENCE,
          `${requirement.id} references missing invariant ${ref}`,
          { from: requirement.id, to: ref },
        );
      }
    }
  }
}

function validateManifestIntrinsic(manifest: RequirementManifest): void {
  assertManifestShape(manifest);
  validateUniqueIds(manifest);
  validateTextHashes(manifest);
  validateReferences(manifest);
  const dag = checkDependencyDagAcyclicity(manifest.dependencyGroups);
  if (!dag.isAcyclic) {
    refuse(
      RequirementManifestErrorCode.DEPENDENCY_CYCLE,
      `dependency-group DAG contains a cycle: ${dag.cycles.map((cycle) => cycle.join(' -> ')).join('; ')}`,
    );
  }
}

export function checkDependencyDagAcyclicity(groups: readonly DependencyGroup[]): {
  readonly isAcyclic: boolean;
  readonly cycles: readonly (readonly string[])[];
} {
  const graph = new Map(
    groups.map((group) => [group.id, group.dependsOn ?? group.dependencies ?? []] as const),
  );
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (id: string): void => {
    if (active.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    stack.pop();
    active.delete(id);
    visited.add(id);
  };

  for (const id of graph.keys()) visit(id);
  return { isAcyclic: cycles.length === 0, cycles };
}

async function readJsonObject(filePath: string, label: string): Promise<Record<string, unknown>> {
  try {
    return requireObject(JSON.parse(await readFile(filePath, 'utf8')) as unknown, label);
  } catch (error) {
    if (error instanceof RequirementManifestError) throw error;
    return refuse(
      RequirementManifestErrorCode.MANIFEST_PARSE_FAILED,
      `could not parse ${label} ${filePath}: ${String(error)}`,
      { filePath },
    );
  }
}

function countsOf(manifest: RequirementManifest): Record<string, number> {
  return {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
  };
}

function numericField(object: Record<string, unknown>, key: string, label: string): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return refuse(
      RequirementManifestErrorCode.MANIFEST_SHAPE_INVALID,
      `${label}.${key} must be a non-negative integer`,
    );
  }
  return value;
}

export function verifyFourWayCountAgreement(options: {
  readonly manifestData: RequirementManifest;
  readonly auditPath: string;
}): Promise<CountAgreement>;
export function verifyFourWayCountAgreement(options: {
  readonly manifestPath: string;
  readonly auditPath: string;
}): Promise<CountAgreement>;
export async function verifyFourWayCountAgreement(options: {
  readonly manifestData?: RequirementManifest;
  readonly manifestPath?: string;
  readonly auditPath: string;
}): Promise<CountAgreement> {
  const manifest = options.manifestData ?? (await readManifestFile(options.manifestPath ?? ''));
  const audit = await readJsonObject(options.auditPath, 'audit artifact');
  const inventory = requireObject(audit.inventory, 'audit.inventory');
  const auditManifest = requireObject(audit.manifest, 'audit.manifest');
  const release = requireObject(manifest.releaseConformance, 'manifest.releaseConformance');
  const sources = [
    countsOf(manifest),
    {
      requirements: numericField(inventory, 'functionalRequirements', 'audit.inventory'),
      acceptanceCriteria: numericField(inventory, 'acceptanceCriteria', 'audit.inventory'),
      invariants: numericField(inventory, 'architectureInvariants', 'audit.inventory'),
      adrs: numericField(inventory, 'acceptedADRs', 'audit.inventory'),
    },
    {
      requirements: numericField(auditManifest, 'requirements', 'audit.manifest'),
      acceptanceCriteria: numericField(auditManifest, 'acceptanceCriteria', 'audit.manifest'),
      invariants: numericField(auditManifest, 'invariants', 'audit.manifest'),
      adrs: numericField(auditManifest, 'adrs', 'audit.manifest'),
    },
    {
      requirements: numericField(release, 'requirementCount', 'manifest.releaseConformance'),
      acceptanceCriteria: numericField(
        release,
        'acceptanceCriteriaCount',
        'manifest.releaseConformance',
      ),
      invariants: numericField(release, 'invariantCount', 'manifest.releaseConformance'),
      adrs: numericField(release, 'adrCount', 'manifest.releaseConformance'),
    },
  ];
  const expected = sources[0]!;
  for (const source of sources.slice(1)) {
    for (const key of Object.keys(expected)) {
      if (source[key] !== expected[key]) {
        refuse(
          RequirementManifestErrorCode.COUNT_MISMATCH,
          `four-way count disagreement for ${key}: ${expected[key]} versus ${source[key]}`,
          { key, expected: expected[key]!, actual: source[key]! },
        );
      }
    }
  }
  return {
    agreed: true,
    requirements: expected.requirements!,
    acceptanceCriteria: expected.acceptanceCriteria!,
    invariants: expected.invariants!,
    adrs: expected.adrs!,
  };
}

async function validateAnchors(manifest: RequirementManifest, prdPath: string): Promise<void> {
  const lines = (await readFile(prdPath, 'utf8')).split(/\r?\n/);
  for (const item of [
    ...manifest.requirements,
    ...manifest.acceptanceCriteria,
    ...manifest.invariants,
    ...manifest.adrs,
  ]) {
    if (
      !Number.isInteger(item.line) ||
      item.line <= 0 ||
      !lines[item.line - 1]?.includes(item.id)
    ) {
      refuse(
        RequirementManifestErrorCode.ANCHOR_UNRESOLVED,
        `PRD line anchor ${item.line} does not resolve to ${item.id}`,
        { id: item.id, line: item.line },
      );
    }
  }
}

async function verifyChecksums(
  options: Required<
    Pick<ValidationPaths, 'manifestPath' | 'auditPath' | 'prdPath' | 'sha256sumsPath'>
  >,
): Promise<ManifestValidationResult['hashes']> {
  const sums = new Map<string, string>();
  for (const line of (await readFile(options.sha256sumsPath, 'utf8')).split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match !== null) sums.set(match[2]!, match[1]!);
  }
  const artifacts = [
    ['manifestSha256', options.manifestPath],
    ['documentSha256', options.prdPath],
    ['auditSha256', options.auditPath],
  ] as const;
  const hashes: Record<string, string> = {};
  for (const [label, filePath] of artifacts) {
    const actual = contentSha256(await readFile(filePath));
    const expected = sums.get(path.basename(filePath));
    if (expected === undefined || expected !== actual) {
      refuse(
        RequirementManifestErrorCode.CHECKSUM_MISMATCH,
        `SHA256SUMS disagreement for ${path.basename(filePath)}`,
        { filePath, expected: expected ?? null, actual },
      );
    }
    hashes[label] = actual;
  }
  return hashes;
}

function validateWithData(manifest: RequirementManifest): ManifestValidationResult {
  validateManifestIntrinsic(manifest);
  return { isValid: true, hashes: {} };
}

async function validateWithArtifacts(
  options: ValidateRequirementManifestOptions,
): Promise<ManifestValidationResult> {
  const manifest = options.manifestData ?? (await readManifestFile(options.manifestPath ?? ''));
  validateManifestIntrinsic(manifest);
  if (options.auditPath !== undefined) {
    await verifyFourWayCountAgreement({ manifestData: manifest, auditPath: options.auditPath });
  }
  if (options.prdPath !== undefined) await validateAnchors(manifest, options.prdPath);
  let hashes: ManifestValidationResult['hashes'] = {};
  if (
    options.manifestPath !== undefined &&
    options.auditPath !== undefined &&
    options.prdPath !== undefined &&
    options.sha256sumsPath !== undefined
  ) {
    hashes = await verifyChecksums({
      manifestPath: options.manifestPath,
      auditPath: options.auditPath,
      prdPath: options.prdPath,
      sha256sumsPath: options.sha256sumsPath,
    });
  }
  return { isValid: true, hashes };
}

export function validateRequirementManifest(options: {
  readonly manifestData: RequirementManifest;
}): ManifestValidationResult;
export function validateRequirementManifest(
  options: ValidateRequirementManifestOptions,
): Promise<ManifestValidationResult>;
export function validateRequirementManifest(
  options: ValidateRequirementManifestOptions,
): ManifestValidationResult | Promise<ManifestValidationResult> {
  const hasArtifactWork =
    options.manifestPath !== undefined ||
    options.auditPath !== undefined ||
    options.prdPath !== undefined ||
    options.sha256sumsPath !== undefined;
  if (options.manifestData !== undefined && !hasArtifactWork) {
    return validateWithData(options.manifestData);
  }
  return validateWithArtifacts(options);
}
