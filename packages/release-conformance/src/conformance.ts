/** Release-blocking conformance rules for FR-TRACE-003. */
import { constants } from 'node:fs';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveMappings } from '@foresift/requirement-manifest';
import { numericSortStrings, numericSortWith } from './shadow-safe.ts';

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
  // Read by the repo-backed PROD surface bridge (audit H1).
  readonly schemaRefs?: readonly string[];
  readonly persistenceRefs?: readonly string[];
  readonly telemetryRefs?: readonly string[];
  readonly fixtureRefs?: readonly string[];
  readonly apiToolUiRefs?: readonly string[];
  readonly activationGateRefs?: readonly string[];
  readonly rollbackRefs?: readonly string[];
  readonly supersededBy?: readonly string[];
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
  if (!Array.isArray(value) || value.length === 0) return false;
  // Numeric-index scan: `Array.prototype.every` is shadowable in-process, and a
  // shadowed `every` could accept an empty-string mapping (audit NEW-M5).
  for (let index = 0; index < value.length; index += 1) {
    if ((value[index] as string).trim().length === 0) return false;
  }
  return true;
}

/** Unique strings in first-seen order, then sorted (numeric dedup, NEW-M5). */
function uniqueSortedValues(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as string;
    let seen = false;
    for (let seenIndex = 0; seenIndex < unique.length; seenIndex += 1) {
      if (unique[seenIndex] === value) {
        seen = true;
        break;
      }
    }
    if (!seen) unique[unique.length] = value;
  }
  return numericSortStrings(unique);
}

