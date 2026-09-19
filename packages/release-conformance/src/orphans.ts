import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RequirementManifest } from '@foresift/requirement-manifest';

export interface OrphanException {
  readonly pattern: string;
  readonly requirementIds: readonly string[];
  readonly justification: string;
}
export interface OrphanFinding {
  readonly requirementId: 'FR-TRACE-003';
  readonly requirement: 'FR-TRACE-003';
  readonly rule: 'ORPHAN_PRODUCT_SOURCE';
  readonly path: string;
  readonly message: string;
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${escaped}$`);
}
const cleanRef = (reference: string): string =>
  (reference.split(/\s+@(?:requirement|acceptance)\s+/u, 1)[0] ?? reference).replace(/\/$/, '/**');

async function productSources(rootDir: string): Promise<readonly string[]> {
  const output: string[] = [];
  const roots = ['apps', 'packages'];
  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(rootDir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'test' || entry.name === '__tests__' || entry.name === 'node_modules')
        continue;
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) && child.includes('/src/'))
        output.push(child);
    }
  };
  for (const root of roots) await walk(root);
  return output.sort();
}

export async function loadOrphanExceptions(
  filePath = new URL('./orphan-exceptions.json', import.meta.url),
): Promise<readonly OrphanException[]> {
  const entries = JSON.parse(await readFile(filePath, 'utf8')) as OrphanException[];
  for (const entry of entries)
    if (!entry.pattern || entry.requirementIds.length === 0 || !entry.justification)
      throw new TypeError(
        'orphan exception entries require pattern, requirementIds, and justification',
      );
  return entries;
}

export async function detectOrphans(
  manifest: RequirementManifest,
  rootDir = process.cwd(),
  exceptions?: readonly OrphanException[],
): Promise<readonly OrphanFinding[]> {
  const mappings = manifest.requirements
    .flatMap((item) => item.implementationRefs.map(cleanRef))
    .map(globRegex);
  const ledger = exceptions ?? (await loadOrphanExceptions());
  const exceptionPatterns = ledger.map((entry) => globRegex(entry.pattern));
  return (await productSources(rootDir))
    .filter((source) => !mappings.some((matcher) => matcher.test(source)))
    .filter((source) => !exceptionPatterns.some((matcher) => matcher.test(source)))
    .map((source) => ({
      requirementId: 'FR-TRACE-003',
      requirement: 'FR-TRACE-003',
      rule: 'ORPHAN_PRODUCT_SOURCE',
      path: source,
      message: 'product source is matched by no implementationRef or traced exception',
    }));
}

export const evaluateOrphans = detectOrphans;
