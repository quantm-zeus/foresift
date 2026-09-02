/** Product-source orphan detection and its requirement-traced exception ledger. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { implementationPath, type RequirementMapping } from './conformance.ts';

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
  if (candidate.schemaVersion !== '1.0.0') errors.push('schemaVersion must equal 1.0.0');
  if (!Array.isArray(candidate.exceptions)) {
    errors.push('exceptions must be an array');
    return { valid: false, errors };
  }
  const patterns = new Set<string>();
  candidate.exceptions.forEach((entry, index) => {
    const prefix = `exceptions[${index}]`;
    if (entry === null || typeof entry !== 'object') {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (typeof entry.pathPattern !== 'string' || entry.pathPattern.trim().length === 0) {
      errors.push(`${prefix}.pathPattern must be non-empty`);
    } else {
      if (path.isAbsolute(entry.pathPattern) || entry.pathPattern.split('/').includes('..')) {
        errors.push(`${prefix}.pathPattern must be repository-relative`);
      }
      if (patterns.has(entry.pathPattern)) errors.push(`${prefix}.pathPattern is duplicated`);
      patterns.add(entry.pathPattern);
    }
    if (
      !Array.isArray(entry.servingRequirementIds) ||
      entry.servingRequirementIds.length === 0 ||
      entry.servingRequirementIds.some(
        (requirementId: unknown) =>
          typeof requirementId !== 'string' || !REQUIREMENT_ID.test(requirementId),
      )
    ) {
      errors.push(`${prefix}.servingRequirementIds must contain valid requirement IDs`);
    } else if (
      knownRequirementIds !== undefined &&
      entry.servingRequirementIds.some((requirementId) => !knownRequirementIds.has(requirementId))
    ) {
      const unknownIds = entry.servingRequirementIds.filter(
        (requirementId) => !knownRequirementIds.has(requirementId),
      );
      errors.push(
        `${prefix}.servingRequirementIds names unknown requirements: ${unknownIds.join(', ')}`,
      );
    }
    if (typeof entry.justification !== 'string' || entry.justification.trim().length === 0) {
      errors.push(`${prefix}.justification must be non-empty`);
    }
  });
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
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && PRODUCT_SOURCE_EXTENSION.test(entry.name)) result.push(relative);
    }
  };
  for (const topLevel of ['apps', 'packages']) {
    let projects;
    try {
      projects = await readdir(path.join(repoRoot, topLevel), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const project of projects) {
      if (project.isDirectory()) await visit(`${topLevel}/${project.name}/src`);
    }
  }
  return result.sort();
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
  return {
    implementationRefs: manifest.requirements.flatMap(
      (requirement) => requirement.implementationRefs ?? [],
    ),
    requirementIds: new Set(manifest.requirements.map((requirement) => requirement.id)),
  };
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
  const implementationPatterns = implementationRefs.map(implementationPath);
  const mappedProductFiles: string[] = [];
  const exemptedOrphans: string[] = [];
  const unexemptedOrphans: string[] = [];
  for (const file of productFiles) {
    if (implementationPatterns.some((pattern) => matchesRepositoryGlob(file, pattern))) {
      mappedProductFiles.push(file);
    } else if (exceptions.some((entry) => matchesRepositoryGlob(file, entry.pathPattern))) {
      exemptedOrphans.push(file);
    } else {
      unexemptedOrphans.push(file);
    }
  }
  return {
    passed: unexemptedOrphans.length === 0,
    unexemptedOrphans: unexemptedOrphans.sort(),
    exemptedOrphans: exemptedOrphans.sort(),
    mappedProductFiles: mappedProductFiles.sort(),
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
  return Promise.all([
    options.productFiles ?? collectProductFiles(options.repoRoot),
    options.implementationRefs ?? mappings.then((value) => value.implementationRefs),
    options.exceptions ??
      Promise.all([
        loadOrphanExceptions(
          path.join(options.repoRoot, 'packages/release-conformance/src/orphan-exceptions.json'),
        ),
        mappings,
      ]).then(([ledger, manifestMappings]) => {
        const validation = validateOrphanExceptionLedger(
          ledger,
          manifestMappings.requirementIds,
        );
        if (!validation.valid) {
          throw new Error(`invalid orphan exception ledger: ${validation.errors.join('; ')}`);
        }
        return ledger.exceptions;
      }),
  ]).then(([productFiles, implementationRefs, exceptions]) =>
    evaluateOrphans(productFiles, implementationRefs, exceptions),
  );
}