/** Numeric membership: `Array.prototype.includes` is shadowable (NEW-M5). */
function containsValue(values: readonly string[], candidate: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === candidate) return true;
  }
  return false;
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
    // Numeric-index only (audit NEW-M5): a shadowed `filter`/`flatMap`/`map`
    // silently dropped the unmapped-requirement findings.
    const unmappedItems: RequirementMapping[] = [];
    for (let index = 0; index < requirements.length; index += 1) {
      const item = requirements[index] as RequirementMapping;
      if (
        !nonEmptyStrings(item.implementationRefs) ||
        !nonEmptyStrings(item.testRefs) ||
        typeof item.owner !== 'string' ||
        item.owner.trim().length === 0
      ) {
        unmappedItems[unmappedItems.length] = item;
      }
    }
    const findings: ConformanceFinding[] = [];
    for (let itemIndex = 0; itemIndex < unmappedItems.length; itemIndex += 1) {
      const item = unmappedItems[itemIndex] as RequirementMapping;
      const missing: string[] = [];
      if (!nonEmptyStrings(item.implementationRefs)) missing[missing.length] = 'implementationRefs';
      if (!nonEmptyStrings(item.testRefs)) missing[missing.length] = 'testRefs';
      if (typeof item.owner !== 'string' || item.owner.trim().length === 0) {
        missing[missing.length] = 'owner';
      }
      for (let missingIndex = 0; missingIndex < missing.length; missingIndex += 1) {
        const dimension = missing[missingIndex] as string;
        findings[findings.length] = {
          requirementId: item.id,
          rule: CONFORMANCE_RULES.mapping,
          path: dimension,
          message: `${item.id} has no non-empty ${dimension} mapping`,
        };
      }
    }
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
  // Numeric traversal check: `Array.prototype.includes` is shadowable (NEW-M5).
  const segments = refPath.split('/');
  let traverses = false;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] === '..') {
      traverses = true;
      break;
    }
  }
  if (prefix.length === 0 || path.isAbsolute(refPath) || traverses) {
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
    // Numeric scan: `Array.prototype.some` is shadowable in-process, and a
    // shadowed `true` would resolve a missing implementation path (NEW-M5).
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const repositoryPath = path.posix.join(
        searchRoot,
        (candidates[candidateIndex] as string).replaceAll('\\', '/'),
      );
      if (matcher.test(repositoryPath)) return true;
    }
    return false;
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
  // Numeric-index walks only (audit NEW-M5): a shadowed iterator walked zero
  // requirements/refs and reported every active path as present.
  for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
    const requirement = requirements[requirementIndex] as RequirementMapping;
    if (requirement.dependencyGroup !== options.activeGroup) continue;
    const mappings = resolveMappings({ requirements }, requirement.id);
    for (let refIndex = 0; refIndex < mappings.implementationRefs.length; refIndex += 1) {
      const ref = mappings.implementationRefs[refIndex] as string;
      const exactPath = implementationPath(ref);
      const reconciledPath = reconciledMilestonePath(requirement.id, exactPath);
      const exists =
        (await pathRefExists(options.repoRoot, exactPath, scanCache)) ||
        (reconciledPath !== undefined &&
          (await pathRefExists(options.repoRoot, reconciledPath, scanCache)));
      if (!exists) {
        findings[findings.length] = {
          requirementId: requirement.id,
          rule: CONFORMANCE_RULES.activePath,
          path: exactPath,
          message: `${requirement.id} maps to missing active implementation path ${exactPath}`,
        };
      }
    }
  }
  const missingPaths: string[] = [];
  for (let index = 0; index < findings.length; index += 1) {
    missingPaths[missingPaths.length] = (findings[index] as ConformanceFinding).path;
  }
  return {
    passed: findings.length === 0,
    missingPaths: uniqueSortedValues(missingPaths),
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
  // Numeric collection only (audit NEW-M5): a shadowed `filter`/`flatMap`/`map`
  // or `new Set(array)` made the opened-path set empty and flagged every mapped
  // path as premature.
  const openedPaths: string[] = [];
  for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
    const item = requirements[requirementIndex] as RequirementMapping;
    const groupNumber = dependencyGroupNumber(item.dependencyGroup);
    if (groupNumber === undefined || groupNumber > activeNumber) continue;
    const refs = resolveMappings({ requirements }, item.id).implementationRefs;
    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      openedPaths[openedPaths.length] = implementationPath(refs[refIndex] as string);
    }
  }
  const findings: ConformanceFinding[] = [];
  const scanCache: FileScanCache = new Map();
  for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
    const requirement = requirements[requirementIndex] as RequirementMapping;
    const groupNumber = dependencyGroupNumber(requirement.dependencyGroup);
    if (groupNumber === undefined || groupNumber <= activeNumber) continue;
    const mappings = resolveMappings({ requirements }, requirement.id);
    for (let refIndex = 0; refIndex < mappings.implementationRefs.length; refIndex += 1) {
      const exactPath = implementationPath(mappings.implementationRefs[refIndex] as string);
      if (!/^(apps|packages)\//.test(exactPath) || containsValue(openedPaths, exactPath)) continue;
      if (await pathRefExists(options.repoRoot, exactPath, scanCache)) {
        findings[findings.length] = {
          requirementId: requirement.id,
          rule: CONFORMANCE_RULES.premature,
          path: exactPath,
          message: `${exactPath} exists for ${requirement.dependencyGroup} before its gate is open`,
        };
      }
    }
  }
  // Numeric de-duplication (first occurrence wins), never `Array.prototype.filter`
  // with `findIndex` (both shadowable — audit NEW-M5).
  const deduped: ConformanceFinding[] = [];
  for (let index = 0; index < findings.length; index += 1) {
    const finding = findings[index] as ConformanceFinding;
    let duplicate = false;
    for (let seenIndex = 0; seenIndex < deduped.length; seenIndex += 1) {
      const candidate = deduped[seenIndex] as ConformanceFinding;
      if (candidate.requirementId === finding.requirementId && candidate.path === finding.path) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) deduped[deduped.length] = finding;
  }
  const prematurePaths: string[] = [];
  for (let index = 0; index < deduped.length; index += 1) {
    prematurePaths[prematurePaths.length] = (deduped[index] as ConformanceFinding).path;
  }
  return {
    passed: deduped.length === 0,
    prematurePaths: uniqueSortedValues(prematurePaths),
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
  // Numeric-index walk and append (audit NEW-M5): `for…of` and array spread
  // over a directory listing are shadowable in-process.
  const orderedEntries = numericSortWith(entries, (a, b) => a.name.localeCompare(b.name));
  for (let entryIndex = 0; entryIndex < orderedEntries.length; entryIndex += 1) {
    const entry = orderedEntries[entryIndex] as (typeof orderedEntries)[number];
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) {
      const nested = await filesRecursively(root, child);
      for (let nestedIndex = 0; nestedIndex < nested.length; nestedIndex += 1) {
        files[files.length] = nested[nestedIndex] as string;
      }
    } else if (entry.isFile()) {
      files[files.length] = child;
    }
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

  // Numeric union + unique + numeric walk (audit NEW-M5): `[...new Set([...])]`
  // iterates, and a shadowed iterator made the drift set empty.
  const allPaths: string[] = [];
  for (let index = 0; index < actualPaths.length; index += 1) {
    allPaths[allPaths.length] = actualPaths[index] as string;
  }
  const expectedKeys = Object.keys(expected);
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index] as string;
    if (!containsValue(allPaths, key)) allPaths[allPaths.length] = key;
  }
  const orderedPaths = numericSortStrings(allPaths);
  const driftedFiles: string[] = [];
  for (let pathIndex = 0; pathIndex < orderedPaths.length; pathIndex += 1) {
    const relativePath = orderedPaths[pathIndex] as string;
    const expectedValue = expected[relativePath];
    if (expectedValue === undefined) {
      driftedFiles[driftedFiles.length] = relativePath;
      continue;
    }
    let actual: Buffer;
    try {
      actual = await readFile(path.join(generatedRoot, relativePath));
    } catch {
      driftedFiles[driftedFiles.length] = relativePath;
      continue;
    }
    const expectedBytes =
      typeof expectedValue === 'string'
        ? Buffer.from(expectedValue, 'utf8')
        : Buffer.from(expectedValue);
    if (!actual.equals(expectedBytes)) driftedFiles[driftedFiles.length] = relativePath;
  }
  const findings: ConformanceFinding[] = [];
  for (let index = 0; index < driftedFiles.length; index += 1) {
    const driftedPath = driftedFiles[index] as string;
    findings[findings.length] = {
      requirementId: 'FR-TRACE-003',
      rule: CONFORMANCE_RULES.generated,
      path: `docs/generated/${driftedPath}`,
      message: `generated document differs byte-for-byte from deterministic regeneration: docs/generated/${driftedPath}`,
    };
  }
  return { passed: findings.length === 0, driftedFiles, findings };
}

