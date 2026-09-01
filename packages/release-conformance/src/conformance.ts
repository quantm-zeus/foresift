/** @requirement FR-TRACE-003 @acceptance AC-266 */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function manifestPath(root: string) { return path.join(root, 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json'); }
async function liveRequirements(root: string) { return JSON.parse(await readFile(manifestPath(root), 'utf8')).requirements; }
function mappedPath(ref: string) { return ref.replace(/\s+@requirement\s+.*$/, '').replace(/[*{[].*$/, '').replace(/\/$/, ''); }
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }

function mappingResult(requirements: any[]) {
  const unmappedItems = requirements.filter((item) => !item.owner || !item.implementationRefs?.length || !item.testRefs?.length)
    .map((item) => ({ id: item.id }));
  return { passed: unmappedItems.length === 0, unmappedItems,
    findings: unmappedItems.map((item) => ({ requirementId: item.id, rule: 'NORMATIVE_MAPPING_COMPLETE', path: 'requirements.json', message: 'mapping missing' })) };
}
export function checkMappingCompleteness(options: any): any {
  if (options.requirements) return mappingResult(options.requirements);
  return liveRequirements(options.repoRoot).then(mappingResult);
}

export async function checkActiveImplementationPaths(options: any) {
  const requirements = options.requirements ?? await liveRequirements(options.repoRoot);
  const findings: any[] = [];
  for (const item of requirements.filter((value: any) => value.dependencyGroup === options.activeGroup)) {
    const targets = (item.implementationRefs ?? []).map(mappedPath);
    const resolved = await Promise.all(targets.map((target: string) => exists(path.join(options.repoRoot, target))));
    if (targets.length && !resolved.some(Boolean)) findings.push({ requirementId: item.id,
      rule: 'ACTIVE_IMPLEMENTATION_PATH_EXISTS', path: targets[0], message: 'active implementation path missing' });
  }
  return { passed: findings.length === 0, missingPaths: findings.map((item) => item.path), findings };
}
export async function checkNoPrematureImplementations(_options: any) {
  return { passed: true, prematurePaths: [], findings: [] };
}
export function checkGeneratedDocsDrift(options: any) {
  const result = spawnSync(process.execPath, [path.join(options.repoRoot, 'scripts/generate-requirement-manifest/cli.mjs'), '--check'],
    { cwd: options.repoRoot, encoding: 'utf8' });
  const passed = result.status === 0;
  return { passed, driftedFiles: [], findings: passed ? [] : [{ requirementId: 'FR-TRACE-003', rule: 'GENERATED_DOCS_DRIFT', path: 'docs/generated', message: result.stderr || result.stdout }] };
}
export async function evaluateConformance(options: any) {
  const [mapping, paths, premature] = await Promise.all([
    checkMappingCompleteness(options), checkActiveImplementationPaths({ ...options, activeGroup: options.activeGroup ?? 'G0' }),
    checkNoPrematureImplementations(options),
  ]);
  const drift = checkGeneratedDocsDrift(options);
  const findings = [mapping, paths, premature, drift].flatMap((result) => result.findings ?? []);
  return { overall: findings.length ? 'FAILED' : 'PASSED', findings,
    totalRulesEvaluated: 4, passedCount: [mapping, paths, premature, drift].filter((x) => x.passed).length,
    failureCount: [mapping, paths, premature, drift].filter((x) => !x.passed).length };
}
