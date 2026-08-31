import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { checkGlobalIdUniqueness, checkStableOrdering } from './ids.ts';
import { RequirementManifestError, RequirementManifestErrorCode as Code } from './errors.ts';
import type { DependencyGroup, RequirementManifest } from './types.ts';

export interface ValidationOptions { readonly manifestPath?: string; readonly manifestData?: RequirementManifest; readonly auditPath?: string; readonly prdPath?: string; readonly sha256sumsPath?: string }
export const computeTextSha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const fileHash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const getManifest = (options: ValidationOptions) => options.manifestData ?? JSON.parse(readFileSync(options.manifestPath!, 'utf8')) as RequirementManifest;

export function checkDependencyDagAcyclicity(groups: readonly DependencyGroup[]) {
  const edges = new Map(groups.map((group) => [group.id, [...(group.dependsOn ?? group.dependencies ?? [])]]));
  const visiting = new Set<string>(), visited = new Set<string>(), cycles: string[][] = [];
  const visit = (id: string, path: string[]) => { if (visiting.has(id)) { cycles.push([...path.slice(path.indexOf(id)), id]); return; } if (visited.has(id)) return; visiting.add(id); for (const dep of edges.get(id) ?? []) visit(dep, [...path, id]); visiting.delete(id); visited.add(id); };
  for (const id of edges.keys()) visit(id, []);
  return { isAcyclic: cycles.length === 0, cycles };
}

export function verifyFourWayCountAgreement(options: ValidationOptions) {
  const manifest = getManifest(options); const audit = JSON.parse(readFileSync(options.auditPath!, 'utf8'));
  const actual = { requirements: manifest.requirements.length, acceptanceCriteria: manifest.acceptanceCriteria.length, invariants: manifest.invariants.length, adrs: manifest.adrs.length };
  const sets = [actual,
    { requirements: audit.inventory.functionalRequirements, acceptanceCriteria: audit.inventory.acceptanceCriteria, invariants: audit.inventory.architectureInvariants, adrs: audit.inventory.acceptedADRs },
    { requirements: audit.manifest.requirements, acceptanceCriteria: audit.manifest.acceptanceCriteria, invariants: audit.manifest.invariants, adrs: audit.manifest.adrs },
    { requirements: manifest.releaseConformance.requirementCount, acceptanceCriteria: manifest.releaseConformance.acceptanceCriteriaCount, invariants: manifest.releaseConformance.invariantCount, adrs: manifest.releaseConformance.adrCount }];
  if (sets.some((set) => Object.keys(actual).some((key) => set[key as keyof typeof actual] !== actual[key as keyof typeof actual]))) throw new RequirementManifestError(Code.COUNT_MISMATCH, 'four-way count disagreement', { sets });
  return { agreed: true, ...actual };
}

function validateData(manifest: RequirementManifest, prdText?: string) {
  for (const item of [...manifest.requirements, ...manifest.acceptanceCriteria, ...manifest.invariants]) if (!item.text || computeTextSha256(item.text) !== item.textSha256) throw new RequirementManifestError(Code.TEXT_HASH_MISMATCH, `invalid text hash for ${item.id}`, { id: item.id });
  for (const adr of manifest.adrs) if (!/^ADR-\d{3,4}$/.test(adr.id) || typeof adr.title !== 'string' || !/^[0-9a-f]{64}$/.test(String(adr.textSha256))) throw new RequirementManifestError(Code.ID_GRAMMAR_INVALID, `invalid ADR format for ${adr.id}`);
  if (!checkGlobalIdUniqueness(manifest).isUnique || !checkStableOrdering(manifest).isStable) throw new RequirementManifestError(Code.ID_REUSE_FORBIDDEN, 'normative IDs are duplicated or reordered');
  const frIds = new Set(manifest.requirements.map((r) => r.id)), acIds = new Set(manifest.acceptanceCriteria.map((a) => a.id)), groups = new Set(manifest.dependencyGroups.map((g) => g.id));
  for (const ac of manifest.acceptanceCriteria) for (const ref of ac.requirementRefs) if (!frIds.has(ref)) throw new RequirementManifestError(Code.DANGLING_REFERENCE, `${ac.id} references missing requirement ${ref}`);
  for (const fr of manifest.requirements) { if (!groups.has(fr.dependencyGroup)) throw new RequirementManifestError(Code.DANGLING_REFERENCE, `${fr.id} references missing dependency group ${fr.dependencyGroup}`); for (const ref of fr.acceptanceCriteria) if (!acIds.has(ref)) throw new RequirementManifestError(Code.DANGLING_REFERENCE, `${fr.id} references missing acceptance criterion ${ref}`); }
  const dag = checkDependencyDagAcyclicity(manifest.dependencyGroups); if (!dag.isAcyclic) throw new RequirementManifestError(Code.DEPENDENCY_CYCLE, 'dependency-group DAG contains a cycle', { cycles: dag.cycles });
  if (prdText) { const lines = prdText.split(/\r?\n/); for (const item of [...manifest.requirements, ...manifest.acceptanceCriteria, ...manifest.invariants, ...manifest.adrs]) if (!item.line || !lines[item.line - 1]?.includes(item.id)) throw new RequirementManifestError(Code.ANCHOR_UNRESOLVED, `PRD line anchor for ${item.id} does not resolve`, { id: item.id, line: item.line }); }
}

export function validateRequirementManifest(options: ValidationOptions) {
  const manifest = getManifest(options); const prdText = options.prdPath ? readFileSync(options.prdPath, 'utf8') : undefined; validateData(manifest, prdText);
  if (options.auditPath) verifyFourWayCountAgreement({ manifestData: manifest, auditPath: options.auditPath });
  const hashes = { manifestSha256: options.manifestPath ? fileHash(options.manifestPath) : computeTextSha256(JSON.stringify(manifest)), documentSha256: options.prdPath ? fileHash(options.prdPath) : '', auditSha256: options.auditPath ? fileHash(options.auditPath) : '' };
  if (options.sha256sumsPath) { const expected = new Map(readFileSync(options.sha256sumsPath, 'utf8').trim().split(/\r?\n/).map((line) => { const [hash, file] = line.trim().split(/\s+/); return [file, hash]; })); for (const [file, hash] of [[options.manifestPath, hashes.manifestSha256], [options.prdPath, hashes.documentSha256], [options.auditPath, hashes.auditSha256]] as const) if (file && expected.get(basename(file)) !== hash) throw new RequirementManifestError(Code.ARTIFACT_HASH_MISMATCH, `SHA256SUMS mismatch for ${file}`); }
  return { isValid: true, hashes, findings: [] as string[] };
}