async function activeMilestone(repoRoot: string): Promise<string> {
  const milestonePath = path.join(repoRoot, 'specs/implementation/current-milestone.json');
  const milestone = JSON.parse(await readFile(milestonePath, 'utf8')) as {
    readonly milestoneId?: string;
    readonly status?: string;
  };
  if (milestone.status !== 'ACTIVE' || !/^G[0-7]$/.test(milestone.milestoneId ?? '')) {
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
  /**
   * The live PROD governance claims (module activations, posture declarations,
   * MCP matrix, live paths, distribution authorizations). REQUIRED for a
   * milestone that owns FR-PROD requirements: omitting it FAILS the gate closed
   * (audit H1/H2) instead of silently skipping the PROD rules.
   */
  readonly prodClaims?: ProdClaimsInput;
}

/** Structural mirror of `ProdConformanceInput`, kept import-cycle-free. */
export interface ProdClaimsInput {
  readonly activationClaims?: readonly unknown[];
  readonly postureDeclarations?: readonly unknown[];
  readonly mcpCompatibility?: unknown;
  readonly livePaths?: readonly unknown[];
  readonly distributionAuthorizations?: readonly unknown[];
}

export interface ConformanceResult {
  readonly overall: 'PASSED' | 'FAILED';
  /** The four trace rules plus, for a PROD milestone, the PROD rule findings. */
  readonly findings: readonly {
    readonly requirementId: string;
    readonly rule: string;
    readonly path: string;
    readonly message: string;
  }[];
}

/**
 * Whether the evaluated milestone owns FR-PROD law, derived from the
 * AUTHORITATIVE requirement set rather than a generation number (audit HIGH-3).
 * `G0`/`G1` legitimately own no FR-PROD requirement and therefore run no PROD
 * rules; every milestone that does own one (G2, G6) is always evaluated.
 */
function milestoneOwnsProdLaw(
  activeGroup: string,
  requirements: readonly RequirementMapping[],
): boolean {
  // Numeric-index scan, never `Array.prototype.some`: a shadowed `some`
  // returning `false` would silence the whole PROD rule block and the release
  // gate would skip FR-PROD law entirely (audit NEW-M5).
  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index] as RequirementMapping;
    if (
      requirement.id.startsWith('FR-PROD-') &&
      requirement.dependencyGroup === activeGroup &&
      (requirement.supersededBy ?? []).length === 0
    ) {
      return true;
    }
  }
  return false;
}

