import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadRequirementManifest } from '@foresift/requirement-manifest';
export interface OrphanException { readonly pathPattern: string; readonly servingRequirementIds: readonly string[]; readonly justification: string }
export interface OrphanLedger { readonly schemaVersion?: string; readonly exceptions: readonly OrphanException[] }
const globRegex = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
const matches = (file: string, pattern: string) => globRegex(pattern.replace(/\/$/, '/**')).test(file) || (pattern.endsWith('/**') && file === pattern.slice(0, -3));
export function loadOrphanExceptions(file: string): OrphanLedger { return JSON.parse(readFileSync(file, 'utf8')); }
export function validateOrphanExceptionLedger(ledger: OrphanLedger) {
  const errors: string[] = [], seen = new Set<string>();
  if (!ledger || !Array.isArray(ledger.exceptions)) errors.push('exceptions must be an array');
  else for (const [i, entry] of ledger.exceptions.entries()) { if (!entry.pathPattern?.trim()) errors.push(`exceptions[${i}].pathPattern is required`); if (seen.has(entry.pathPattern)) errors.push(`duplicate pathPattern ${entry.pathPattern}`); seen.add(entry.pathPattern); if (!entry.servingRequirementIds?.length) errors.push(`exceptions[${i}].servingRequirementIds is required`); if (!entry.justification?.trim()) errors.push(`exceptions[${i}].justification is required`); }
  return { valid: errors.length === 0, errors };
}
function walk(dir: string, root: string, output: string[]) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (!['node_modules','test','tests','__tests__'].includes(entry.name)) walk(full, root, output); } else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) output.push(path.relative(root, full).split(path.sep).join('/')); } }
export function detectOrphanSources(options: { repoRoot?: string; productFiles?: readonly string[]; implementationRefs?: readonly string[]; exceptions?: readonly OrphanException[] }) {
  let productFiles = options.productFiles, implementationRefs = options.implementationRefs, exceptions = options.exceptions;
  if (options.repoRoot) { const root = options.repoRoot; const files: string[] = []; for (const dir of ['packages','apps']) { const full = path.join(root, dir); try { walk(full, root, files); } catch {} } productFiles ??= files; const manifest = loadRequirementManifest({ manifestPath: path.join(root, 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json') }); implementationRefs ??= manifest.requirements.flatMap((r) => r.implementationRefs); exceptions ??= loadOrphanExceptions(path.join(root, 'packages/release-conformance/src/orphan-exceptions.json')).exceptions; }
  const patterns = (implementationRefs ?? []).map((ref) => ref.split(/\s+@requirement\b/)[0]!.trim()); const exemptedOrphans: string[] = [], unexemptedOrphans: string[] = [];
  for (const file of productFiles ?? []) { if (patterns.some((pattern) => matches(file, pattern))) continue; if ((exceptions ?? []).some((entry) => matches(file, entry.pathPattern))) exemptedOrphans.push(file); else unexemptedOrphans.push(file); }
  return { passed: unexemptedOrphans.length === 0, unexemptedOrphans: unexemptedOrphans.sort(), exemptedOrphans: exemptedOrphans.sort() };
}
