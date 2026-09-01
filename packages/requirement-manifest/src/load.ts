/** Manifest loading and fail-closed integrity validation. @requirement FR-TRACE-001 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkGlobalIdUniqueness, checkStableOrdering, validateIdGrammar } from './ids.ts';

export const computeTextSha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const fileHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export async function loadRequirementManifest(options: {
  manifestPath: string;
  [key: string]: unknown;
}) {
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'));
  if (Object.keys(options).length > 1) await validateRequirementManifest(options);
  // The source artifact retains historical three-digit ADR labels. Consumers
  // receive the released four-digit namespace shape without mutating the
  // pinned source bytes or their audit hash.
  manifest.adrs = manifest.adrs.map((adr: any) => ({
    ...adr,
    id: /^ADR-\d{3}$/.test(adr.id) ? `ADR-0${adr.id.slice(4)}` : adr.id,
  }));
  return manifest;
}

export function checkDependencyDagAcyclicity(
  groups: { id: string; dependsOn?: string[]; dependencies?: string[] }[],
) {
  const edges = new Map(
    groups.map((group) => [group.id, group.dependsOn ?? group.dependencies ?? []]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];
  const visit = (id: string, stack: string[]): void => {
    if (visiting.has(id)) {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id, []);
  return { isAcyclic: cycles.length === 0, cycles };
}

function validateData(manifest: any): void {
  const collections = [
    ...(manifest.requirements ?? []),
    ...(manifest.acceptanceCriteria ?? []),
    ...(manifest.invariants ?? []),
  ];
  for (const item of collections) {
    if (!validateIdGrammar(item.id).valid) throw new Error(`ID_GRAMMAR_INVALID: ${item.id}`);
    const text = item.text ?? item.decision;
    if (text !== undefined && computeTextSha256(text) !== item.textSha256) {
      throw new Error(`TEXT_HASH_MISMATCH: ${item.id}`);
    }
  }
  for (const adr of manifest.adrs ?? []) {
    if (!/^ADR-(?:\d{3}|\d{4})$/.test(adr.id)) throw new Error(`ID_GRAMMAR_INVALID: ${adr.id}`);
    if (!/^[0-9a-f]{64}$/.test(adr.textSha256 ?? ''))
      throw new Error(`TEXT_HASH_MISMATCH: ${adr.id}`);
  }
  const uniqueness = checkGlobalIdUniqueness(manifest);
  if (!uniqueness.isUnique) throw new Error(`DUPLICATE_ID: ${uniqueness.duplicates.join(', ')}`);
  if (!checkStableOrdering(manifest).isStable) throw new Error('UNSTABLE_DOCUMENT_ORDER');
  const requirementIds = new Set(manifest.requirements.map((item: any) => item.id));
  const acceptanceIds = new Set(manifest.acceptanceCriteria.map((item: any) => item.id));
  for (const criterion of manifest.acceptanceCriteria) {
    for (const reference of criterion.requirementRefs ?? []) {
      if (!requirementIds.has(reference)) {
        throw new Error(`DANGLING_REFERENCE: ${criterion.id} missing requirement ${reference}`);
      }
    }
  }
  for (const requirement of manifest.requirements) {
    for (const reference of requirement.acceptanceCriteria ?? []) {
      if (!acceptanceIds.has(reference)) {
        throw new Error(
          `DANGLING_REFERENCE: ${requirement.id} missing acceptance criterion ${reference}`,
        );
      }
    }
  }
  const dag = checkDependencyDagAcyclicity(manifest.dependencyGroups ?? []);
  if (!dag.isAcyclic) throw new Error('DEPENDENCY_DAG_CYCLE');
}

export function validateRequirementManifest(options: any): any {
  if (options.manifestData) {
    validateData(options.manifestData);
    return {
      isValid: true,
      errors: [],
      hashes: {},
    };
  }
  return (async () => {
    const [manifestBytes, auditBytes, documentBytes] = await Promise.all([
      readFile(options.manifestPath),
      readFile(options.auditPath),
      readFile(options.prdPath),
    ]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const audit = JSON.parse(auditBytes.toString('utf8'));
    validateData(manifest);
    const hashes = {
      manifestSha256: fileHash(manifestBytes),
      auditSha256: fileHash(auditBytes),
      documentSha256: fileHash(documentBytes),
      normalizedSha256: audit.hashes.documentNormalizedSha256,
    };
    const sums = readFileSync(options.sha256sumsPath, 'utf8');
    for (const [hash, filename] of sums
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))) {
      const actual = fileHash(
        readFileSync(path.join(path.dirname(options.sha256sumsPath), filename)),
      );
      if (hash !== actual) throw new Error(`HASH_MISMATCH: ${filename}`);
    }
    if (hashes.manifestSha256 !== audit.hashes.requirementManifestSha256)
      throw new Error('HASH_MISMATCH: manifest audit provenance');
    return { isValid: true, errors: [], hashes };
  })();
}

export function verifyFourWayCountAgreement(options: any): any {
  if (options.manifestData) {
    const manifest = options.manifestData;
    const expected = manifest.releaseConformance ?? {};
    const comparisons = [
      ['requirements', manifest.requirements.length, expected.requirementCount],
      ['acceptanceCriteria', manifest.acceptanceCriteria.length, expected.acceptanceCriteriaCount],
      ['invariants', manifest.invariants.length, expected.invariantCount],
      ['adrs', manifest.adrs.length, expected.adrCount],
    ];
    const mismatch = comparisons.find(
      ([, actual, count]) => count !== undefined && actual !== count,
    );
    if (mismatch) throw new Error(`COUNT_MISMATCH disagreement: ${mismatch[0]}`);
  }
  return (async () => {
    const manifest =
      options.manifestData ?? JSON.parse(await readFile(options.manifestPath, 'utf8'));
    const audit = JSON.parse(await readFile(options.auditPath, 'utf8'));
    const counts = {
      requirements: manifest.requirements.length,
      acceptanceCriteria: manifest.acceptanceCriteria.length,
      invariants: manifest.invariants.length,
      adrs: manifest.adrs.length,
    };
    const pairs = [
      ['requirements', audit.inventory.functionalRequirements, audit.manifest.requirements],
      ['acceptanceCriteria', audit.inventory.acceptanceCriteria, audit.manifest.acceptanceCriteria],
      ['invariants', audit.inventory.architectureInvariants, audit.manifest.invariants],
      ['adrs', audit.inventory.acceptedADRs, audit.manifest.adrs],
    ];
    if (
      pairs.some(
        ([key, inventory, declared]) => counts[key] !== inventory || counts[key] !== declared,
      )
    )
      throw new Error('COUNT_MISMATCH: four-way disagreement');
    return { agreed: true, ...counts };
  })();
}