export async function evaluateConformance(options: ConformanceOptions): Promise<ConformanceResult> {
  // An explicit milestone must be a canonical dependency group (`G0`…`G7`):
  // zero-padded or otherwise non-canonical ids are a gate-downgrade attempt and
  // refuse closed (audit HIGH-3).
  // An explicit milestone must be a canonical dependency group (`G0`…`G7`):
  // zero-padded or otherwise non-canonical ids are a gate-downgrade attempt and
  // refuse closed. The type check is strict so a boxed/coercible id (for example
  // `new String('G2')`, which `===` would not match against the manifest's
  // primitive `dependencyGroup`) can never skip the PROD block (audit R2 residual).
  if (
    options.milestone !== undefined &&
    (typeof options.milestone !== 'string' || !/^G[0-7]$/.test(options.milestone))
  ) {
    return {
      overall: 'FAILED',
      findings: [
        {
          requirementId: 'FR-TRACE-003',
          rule: 'CONFORMANCE_MILESTONE_INVALID',
          path: String(options.milestone),
          message: `milestone must be a canonical dependency-group id G0…G7; ${JSON.stringify(
            options.milestone,
          )} is not`,
        },
      ],
    };
  }
  let activeGroup: string;
  if (options.milestone !== undefined) {
    activeGroup = options.milestone;
  } else {
    // A malformed repository milestone must fail the gate with a finding, not
    // silently skip the PROD block (audit R2 residual / T057).
    try {
      activeGroup = await activeMilestone(options.repoRoot);
    } catch (error) {
      return {
        overall: 'FAILED',
        findings: [
          {
            requirementId: 'FR-TRACE-003',
            rule: 'CONFORMANCE_MILESTONE_INVALID',
            path: 'specs/implementation/current-milestone.json',
            message: `the repository's ACTIVE milestone is not a canonical G0…G7 dependency group: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
  const requirements = options.requirements ?? (await loadRequirements(options.repoRoot));
  // Whether the milestone owns FR-PROD law is decided by the AUTHORITATIVE
  // manifest, NEVER by the caller-supplied requirement list: otherwise
  // `{milestone:'G2', requirements: []}` would silence the PROD family
  // (audit HIGH-3 residual). The injected list remains a seam for the other
  // rules only.
  const manifestRequirements =
    options.requirements === undefined ? requirements : await loadRequirements(options.repoRoot);
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
      ...(options.requirements === undefined ? {} : { requirements }),
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
  // The PROD rules are part of the authoritative release gate for every
  // milestone that owns FR-PROD law (audit H1). Imported lazily so the module
  // graph stays acyclic and injected unit checks stay repository-independent.
  const prodFindings: {
    readonly requirementId: string;
    readonly rule: string;
    readonly path: string;
    readonly message: string;
  }[] = [];
  if (milestoneOwnsProdLaw(activeGroup, manifestRequirements)) {
    const { checkProdSurfacePresence, evaluateProdConformance } = await import('./prod-rules.ts');
    // Numeric selection and append only (audit NEW-M5): `Array.prototype.filter`
    // and array spreads iterate, so a shadowed primitive silently dropped every
    // FR-PROD requirement or every finding and the PROD block became a vacuous
    // PASS.
    const prodRequirements: Array<(typeof manifestRequirements)[number]> = [];
    for (let index = 0; index < manifestRequirements.length; index += 1) {
      const requirement = manifestRequirements[index] as (typeof manifestRequirements)[number];
      if (requirement.id.startsWith('FR-PROD-') && requirement.dependencyGroup === activeGroup) {
        prodRequirements[prodRequirements.length] = requirement;
      }
    }
    const surface = await checkProdSurfacePresence({
      repoRoot: options.repoRoot,
      requirements: prodRequirements,
    });
    for (let index = 0; index < surface.findings.length; index += 1) {
      prodFindings[prodFindings.length] = surface.findings[index] as (typeof prodFindings)[number];
    }
    if (options.prodClaims === undefined) {
      prodFindings[prodFindings.length] = {
        requirementId: 'FR-PROD-001',
        rule: 'PROD_CONFORMANCE_INPUT_MISSING',
        path: 'prodClaims',
        message:
          'the release gate evaluated a milestone that owns FR-PROD law without PROD governance claims; an absent claim set fails closed instead of skipping the PROD rules',
      };
    } else {
      const prodReport = evaluateProdConformance(
        options.prodClaims as Parameters<typeof evaluateProdConformance>[0],
      );
      for (let index = 0; index < prodReport.findings.length; index += 1) {
        prodFindings[prodFindings.length] = prodReport.findings[
          index
        ] as (typeof prodFindings)[number];
      }
    }
  }
  // Numeric aggregation: an array spread iterates, so a shadowed
  // `Symbol.iterator` silently aggregated ZERO findings into a PASSED gate.
  const findings: (typeof prodFindings)[number][] = [];
  const sources = [
    mapping.findings,
    activePaths.findings,
    premature.findings,
    generated.findings,
    prodFindings,
  ];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex] as readonly (typeof prodFindings)[number][];
    for (let findingIndex = 0; findingIndex < source.length; findingIndex += 1) {
      findings[findings.length] = source[findingIndex] as (typeof prodFindings)[number];
    }
  }
  return { overall: findings.length === 0 ? 'PASSED' : 'FAILED', findings };
}
