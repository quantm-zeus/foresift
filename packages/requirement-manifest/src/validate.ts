/** @requirement FR-TRACE-001 FR-TRACE-002 @acceptance AC-265 AC-266 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkGlobalIdUniqueness, checkStableOrdering } from './ids.ts';

export function computeTextSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function checkDependencyDagAcyclicity(groups: readonly any[]): { isAcyclic: boolean; cycles: string[][] } {
  const edges = new Map(groups.map((group) => [group.id, group.dependsOn ?? group.dependencies ?? []]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const cycles: string[][] = [];
  function visit(id: string, stack: string[]) {
    if (visiting.has(id)) { cycles.push([...stack.slice(stack.indexOf(id)), id]); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency, [...stack, id]);
    visiting.delete(id); visited.add(id);
  }
  for (const id of edges.keys()) visit(id, []);
  return { isAcyclic: cycles.length === 0, cycles };
}

function countsOf(manifest: any) {
  return {
    requirements: manifest.requirements.length,
    acceptanceCriteria: manifest.acceptanceCriteria.length,
    invariants: manifest.invariants.length,
    adrs: manifest.adrs.length,
  };
}

function expectedFromManifest(manifest: any) {
  const release = manifest.releaseConformance ?? {};
  return {
    requirements: release.requirementCount,
    acceptanceCriteria: release.acceptanceCriteriaCount,
    invariants: release.invariantCount,
    adrs: release.adrCount,
  };
}

function assertCounts(actual: ReturnType<typeof countsOf>, expected: any) {
  for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
    if (typeof expected[key] === 'number' && actual[key] !== expected[key]) {
      throw new Error(`COUNT_MISMATCH: ${key} disagreement (${actual[key]} != ${expected[key]})`);
    }
  }
}

export function verifyFourWayCountAgreement(options: any): any {
  if (options.manifestData) {
    const counts = countsOf(options.manifestData);
    assertCounts(counts, expectedFromManifest(options.manifestData));
    return { agreed: true, ...counts };
  }
  return Promise.resolve().then(() => {
    const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
    const audit = JSON.parse(readFileSync(options.auditPath, 'utf8'));
    const counts = countsOf(manifest);
    assertCounts(counts, expectedFromManifest(manifest));
    assertCounts(counts, {
      requirements: audit.manifest.requirements,
      acceptanceCriteria: audit.manifest.acceptanceCriteria,
      invariants: audit.manifest.invariants,
      adrs: audit.manifest.adrs,
    });
    assertCounts(counts, {
      requirements: audit.inventory.functionalRequirements,
      acceptanceCriteria: audit.inventory.acceptanceCriteria,
      invariants: audit.inventory.architectureInvariants,
      adrs: audit.inventory.acceptedADRs,
    });
    return { agreed: true, ...counts };
  });
}

function validateData(manifest: any) {
  for (const collection of [manifest.requirements, manifest.acceptanceCriteria, manifest.invariants]) {
    for (const item of collection) if (computeTextSha256(item.text) !== item.textSha256) {
      throw new Error(`TEXT_HASH_MISMATCH: ${item.id} has invalid text hash`);
    }
  }
  const requirements = new Set(manifest.requirements.map((item: any) => item.id));
  const criteria = new Set(manifest.acceptanceCriteria.map((item: any) => item.id));
  for (const criterion of manifest.acceptanceCriteria) for (const ref of criterion.requirementRefs ?? []) {
    if (!requirements.has(ref)) throw new Error(`DANGLING_REFERENCE: ${criterion.id} references missing requirement ${ref}`);
  }
  for (const requirement of manifest.requirements) for (const ref of requirement.acceptanceCriteria ?? []) {
    if (!criteria.has(ref)) throw new Error(`DANGLING_REFERENCE: ${requirement.id} references missing acceptance criterion ${ref}`);
  }
  const uniqueness = checkGlobalIdUniqueness(manifest);
  if (!uniqueness.isUnique) throw new Error(`GLOBAL_ID_UNIQUENESS: ${[...uniqueness.duplicates, ...uniqueness.invalidIds].join(',')}`);
  if (!checkStableOrdering(manifest).isStable) throw new Error('STABLE_ORDERING: document order changed');
  const dag = checkDependencyDagAcyclicity(manifest.dependencyGroups ?? []);
  if (!dag.isAcyclic) throw new Error(`DEPENDENCY_CYCLE: ${JSON.stringify(dag.cycles)}`);
  verifyFourWayCountAgreement({ manifestData: manifest });
}

export function validateRequirementManifest(options: any): any {
  if (options.manifestData) {
    validateData(options.manifestData);
    return { isValid: true, hashes: {} };
  }
  return Promise.resolve().then(() => {
    const manifestBytes = readFileSync(options.manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    validateData(manifest);
    const auditBytes = readFileSync(options.auditPath);
    const documentBytes = readFileSync(options.prdPath);
    const sums = readFileSync(options.sha256sumsPath, 'utf8');
    const hashes = {
      manifestSha256: sha256(manifestBytes), documentSha256: sha256(documentBytes), auditSha256: sha256(auditBytes),
    };
    for (const [hash, name] of sums.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/))) {
      const actual = name.endsWith('.requirements.json') ? hashes.manifestSha256 : name.endsWith('.audit.json') ? hashes.auditSha256 : hashes.documentSha256;
      if (hash !== actual) throw new Error(`HASH_MISMATCH: ${name}`);
    }
    const audit = JSON.parse(auditBytes.toString('utf8'));
    if (audit.hashes.documentArtifactSha256 !== hashes.documentSha256 || audit.hashes.requirementManifestSha256 !== hashes.manifestSha256) {
      throw new Error('HASH_MISMATCH: audit provenance disagreement');
    }
    return { isValid: true, hashes };
  });
}
