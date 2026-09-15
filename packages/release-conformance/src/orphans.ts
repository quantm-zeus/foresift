/** Product-source orphan detection and its requirement-traced exception ledger. */
import { appendSafe } from './shadow-safe.ts';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { implementationPath, type RequirementMapping } from './conformance.ts';
import {
  numericIncludes,
  numericMap,
  numericSome,
  numericSortStrings,
  promiseAllNumeric,
} from './shadow-safe.ts';

export interface OrphanException {
  readonly pathPattern: string;
  readonly servingRequirementIds: readonly string[];
  readonly justification: string;
}

export interface OrphanExceptionLedger {
  readonly schemaVersion: string;
  readonly exceptions: readonly OrphanException[];
}

export async function loadOrphanExceptions(ledgerPath: string): Promise<OrphanExceptionLedger> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(ledgerPath, 'utf8'));
  } catch (cause) {
    throw new Error(`unable to load orphan exception ledger ${ledgerPath}`, { cause });
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError(`orphan exception ledger must be an object: ${ledgerPath}`);
  }
  return parsed as OrphanExceptionLedger;
}

export interface LedgerValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const REQUIREMENT_ID = /^(?:FR-[A-Z][A-Z0-9]*-\d{3}|INV-\d{3})$/;

export function validateOrphanExceptionLedger(
  ledger: unknown,
  knownRequirementIds?: ReadonlySet<string>,
): LedgerValidation {
  const errors: string[] = [];
  if (ledger === null || typeof ledger !== 'object') {
    return { valid: false, errors: ['ledger must be an object'] };
  }
  const candidate = ledger as Partial<OrphanExceptionLedger>;
  if (candidate.schemaVersion !== '1.0.0') appendSafe(errors, 'schemaVersion must equal 1.0.0');
  if (!Array.isArray(candidate.exceptions)) {
    appendSafe(errors, 'exceptions must be an array');
    return { valid: false, errors };
  }
  const patterns = new Set<string>();
  // Numeric-index walk only (audit HIGH): `forEach`/`some`/`filter`/`includes`
  // and `Symbol.iterator` are shadowable in-process, and a shadowed visit would
  // leave `errors` empty and declare an invalid ledger valid.
  for (let entryIndex = 0; entryIndex < candidate.exceptions.length; entryIndex += 1) {
    const entry = candidate.exceptions[entryIndex] as OrphanException;
    const prefix = `exceptions[${entryIndex}]`;
    if (entry === null || typeof entry !== 'object') {
      appendSafe(errors, `${prefix} must be an object`);
      continue;
    }
    if (typeof entry.pathPattern !== 'string' || entry.pathPattern.trim().length === 0) {
      appendSafe(errors, `${prefix}.pathPattern must be non-empty`);
    } else {
      const segments = entry.pathPattern.split('/');
      if (path.isAbsolute(entry.pathPattern) || numericIncludes(segments, '..')) {
        appendSafe(errors, `${prefix}.pathPattern must be repository-relative`);
      }
      if (patterns.has(entry.pathPattern))
        appendSafe(errors, `${prefix}.pathPattern is duplicated`);
      patterns.add(entry.pathPattern);
    }
    let servingIdsValid =
      Array.isArray(entry.servingRequirementIds) && entry.servingRequirementIds.length > 0;
    if (servingIdsValid) {
      for (let idIndex = 0; idIndex < entry.servingRequirementIds.length; idIndex += 1) {
        const requirementId: unknown = entry.servingRequirementIds[idIndex];
        if (typeof requirementId !== 'string' || !REQUIREMENT_ID.test(requirementId)) {
          servingIdsValid = false;
          break;
        }
      }
    }
    if (!servingIdsValid) {
      appendSafe(errors, `${prefix}.servingRequirementIds must contain valid requirement IDs`);
    } else if (knownRequirementIds !== undefined) {
      const unknownIds: string[] = [];
      for (let idIndex = 0; idIndex < entry.servingRequirementIds.length; idIndex += 1) {
        const requirementId = entry.servingRequirementIds[idIndex] as string;
        if (!knownRequirementIds.has(requirementId)) appendSafe(unknownIds, requirementId);
      }
      if (unknownIds.length > 0) {
        appendSafe(
          errors,
          `${prefix}.servingRequirementIds names unknown requirements: ${unknownIds.join(', ')}`,
        );
      }
    }
    if (typeof entry.justification !== 'string' || entry.justification.trim().length === 0) {
      appendSafe(errors, `${prefix}.justification must be non-empty`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function escapeRegex(character: string): string {
  return /[\\^$.[\]{}()+|]/.test(character) ? `\\${character}` : character;
}

/** Repository glob matcher supporting the manifest's `*`, `?`, and `**` forms. */
export function matchesRepositoryGlob(filePath: string, pattern: string): boolean {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] as string;
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`${source}$`).test(filePath.replaceAll('\\', '/'));
}

const PRODUCT_SOURCE_EXTENSION = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/;

async function collectProductFiles(repoRoot: string): Promise<readonly string[]> {
  const result: string[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(repoRoot, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    // Numeric-index walk only (audit HIGH): `for…of` and `Array.prototype.sort`
    // are shadowable in-process.
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex] as (typeof entries)[number];
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && PRODUCT_SOURCE_EXTENSION.test(entry.name))
        appendSafe(result, relative);
    }
  };
  const topLevels = ['apps', 'packages'];
  for (let topLevelIndex = 0; topLevelIndex < topLevels.length; topLevelIndex += 1) {
    const topLevel = topLevels[topLevelIndex] as string;
    let projects;
    try {
      projects = await readdir(path.join(repoRoot, topLevel), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
      const project = projects[projectIndex] as (typeof projects)[number];
      if (project.isDirectory()) await visit(`${topLevel}/${project.name}/src`);
    }
  }
  return numericSortStrings(result);
}

interface ManifestTraceMappings {
  readonly implementationRefs: readonly string[];
  readonly requirementIds: ReadonlySet<string>;
}

async function loadManifestTraceMappings(repoRoot: string): Promise<ManifestTraceMappings> {
  const manifestPath = path.join(
    repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    readonly requirements?: readonly RequirementMapping[];
  };
  if (!Array.isArray(manifest.requirements)) throw new Error('manifest requirements are missing');
  // Numeric-index projection only (audit HIGH): `flatMap`/`map`/`new Set(array)`
  // all read `Array.prototype` hooks that a caller can shadow.
  const implementationRefs: string[] = [];
  const requirementIds = new Set<string>();
  for (let index = 0; index < manifest.requirements.length; index += 1) {
    const requirement = manifest.requirements[index] as RequirementMapping;
    const refs = requirement.implementationRefs ?? [];
    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      appendSafe(implementationRefs, refs[refIndex] as string);
    }
    requirementIds.add(requirement.id);
  }
  return { implementationRefs, requirementIds };
}

