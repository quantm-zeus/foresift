/** Reverse mapping coverage for product sources and expiring exceptions. @requirement FR-TRACE-003 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

type ExceptionEntry = {
  pathPattern: string;
  servingRequirementIds: string[];
  justification: string;
  expiresAt?: string;
};

function regexFor(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escaped.replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*')}$`,
  );
}

const matches = (file: string, reference: string): boolean => {
  const pattern = reference.split(/\s+@requirement\s+/)[0].replace(/\/$/, '/**');
  return regexFor(pattern).test(file);
};

async function productFiles(repoRoot: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(repoRoot, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && /\/src\/.*\.(?:ts|tsx|js|mjs)$/.test(child)) found.push(child);
    }
  };
  await walk('packages');
  await walk('apps');
  return found.sort();
}

export async function loadOrphanExceptions(file: string): Promise<{
  schemaVersion: string;
  exceptions: ExceptionEntry[];
}> {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function validateOrphanExceptionLedger(ledger: { exceptions?: ExceptionEntry[] }): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!Array.isArray(ledger.exceptions))
    return { valid: false, errors: ['exceptions must be an array'] };
  for (const [index, entry] of ledger.exceptions.entries()) {
    if (!entry.pathPattern?.trim()) errors.push(`exceptions[${index}].pathPattern is required`);
    if (!entry.servingRequirementIds?.length)
      errors.push(`exceptions[${index}].servingRequirementIds is required`);
    if (!entry.justification?.trim()) errors.push(`exceptions[${index}].justification is required`);
    if (entry.expiresAt && Number.isNaN(Date.parse(entry.expiresAt)))
      errors.push(`exceptions[${index}].expiresAt is invalid`);
  }
  return { valid: errors.length === 0, errors };
}

export function detectOrphanSources(options: {
  productFiles: string[];
  implementationRefs: string[];
  exceptions: ExceptionEntry[];
}): { passed: boolean; unexemptedOrphans: string[]; exemptedOrphans: string[] };
export function detectOrphanSources(options: { repoRoot: string }): Promise<{
  passed: boolean;
  unexemptedOrphans: string[];
  exemptedOrphans: string[];
}>;
export function detectOrphanSources(options: any): any {
  const evaluate = (files: string[], references: string[], exceptions: ExceptionEntry[]) => {
    const orphans = files.filter(
      (file) => !references.some((reference) => matches(file, reference)),
    );
    const exemptedOrphans = orphans.filter((file) =>
      exceptions.some((entry) => regexFor(entry.pathPattern).test(file)),
    );
    const exempted = new Set(exemptedOrphans);
    const unexemptedOrphans = orphans.filter((file) => !exempted.has(file));
    return { passed: unexemptedOrphans.length === 0, unexemptedOrphans, exemptedOrphans };
  };
  if (options.productFiles)
    return evaluate(
      options.productFiles,
      options.implementationRefs ?? [],
      options.exceptions ?? [],
    );
  return (async () => {
    const manifest = JSON.parse(
      await readFile(
        path.join(
          options.repoRoot,
          'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
        ),
        'utf8',
      ),
    );
    const ledger = await loadOrphanExceptions(
      path.join(options.repoRoot, 'packages/release-conformance/src/orphan-exceptions.json'),
    );
    return evaluate(
      await productFiles(options.repoRoot),
      manifest.requirements.flatMap((item: any) => item.implementationRefs ?? []),
      ledger.exceptions,
    );
  })();
}
