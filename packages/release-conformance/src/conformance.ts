import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveMappings, type RequirementManifest } from '@foresift/requirement-manifest';

export interface ConformanceFinding {
  readonly requirementId: string;
  readonly requirement?: string;
  readonly rule:
    | 'NORMATIVE_MAPPING_REQUIRED'
    | 'ACTIVE_IMPLEMENTATION_PATH_MISSING'
    | 'DEPENDENCY_GATE_CLOSED'
    | 'GENERATED_DOCUMENT_DRIFT';
  readonly path: string;
  readonly message: string;
}
export interface ConformanceVerdict {
  readonly ok: boolean;
  readonly findings: readonly ConformanceFinding[];
}
export interface ConformanceOptions {
  readonly rootDir?: string;
  readonly milestonePath?: string;
  readonly generatedArtifacts?: Readonly<Record<string, string>>;
}

const cleanRef = (reference: string): string =>
  reference.split(/\s+@(?:requirement|acceptance)\s+/u, 1)[0] ?? reference;

async function generatedDrift(
  rootDir: string,
  expected: Readonly<Record<string, string>>,
): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const [relativePath, expectedBytes] of Object.entries(expected).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let actual: string | undefined;
    try {
      actual = await readFile(path.join(rootDir, relativePath), 'utf8');
    } catch {
      /* reported below */
    }
    if (actual !== expectedBytes)
      findings.push({
        requirementId: 'FR-TRACE-003',
        requirement: 'FR-TRACE-003',
        rule: 'GENERATED_DOCUMENT_DRIFT',
        path: relativePath,
        message:
          actual === undefined
            ? 'generated artifact is missing'
            : 'generated artifact differs byte-for-byte',
      });
  }
  return findings;
}

export async function evaluateConformance(
  manifest: RequirementManifest,
  options: ConformanceOptions = {},
): Promise<ConformanceVerdict> {
  const rootDir = options.rootDir ?? process.cwd();
  const milestonePath =
    options.milestonePath ?? path.join(rootDir, 'specs/implementation/current-milestone.json');
  const milestone = JSON.parse(await readFile(milestonePath, 'utf8')) as {
    milestoneId?: string;
    status?: string;
  };
  const activeGroups = new Set<string>();
  if (milestone.status === 'ACTIVE' && milestone.milestoneId !== undefined)
    activeGroups.add(milestone.milestoneId);
  const findings: ConformanceFinding[] = [];
  const add = (
    requirementId: string,
    rule: ConformanceFinding['rule'],
    targetPath: string,
    message: string,
  ): void => {
    findings.push({ requirementId, requirement: requirementId, rule, path: targetPath, message });
  };

  for (const requirement of manifest.requirements) {
    for (const [field, values] of [
      ['implementationRefs', requirement.implementationRefs],
      ['testRefs', requirement.testRefs],
    ] as const)
      if (values.length === 0)
        add(
          requirement.id,
          'NORMATIVE_MAPPING_REQUIRED',
          `manifest:${requirement.id}.${field}`,
          `${field} must be non-empty`,
        );
    if (requirement.owner.trim().length === 0)
      add(
        requirement.id,
        'NORMATIVE_MAPPING_REQUIRED',
        `manifest:${requirement.id}.owner`,
        'owner must be non-empty',
      );

    const resolved = await resolveMappings(requirement, 'implementationRefs', rootDir);
    if (activeGroups.has(requirement.dependencyGroup)) {
      for (const reference of requirement.implementationRefs) {
        const clean = cleanRef(reference);
        const single = { ...requirement, implementationRefs: [reference] };
        if ((await resolveMappings(single, 'implementationRefs', rootDir)).length === 0)
          add(
            requirement.id,
            'ACTIVE_IMPLEMENTATION_PATH_MISSING',
            clean,
            'active implementationRef resolves to no code path',
          );
      }
    } else {
      for (const resolvedPath of resolved) {
        // A broad future mapping names where code WILL live. It is implemented
        // early only when the product source actually claims the stable id.
        let content = '';
        try {
          content = await readFile(path.join(rootDir, resolvedPath), 'utf8');
        } catch {
          continue;
        }
        if (content.includes(requirement.id))
          add(
            requirement.id,
            'DEPENDENCY_GATE_CLOSED',
            resolvedPath,
            `${requirement.dependencyGroup} is not active`,
          );
      }
    }
  }
  for (const criterion of manifest.acceptanceCriteria) {
    if (
      !criterion.evidenceOwner ||
      !criterion.positiveTestRef ||
      !criterion.negativeOrFailureTestRef
    )
      add(
        criterion.id,
        'NORMATIVE_MAPPING_REQUIRED',
        `manifest:${criterion.id}`,
        'AC requires owner and positive/failure tests',
      );
  }
  for (const invariant of manifest.invariants)
    if (!invariant.testRef)
      add(
        invariant.id,
        'NORMATIVE_MAPPING_REQUIRED',
        `manifest:${invariant.id}.testRef`,
        'invariant requires a test mapping',
      );
  for (const adr of manifest.adrs)
    if (!adr.title || !adr.decision || !adr.status)
      add(
        adr.id,
        'NORMATIVE_MAPPING_REQUIRED',
        `manifest:${adr.id}`,
        'ADR requires title, decision, and status',
      );
  if (options.generatedArtifacts !== undefined)
    findings.push(...(await generatedDrift(rootDir, options.generatedArtifacts)));
  findings.sort(
    (a, b) =>
      a.requirementId.localeCompare(b.requirementId) ||
      a.rule.localeCompare(b.rule) ||
      a.path.localeCompare(b.path),
  );
  return { ok: findings.length === 0, findings };
}

export const runConformance = evaluateConformance;

export async function listGeneratedFiles(rootDir: string): Promise<readonly string[]> {
  const directory = path.join(rootDir, 'docs/generated');
  try {
    return (await readdir(directory)).map((name) => `docs/generated/${name}`).sort();
  } catch {
    return [];
  }
}