export interface DetectOrphanOptions {
  readonly repoRoot?: string;
  readonly productFiles?: readonly string[];
  readonly implementationRefs?: readonly string[];
  readonly exceptions?: readonly OrphanException[];
}

export interface OrphanDetectionResult {
  readonly passed: boolean;
  readonly unexemptedOrphans: readonly string[];
  readonly exemptedOrphans: readonly string[];
  readonly mappedProductFiles: readonly string[];
}

function evaluateOrphans(
  productFiles: readonly string[],
  implementationRefs: readonly string[],
  exceptions: readonly OrphanException[],
): OrphanDetectionResult {
  const implementationPatterns = numericMap(implementationRefs, implementationPath);
  const mappedProductFiles: string[] = [];
  const exemptedOrphans: string[] = [];
  const unexemptedOrphans: string[] = [];
  // Numeric-index walks only (audit HIGH): `for…of`, `some`, and `sort` are all
  // shadowable in-process; an empty scan or a sort no-op must never be able to
  // report zero orphans.
  for (let fileIndex = 0; fileIndex < productFiles.length; fileIndex += 1) {
    const file = productFiles[fileIndex] as string;
    if (numericSome(implementationPatterns, (pattern) => matchesRepositoryGlob(file, pattern))) {
      appendSafe(mappedProductFiles, file);
    } else if (numericSome(exceptions, (entry) => matchesRepositoryGlob(file, entry.pathPattern))) {
      appendSafe(exemptedOrphans, file);
    } else {
      appendSafe(unexemptedOrphans, file);
    }
  }
  return {
    passed: unexemptedOrphans.length === 0,
    unexemptedOrphans: numericSortStrings(unexemptedOrphans),
    exemptedOrphans: numericSortStrings(exemptedOrphans),
    mappedProductFiles: numericSortStrings(mappedProductFiles),
  };
}

export function detectOrphanSources(
  options: DetectOrphanOptions & {
    readonly productFiles: readonly string[];
    readonly implementationRefs: readonly string[];
    readonly exceptions: readonly OrphanException[];
  },
): OrphanDetectionResult;
export function detectOrphanSources(
  options: DetectOrphanOptions & { readonly repoRoot: string },
): Promise<OrphanDetectionResult>;
export function detectOrphanSources(
  options: DetectOrphanOptions,
): OrphanDetectionResult | Promise<OrphanDetectionResult> {
  if (
    options.productFiles !== undefined &&
    options.implementationRefs !== undefined &&
    options.exceptions !== undefined
  ) {
    return evaluateOrphans(options.productFiles, options.implementationRefs, options.exceptions);
  }
  if (options.repoRoot === undefined) {
    throw new TypeError(
      'repoRoot or all of productFiles, implementationRefs, and exceptions is required',
    );
  }
  const mappings = loadManifestTraceMappings(options.repoRoot);
  // `promiseAllNumeric` (audit residual): both `Promise.all` argument arrays
  // below carry their OWN captured `Symbol.iterator`, because `Promise.all`
  // reads `Array.prototype[Symbol.iterator]` on its ARGUMENT. A surgical
  // iterator could otherwise forge empty product files / fabricated exceptions
  // and silence a real orphan.
  return promiseAllNumeric([
    options.productFiles ?? collectProductFiles(options.repoRoot),
    options.implementationRefs ?? mappings.then((value) => value.implementationRefs),
    options.exceptions ??
      promiseAllNumeric([
        loadOrphanExceptions(
          path.join(options.repoRoot, 'packages/release-conformance/src/orphan-exceptions.json'),
        ),
        mappings,
      ]).then((settledExceptionLoad) => {
        // Numeric index reads, never array destructuring (audit N2 class): a
        // surgical `Symbol.iterator` shadow must not be able to forge the
        // ledger/manifest pair and silence the exception validation.
        const ledger = settledExceptionLoad[0];
        const manifestMappings = settledExceptionLoad[1];
        const validation = validateOrphanExceptionLedger(ledger, manifestMappings.requirementIds);
        if (!validation.valid) {
          throw new Error(`invalid orphan exception ledger: ${validation.errors.join('; ')}`);
        }
        return ledger.exceptions;
      }),
  ]).then((settledOrphans) => {
    const productFiles = settledOrphans[0];
    const implementationRefs = settledOrphans[1];
    const exceptions = settledOrphans[2];
    return evaluateOrphans(productFiles, implementationRefs, exceptions);
  });
}
