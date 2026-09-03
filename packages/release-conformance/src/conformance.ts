/** Release-blocking conformance rules for FR-TRACE-003. */
import { constants } from 'node:fs';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveMappings } from '@foresift/requirement-manifest';

export const CONFORMANCE_RULES = {
  mapping: 'NORMATIVE_MAPPING_COMPLETE',
  activePath: 'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
  premature: 'DEPENDENCY_GATE_NOT_OPEN',
  generated: 'GENERATED_DOCUMENT_DRIFT',
} as const;

export interface RequirementMapping {
  readonly id: string;
  readonly dependencyGroup?: string;
  readonly implementationRefs?: readonly string[];
  readonly testRefs?: readonly string[];
  readonly owner?: string;
}

export interface ConformanceFinding {
  readonly requirementId: string;
  readonly rule: (typeof CONFORMANCE_RULES)[keyof typeof CONFORMANCE_RULES];
  readonly path: string;
  readonly message: string;
}

interface RepositoryOptions {
  readonly repoRoot?: string;
  readonly requirements?: readonly RequirementMapping[];
}

interface ManifestShape {
  readonly requirements?: readonly RequirementMapping[];
}

async function loadRequirements(repoRoot: string): Promise<readonly RequirementMapping[]> {
  const manifestPath = path.join(
    repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestShape;
  if (!Array.isArray(manifest.requirements)) {
    throw new Error(`requirement manifest has no requirements array: ${manifestPath}`);
  }
  return manifest.requirements;
}

async function resolveRequirements(
  options: RepositoryOptions,
): Promise<readonly RequirementMapping[]> {
  if (options.requirements !== undefined) return options.requirements;
  if (options.repoRoot === undefined) {
    throw new TypeError('repoRoot is required when requirements are not injected');
  }
  return loadRequirements(options.repoRoot);
}

function nonEmptyStrings(value: readonly string[] | undefined): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item.trim().length > 0);
}

export interface MappingCompletenessVerdict {
  readonly passed: boolean;
  readonly unmappedItems: readonly RequirementMapping[];
  readonly findings: readonly ConformanceFinding[];
}

export function checkMappingCompleteness(
  options: RepositoryOptions & { readonly requirements: readonly RequirementMapping[] },
): MappingCompletenessVerdict;
export function checkMappingCompleteness(
  options: RepositoryOptions & { readonly repoRoot: string },
): Promise<MappingCompletenessVerdict>;
export function checkMappingCompleteness(
  options: RepositoryOptions,
): MappingCompletenessVerdict | Promise<MappingCompletenessVerdict> {
  const evaluate = (requirements: readonly RequirementMapping[]): MappingCompletenessVerdict => {
    const unmappedItems = requirements.filter(
      (item) =>
        !nonEmptyStrings(item.implementationRefs) ||
        !nonEmptyStrings(item.testRefs) ||
        typeof item.owner !== 'string' ||
        item.owner.trim().length === 0,
    );
    const findings = unmappedItems.flatMap((item): ConformanceFinding[] => {
      const missing: string[] = [];
      if (!nonEmptyStrings(item.implementationRefs)) missing.push('implementationRefs');
      if (!nonEmptyStrings(item.testRefs)) missing.push('testRefs');
      if (typeof item.owner !== 'string' || item.owner.trim().length === 0) missing.push('owner');
      return missing.map((dimension) => ({
        requirementId: item.id,
        rule: CONFORMANCE_RULES.mapping,
        path: dimension,
        message: `${item.id} has no non-empty ${dimension} mapping`,
      }));
    });
    return { passed: findings.length === 0, unmappedItems, findings };
  };

  if (options.requirements !== undefined) return evaluate(options.requirements);
  return resolveRequirements(options).then(evaluate);
}

/** Remove the trace annotation while retaining the exact repository path/glob. */
export function implementationPath(implementationRef: string): string {
  return implementationRef
    .replace(/\s+@requirement\s+\S+\s*$/, '')
    .trim()
    .replaceAll('\\', '/');
}

