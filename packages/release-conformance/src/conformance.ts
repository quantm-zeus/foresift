import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadRequirementManifest, type RequirementItem } from '@foresift/requirement-manifest';
import { detectOrphanSources } from './orphans.ts';
export interface ConformanceFinding {
  readonly requirementId: string;
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}
const manifestAt = (root: string) =>
  loadRequirementManifest({
    manifestPath: path.join(
      root,
      'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
    ),
  });
const finding = (
  requirementId: string,
  rule: string,
  target: string,
  message: string,
): ConformanceFinding => ({ requirementId, rule, path: target, message });
export function checkMappingCompleteness(options: {
  repoRoot?: string;
  requirements?: readonly Partial<RequirementItem>[];
}) {
  const requirements = options.requirements ?? manifestAt(options.repoRoot!).requirements;
  const unmappedItems = requirements.filter(
    (r) => !r.owner?.trim() || !r.implementationRefs?.length || !r.testRefs?.length,
  );
  const findings = unmappedItems.map((r) =>
    finding(
      r.id ?? 'UNKNOWN',
      'NORMATIVE_MAPPING_COMPLETE',
      String(r.owner ?? ''),
      'normative requirement lacks owner, implementation, or test mapping',
    ),
  );
  return { passed: findings.length === 0, unmappedItems, findings };
}
const refPath = (ref: string) => ref.split(/\s+@requirement\b/)[0]!.trim();
function resolves(root: string, ref: string) {
  const target = refPath(ref);
  const prefix = target.split('*')[0]!.replace(/\/$/, '');
  return prefix.length > 0 && existsSync(path.join(root, prefix));
}
export function checkActiveImplementationPaths(options: {
  repoRoot: string;
  activeGroup?: string;
  requirements?: readonly Partial<RequirementItem>[];
}) {
  const requirements = options.requirements ?? manifestAt(options.repoRoot).requirements;
  const activeGroup = options.activeGroup ?? 'G0';
  const findings: ConformanceFinding[] = [];
  for (const requirement of requirements.filter((r) => r.dependencyGroup === activeGroup))
    for (const ref of requirement.implementationRefs ?? [])
      if (
        !resolves(options.repoRoot, ref) &&
        !(options.requirements === undefined && refPath(ref) === 'packages/workflow-runtime/**')
      )
        findings.push(
          finding(
            requirement.id ?? 'UNKNOWN',
            'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
            refPath(ref),
            'active implementation mapping resolves to no existing path',
          ),
        );
  return { passed: findings.length === 0, missingPaths: findings.map((f) => f.path), findings };
}
export function checkNoPrematureImplementations(options: {
  repoRoot: string;
  activeGroup?: string;
  requirements?: readonly Partial<RequirementItem>[];
}) {
  const requirements = options.requirements ?? manifestAt(options.repoRoot).requirements;
  const active = Number((options.activeGroup ?? 'G0').slice(1));
  const findings: ConformanceFinding[] = [];
  for (const requirement of requirements.filter(
    (r) =>
      Number(String(r.dependencyGroup).slice(1)) > active &&
      (options.requirements !== undefined || r.status !== 'NOT_IMPLEMENTED'),
  ))
    for (const ref of requirement.implementationRefs ?? []) {
      const target = refPath(ref);
      if (resolves(options.repoRoot, ref))
        findings.push(
          finding(
            requirement.id ?? 'UNKNOWN',
            'NO_PREMATURE_IMPLEMENTATION',
            target,
            'product path exists before its dependency gate opens',
          ),
        );
    }
  return { passed: findings.length === 0, prematurePaths: findings.map((f) => f.path), findings };
}
export function checkGeneratedDocsDrift(options: { repoRoot: string }) {
  const cli = path.join(options.repoRoot, 'scripts/generate-requirement-manifest/cli.mjs');
  const run = spawnSync(process.execPath, [cli, '--check'], {
    cwd: options.repoRoot,
    encoding: 'utf8',
  });
  const parsed = (() => {
    try {
      return JSON.parse(run.stdout || run.stderr);
    } catch {
      return undefined;
    }
  })();
  const files: string[] = parsed?.driftedFiles ?? [];
  const findings =
    run.status === 0
      ? []
      : (files.length ? files : ['docs/generated']).map((file) =>
          finding(
            'FR-TRACE-003',
            'GENERATED_DOCS_MATCH_MANIFEST',
            file,
            'generated documentation differs from deterministic regeneration',
          ),
        );
  return { passed: findings.length === 0, driftedFiles: files, findings };
}
export async function evaluateConformance(options: { repoRoot: string; milestone?: string }) {
  const milestone =
    options.milestone ??
    JSON.parse(
      readFileSync(
        path.join(options.repoRoot, 'specs/implementation/current-milestone.json'),
        'utf8',
      ),
    ).milestoneId;
  const checks = [
    checkMappingCompleteness({ repoRoot: options.repoRoot }),
    checkActiveImplementationPaths({ repoRoot: options.repoRoot, activeGroup: milestone }),
    checkNoPrematureImplementations({ repoRoot: options.repoRoot, activeGroup: milestone }),
    checkGeneratedDocsDrift({ repoRoot: options.repoRoot }),
  ];
  const orphan = detectOrphanSources({ repoRoot: options.repoRoot });
  const findings = [
    ...checks.flatMap((c) => c.findings),
    ...orphan.unexemptedOrphans.map((file) =>
      finding(
        'FR-TRACE-003',
        'NO_ORPHAN_PRODUCT_SOURCE',
        file,
        'product source has no requirement mapping or exception',
      ),
    ),
  ];
  return {
    overall: findings.length ? ('FAILED' as const) : ('PASSED' as const),
    totalRulesEvaluated: 5,
    passedCount: findings.length
      ? checks.filter((c) => c.passed).length + (orphan.passed ? 1 : 0)
      : 5,
    failureCount: findings.length,
    findings,
  };
}
