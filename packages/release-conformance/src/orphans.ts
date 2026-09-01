/** @requirement FR-TRACE-003 @acceptance AC-266 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function loadOrphanExceptions(file: string) { return JSON.parse(await readFile(file, 'utf8')); }
export function validateOrphanExceptionLedger(ledger: any) {
  const errors: string[] = [];
  if (!ledger || !Array.isArray(ledger.exceptions)) errors.push('exceptions must be an array');
  else ledger.exceptions.forEach((item: any, index: number) => {
    if (!item.pathPattern) errors.push(`exceptions[${index}].pathPattern required`);
    if (!item.servingRequirementIds?.length) errors.push(`exceptions[${index}].servingRequirementIds required`);
    if (!item.justification?.trim()) errors.push(`exceptions[${index}].justification required`);
  });
  return { valid: errors.length === 0, errors };
}
function matches(pattern: string, file: string) {
  const prefix = pattern.replace(/\*\*.*$/, '').replace(/\*.*$/, ''); return file.startsWith(prefix);
}
function evaluate(productFiles: string[], implementationRefs: string[], exceptions: any[]) {
  const mapped = implementationRefs.map((ref) => ref.replace(/\s+@requirement\s+.*$/, ''));
  const unexemptedOrphans: string[] = [], exemptedOrphans: string[] = [];
  for (const file of productFiles) {
    if (mapped.some((pattern) => matches(pattern, file))) continue;
    if (exceptions.some((item) => matches(item.pathPattern, file))) exemptedOrphans.push(file);
    else unexemptedOrphans.push(file);
  }
  return { passed: unexemptedOrphans.length === 0, unexemptedOrphans, exemptedOrphans };
}
async function walk(root: string, relative: string): Promise<string[]> {
  let entries: any[] = []; try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, target));
    else if (entry.isFile() && /\.(?:ts|mts|mjs)$/.test(entry.name) && target.includes('/src/')) files.push(target);
  }
  return files;
}
export function detectOrphanSources(options: any): any {
  if (options.productFiles) return evaluate(options.productFiles, options.implementationRefs ?? [], options.exceptions ?? []);
  return Promise.all([
    walk(options.repoRoot, 'packages'), walk(options.repoRoot, 'apps'),
    readFile(path.join(options.repoRoot, 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json'), 'utf8').then(JSON.parse),
    loadOrphanExceptions(path.join(options.repoRoot, 'packages/release-conformance/src/orphan-exceptions.json')),
  ]).then(([packages, apps, manifest, ledger]) => evaluate([...packages, ...apps], manifest.requirements.flatMap((item: any) => item.implementationRefs ?? []), ledger.exceptions));
}