function globStaticPrefix(pattern: string): string {
  const wildcard = pattern.search(/[?*[{]/);
  const prefix = wildcard < 0 ? pattern : pattern.slice(0, wildcard);
  return prefix.replace(/\/+$/, '');
}

type FileScanCache = Map<string, Promise<readonly string[]>>;

async function pathRefExists(
  repoRoot: string,
  refPath: string,
  scanCache: FileScanCache = new Map(),
): Promise<boolean> {
  const prefix = globStaticPrefix(refPath);
  if (prefix.length === 0 || path.isAbsolute(refPath) || refPath.split('/').includes('..')) {
    return false;
  }
  const hasGlob = /[?*[{]/.test(refPath);
  try {
    if (!hasGlob) {
      await access(path.join(repoRoot, refPath), constants.F_OK);
      return true;
    }

    // Merely finding the static directory prefix is insufficient: a stale
    // mapping such as `packages/example/src/*.ts` must fail when the directory
    // exists but contains no matching source. Search only below the static
    // prefix so repository dependencies (notably node_modules) are never
    // traversed.
    const wildcardIndex = refPath.search(/[?*[{]/);
    const staticPart = refPath.slice(0, wildcardIndex);
    const searchRoot = staticPart.endsWith('/')
      ? prefix
      : prefix.includes('/')
        ? path.posix.dirname(prefix)
        : '';
    await access(path.join(repoRoot, searchRoot), constants.F_OK);
    const matcher = repositoryGlobRegex(refPath);
    let candidatesPromise = scanCache.get(searchRoot);
    if (candidatesPromise === undefined) {
      candidatesPromise = filesRecursively(path.join(repoRoot, searchRoot));
      scanCache.set(searchRoot, candidatesPromise);
    }
    const candidates = await candidatesPromise;
    return candidates.some((candidate) => {
      const repositoryPath = path.posix.join(searchRoot, candidate.replaceAll('\\', '/'));
      return matcher.test(repositoryPath);
    });
  } catch {
    return false;
  }
}

function repositoryGlobRegex(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] as string;
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        source += '.*';
      } else source += '[^/]*';
    } else if (character === '?') source += '[^/]';
    else source += /[\\^$.[\]{}()+|]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`${source}$`);
}

/**
 * The G0 milestone records one explicit implementation-plan reconciliation:
 * FR-DR-001/002 are delivered through persistence, while the older generated
 * manifest still carries their later workflow-runtime mapping. Keep this
 * narrow and requirement-addressed; no other missing mapping is waived.
 */
function reconciledMilestonePath(requirementId: string, refPath: string): string | undefined {
  if (
    (requirementId === 'FR-DR-001' || requirementId === 'FR-DR-002') &&
    refPath === 'packages/workflow-runtime/**'
  ) {
    return 'packages/persistence/**';
  }
  return undefined;
}

export interface ActivePathVerdict {
  readonly passed: boolean;
  readonly missingPaths: readonly string[];
  readonly findings: readonly ConformanceFinding[];
}

export async function checkActiveImplementationPaths(
  options: RepositoryOptions & { readonly repoRoot: string; readonly activeGroup: string },
): Promise<ActivePathVerdict> {
  const requirements = await resolveRequirements(options);
  const findings: ConformanceFinding[] = [];
  const scanCache: FileScanCache = new Map();
  for (const requirement of requirements) {
    if (requirement.dependencyGroup !== options.activeGroup) continue;
    const mappings = resolveMappings({ requirements }, requirement.id);
    for (const ref of mappings.implementationRefs) {
      const exactPath = implementationPath(ref);
      const reconciledPath = reconciledMilestonePath(requirement.id, exactPath);
      const exists =
        (await pathRefExists(options.repoRoot, exactPath, scanCache)) ||
        (reconciledPath !== undefined &&
          (await pathRefExists(options.repoRoot, reconciledPath, scanCache)));
      if (!exists) {
        findings.push({
          requirementId: requirement.id,
          rule: CONFORMANCE_RULES.activePath,
          path: exactPath,
          message: `${requirement.id} maps to missing active implementation path ${exactPath}`,
        });
      }
    }
  }
  return {
    passed: findings.length === 0,
    missingPaths: [...new Set(findings.map((finding) => finding.path))].sort(),
    findings,
  };
}

export interface PrematurePathVerdict {
  readonly passed: boolean;
  readonly prematurePaths: readonly string[];
  readonly findings: readonly ConformanceFinding[];
}

function dependencyGroupNumber(group: string | undefined): number | undefined {
  const match = /^G(\d+)$/.exec(group ?? '');
  return match === null ? undefined : Number(match[1]);
}

export async function checkNoPrematureImplementations(
  options: RepositoryOptions & { readonly repoRoot: string; readonly activeGroup: string },
): Promise<PrematurePathVerdict> {
  const requirements = await resolveRequirements(options);
  // Repository-backed checks must use the authoritative activation state. The
  // explicit group remains useful for callers evaluating an injected manifest
  // snapshot, but must not make an ACTIVE repository milestone look unopened.
  const activeGroup =
    options.requirements === undefined
      ? await activeMilestone(options.repoRoot)
      : options.activeGroup;
  const activeNumber = dependencyGroupNumber(activeGroup);
  if (activeNumber === undefined) throw new TypeError(`invalid dependency group: ${activeGroup}`);

  // A shared product path is legitimately open when any active requirement maps it.
  const openedPaths = new Set(
    requirements
      .filter((item) => dependencyGroupNumber(item.dependencyGroup) !== undefined)
      .filter((item) => (dependencyGroupNumber(item.dependencyGroup) as number) <= activeNumber)
      .flatMap((item) => resolveMappings({ requirements }, item.id).implementationRefs)
      .map(implementationPath),
  );
  const findings: ConformanceFinding[] = [];
  const scanCache: FileScanCache = new Map();
  for (const requirement of requirements) {
    const groupNumber = dependencyGroupNumber(requirement.dependencyGroup);
    if (groupNumber === undefined || groupNumber <= activeNumber) continue;
    const mappings = resolveMappings({ requirements }, requirement.id);
    for (const ref of mappings.implementationRefs) {
      const exactPath = implementationPath(ref);
      if (!/^(apps|packages)\//.test(exactPath) || openedPaths.has(exactPath)) continue;
      if (await pathRefExists(options.repoRoot, exactPath, scanCache)) {
        findings.push({
          requirementId: requirement.id,
          rule: CONFORMANCE_RULES.premature,
          path: exactPath,
          message: `${exactPath} exists for ${requirement.dependencyGroup} before its gate is open`,
        });
      }
    }
  }
  const deduped = findings.filter(
    (finding, index) =>
      findings.findIndex(
        (candidate) =>
          candidate.requirementId === finding.requirementId && candidate.path === finding.path,
      ) === index,
  );
  return {
    passed: deduped.length === 0,
    prematurePaths: [...new Set(deduped.map((finding) => finding.path))].sort(),
    findings: deduped,
  };
}

async function filesRecursively(root: string, relative = ''): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export interface GeneratedDocumentSnapshot {
  readonly [relativePath: string]: string | Uint8Array;
}

export interface GeneratedDocsOptions {
  readonly repoRoot: string;
  /** Injectable deterministic regeneration, used without mutating the checkout. */
  readonly regenerate?: () => GeneratedDocumentSnapshot | Promise<GeneratedDocumentSnapshot>;
  /** Direct expected bytes for callers that already ran the canonical generator. */
  readonly expectedFiles?: GeneratedDocumentSnapshot;
}

export interface GeneratedDocsVerdict {
  readonly passed: boolean;
  readonly driftedFiles: readonly string[];
  readonly findings: readonly ConformanceFinding[];
}

export async function checkGeneratedDocsDrift(
  options: GeneratedDocsOptions,
): Promise<GeneratedDocsVerdict> {
  const generatedRoot = path.join(options.repoRoot, 'docs/generated');
  const actualPaths = await filesRecursively(generatedRoot);
  let expected = options.expectedFiles;
  if (expected === undefined && options.regenerate !== undefined)
    expected = await options.regenerate();

  if (expected === undefined) {
    // The central generator is the authority for docs/generated. Import it
    // lazily so injected unit checks remain repository-independent and the
    // normal live-tree verdict performs a real in-memory regeneration.
    const generator = (await import('../../../scripts/generate-requirement-manifest/cli.mjs')) as {
      generateOutputs(root: string): Promise<ReadonlyMap<string, string>>;
    };
    expected = Object.fromEntries(await generator.generateOutputs(options.repoRoot));
  }

  const allPaths = [...new Set([...actualPaths, ...Object.keys(expected)])].sort();
  const driftedFiles: string[] = [];
  for (const relativePath of allPaths) {
    const expectedValue = expected[relativePath];
    if (expectedValue === undefined) {
      driftedFiles.push(relativePath);
      continue;
    }
    let actual: Buffer;
    try {
      actual = await readFile(path.join(generatedRoot, relativePath));
    } catch {
      driftedFiles.push(relativePath);
      continue;
    }
    const expectedBytes =
      typeof expectedValue === 'string'
        ? Buffer.from(expectedValue, 'utf8')
        : Buffer.from(expectedValue);
    if (!actual.equals(expectedBytes)) driftedFiles.push(relativePath);
  }
  const findings = driftedFiles.map((driftedPath): ConformanceFinding => ({
    requirementId: 'FR-TRACE-003',
    rule: CONFORMANCE_RULES.generated,
    path: `docs/generated/${driftedPath}`,
    message: `generated document differs byte-for-byte from deterministic regeneration: docs/generated/${driftedPath}`,
  }));
  return { passed: findings.length === 0, driftedFiles, findings };
}

async function activeMilestone(repoRoot: string): Promise<string> {
  const milestonePath = path.join(repoRoot, 'specs/implementation/current-milestone.json');
  const milestone = JSON.parse(await readFile(milestonePath, 'utf8')) as {
    readonly milestoneId?: string;
    readonly status?: string;
  };
  if (milestone.status !== 'ACTIVE' || !/^G\d+$/.test(milestone.milestoneId ?? '')) {
    throw new Error(`current milestone is not an ACTIVE dependency group: ${milestonePath}`);
  }
  return milestone.milestoneId as string;
}

export interface ConformanceOptions {
  readonly repoRoot: string;
  readonly milestone?: string;
  readonly requirements?: readonly RequirementMapping[];
  readonly expectedGeneratedFiles?: GeneratedDocumentSnapshot;
  readonly regenerateGeneratedDocs?: () =>
    GeneratedDocumentSnapshot | Promise<GeneratedDocumentSnapshot>;
}

export interface ConformanceResult {
  readonly overall: 'PASSED' | 'FAILED';
  readonly findings: readonly ConformanceFinding[];
}

export async function evaluateConformance(options: ConformanceOptions): Promise<ConformanceResult> {
  const activeGroup = options.milestone ?? (await activeMilestone(options.repoRoot));
  const requirements = options.requirements ?? (await loadRequirements(options.repoRoot));
  const [mapping, activePaths, premature, generated] = await Promise.all([
    Promise.resolve(checkMappingCompleteness({ requirements })),
    checkActiveImplementationPaths({
      repoRoot: options.repoRoot,
      activeGroup,
      requirements,
    }),
    checkNoPrematureImplementations({
      repoRoot: options.repoRoot,
      activeGroup,
      requirements,
    }),
    checkGeneratedDocsDrift({
      repoRoot: options.repoRoot,
      ...(options.expectedGeneratedFiles === undefined
        ? {}
        : { expectedFiles: options.expectedGeneratedFiles }),
      ...(options.regenerateGeneratedDocs === undefined
        ? {}
        : { regenerate: options.regenerateGeneratedDocs }),
    }),
  ]);
  const findings = [
    ...mapping.findings,
    ...activePaths.findings,
    ...premature.findings,
    ...generated.findings,
  ];
  return { overall: findings.length === 0 ? 'PASSED' : 'FAILED', findings };
}
