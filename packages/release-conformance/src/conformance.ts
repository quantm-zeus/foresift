/** Release-blocking mapping and generated-document rules. @requirement FR-TRACE-003 */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ConformanceFinding {
  readonly requirementId: string;
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

type Requirement = {
  id: string;
  dependencyGroup?: string;
  owner?: string;
  implementationRefs?: string[];
  testRefs?: string[];
};

async function liveRequirements(repoRoot: string): Promise<Requirement[]> {
  const file = path.join(
    repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
  );
  return (JSON.parse(await readFile(file, 'utf8')) as { requirements: Requirement[] }).requirements;
}

function mappedPath(reference: string): string {
  return reference.split(/\s+@requirement\s+/)[0].trim();
}

async function pathExists(repoRoot: string, reference: string): Promise<boolean> {
  const mapped = mappedPath(reference);
  const wildcard = mapped.search(/[?*]/);
  // A glob is a package-family contract, not an assertion that every planned
  // package already exists. Concrete file mappings are checked strictly.
  if (wildcard >= 0) return true;
  const candidate = mapped;
  try {
    await access(path.join(repoRoot, candidate || '.'));
    return true;
  } catch {
    return false;
  }
}

export function checkMappingCompleteness(options: { requirements: Requirement[] }): {
  passed: boolean;
  unmappedItems: Requirement[];
  findings: ConformanceFinding[];
};
export function checkMappingCompleteness(options: { repoRoot: string }): Promise<{
  passed: boolean;
  unmappedItems: Requirement[];
  findings: ConformanceFinding[];
}>;
export function checkMappingCompleteness(options: {
  repoRoot?: string;
  requirements?: Requirement[];
}) {
  const evaluate = (requirements: Requirement[]) => {
    const unmappedItems = requirements.filter(
      (item) => !item.owner?.trim() || !item.implementationRefs?.length || !item.testRefs?.length,
    );
    return {
      passed: unmappedItems.length === 0,
      unmappedItems,
      findings: unmappedItems.map((item) => ({
        requirementId: item.id,
        rule: 'NORMATIVE_MAPPING_COMPLETE',
        path: 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
        message: `${item.id} lacks owner, implementation, or test mapping`,
      })),
    };
  };
  if (options.requirements) return evaluate(options.requirements);
  if (!options.repoRoot) throw new Error('repoRoot or requirements is required');
  return liveRequirements(options.repoRoot).then(evaluate);
}

export async function checkActiveImplementationPaths(options: {
  repoRoot: string;
  activeGroup: string;
  requirements?: Requirement[];
}) {
  const requirements = options.requirements ?? (await liveRequirements(options.repoRoot));
  const missingPaths: string[] = [];
  const findings: ConformanceFinding[] = [];
  for (const requirement of requirements.filter(
    (item) => item.dependencyGroup === options.activeGroup,
  )) {
    for (const reference of requirement.implementationRefs ?? []) {
      if (await pathExists(options.repoRoot, reference)) continue;
      const missing = mappedPath(reference);
      missingPaths.push(missing);
      findings.push({
        requirementId: requirement.id,
        rule: 'ACTIVE_IMPLEMENTATION_PATH_EXISTS',
        path: missing,
        message: `Mapped active implementation path does not exist: ${missing}`,
      });
    }
  }
  return { passed: findings.length === 0, missingPaths, findings };
}

export async function checkNoPrematureImplementations(options: {
  repoRoot: string;
  activeGroup: string;
  requirements?: Requirement[];
}) {
  const requirements = options.requirements ?? (await liveRequirements(options.repoRoot));
  const activeOrdinal = Number(options.activeGroup.replace(/^G/, ''));
  const prematurePaths: string[] = [];
  const findings: ConformanceFinding[] = [];
  for (const requirement of requirements) {
    const ordinal = Number(requirement.dependencyGroup?.replace(/^G/, ''));
    if (!Number.isFinite(ordinal) || ordinal <= activeOrdinal) continue;
    for (const reference of requirement.implementationRefs ?? []) {
      const mapped = mappedPath(reference);
      if (/[?*]/.test(mapped)) continue;
      if (!(await pathExists(options.repoRoot, reference))) continue;
      const contents = await readFile(path.join(options.repoRoot, mapped), 'utf8').catch(() => '');
      if (!contents.includes(`@requirement ${requirement.id}`)) continue;
      prematurePaths.push(mapped);
      findings.push({
        requirementId: requirement.id,
        rule: 'NO_PREMATURE_IMPLEMENTATION',
        path: mapped,
        message: `${requirement.id} is implemented before ${requirement.dependencyGroup} is active`,
      });
    }
  }
  return { passed: findings.length === 0, prematurePaths, findings };
}

export async function checkGeneratedDocsDrift(options: { repoRoot: string }) {
  const cli = path.join(options.repoRoot, 'scripts/generate-requirement-manifest/cli.mjs');
  const result = spawnSync(process.execPath, [cli, '--check', '--root', options.repoRoot], {
    cwd: options.repoRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) return { passed: true, driftedFiles: [], findings: [] };
  let driftedFiles: string[] = [];
  try {
    const parsed = JSON.parse(result.stderr || result.stdout);
    driftedFiles = (parsed.drift ?? []).map((item: { path: string }) => item.path);
  } catch {
    driftedFiles = ['docs/generated'];
  }
  return {
    passed: false,
    driftedFiles,
    findings: driftedFiles.map((driftedPath) => ({
      requirementId: 'FR-TRACE-003',
      rule: 'GENERATED_DOCS_MATCH_MANIFEST',
      path: driftedPath,
      message: 'Generated documentation differs from deterministic regeneration',
    })),
  };
}

export async function evaluateConformance(options: { repoRoot: string; milestone?: string }) {
  const activeGroup = options.milestone ?? 'G0';
  const [mapping, paths, premature, docs] = await Promise.all([
    checkMappingCompleteness({ repoRoot: options.repoRoot }),
    checkActiveImplementationPaths({ repoRoot: options.repoRoot, activeGroup }),
    checkNoPrematureImplementations({ repoRoot: options.repoRoot, activeGroup }),
    checkGeneratedDocsDrift({ repoRoot: options.repoRoot }),
  ]);
  const results = [mapping, paths, premature, docs];
  const findings = results.flatMap((result) => result.findings);
  const passedCount = results.filter((result) => result.passed).length;
  return {
    overall: findings.length === 0 ? ('PASSED' as const) : ('FAILED' as const),
    totalRulesEvaluated: results.length,
    passedCount,
    failureCount: results.length - passedCount,
    findings,
  };
}
