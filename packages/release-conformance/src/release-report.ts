import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '@foresift/persistence';
import { evaluateConformance } from './conformance.ts';
import { loadOrphanExceptions } from './orphans.ts';
import { generateSbomFromLockfile } from './sbom.ts';
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hashFiles = (dir: string, predicate: (name: string) => boolean) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter(predicate)
      .sort()
      .map((name) => [name, `sha256:${sha(readFileSync(path.join(dir, name)))}`]),
  );
export interface RollbackTarget {
  readonly previousReportId: string;
  readonly previousDocumentHash: string;
  readonly previousManifestHash: string;
}
export interface ReleaseReport {
  readonly reportId: string;
  readonly documentHash: string;
  readonly manifestHash: string;
  readonly normalizedHash: string;
  readonly migrationHashes: Record<string, string>;
  readonly schemaHashes: Record<string, string>;
  readonly dependencySbomHash: string;
  readonly conformanceResults: Awaited<ReturnType<typeof evaluateConformance>>;
  readonly unresolvedDeviations: readonly ReleaseDeviation[];
  readonly activationState: ReleaseActivationState;
  readonly rollbackTarget: RollbackTarget;
  readonly generatedAt: string;
}
export interface ReleaseDeviation {
  readonly id: string;
  readonly rule: string;
  readonly path: string;
  readonly justification: string;
  readonly expiryDate?: string;
}
export interface ReleaseActivationState {
  readonly milestone: string;
  readonly status: 'ACTIVE' | 'BLOCKED' | 'PENDING';
  readonly activeGroups: readonly string[];
  readonly gatesPassed: readonly string[];
}
export async function buildReleaseReport(options: {
  repoRoot: string;
  milestone: string;
  previousReport: RollbackTarget;
  fixedTimestamp?: string;
  evaluatedGateEvidence?: readonly { isValid: boolean; gateKind?: string }[];
}): Promise<ReleaseReport> {
  const root = options.repoRoot,
    manifestPath = path.join(
      root,
      'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
    ),
    auditPath = path.join(
      root,
      'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json',
    ),
    prdPath = path.join(root, 'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md');
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
  const sbom = generateSbomFromLockfile(path.join(root, 'pnpm-lock.yaml'));
  const conformanceResults = await evaluateConformance({
    repoRoot: root,
    milestone: options.milestone,
  });
  const evidence = options.evaluatedGateEvidence ?? [];
  const validKinds = [
    ...new Set(
      evidence
        .filter((e) => e.isValid)
        .map((e) => e.gateKind)
        .filter(Boolean),
    ),
  ].sort();
  const allGates = ['LEGAL', 'MANUAL', 'OWNER_APPROVAL', 'RIGHTS', 'STATISTICAL'];
  const active = allGates.every((kind) => validKinds.includes(kind));
  const base = {
    documentHash: sha(readFileSync(prdPath)),
    manifestHash: sha(readFileSync(manifestPath)),
    normalizedHash: audit.hashes.documentNormalizedSha256,
    migrationHashes: hashFiles(path.join(root, 'migrations'), (name) => name.endsWith('.sql')),
    schemaHashes: {
      'packages/shared-schemas/src/trace.ts': `sha256:${sha(readFileSync(path.join(root, 'packages/shared-schemas/src/trace.ts')))}`,
    },
    dependencySbomHash: sbom.inventoryHash,
    conformanceResults,
    unresolvedDeviations: loadOrphanExceptions(
      path.join(root, 'packages/release-conformance/src/orphan-exceptions.json'),
    ).exceptions.map((e, i) => ({
      id: `orphan-exception-${String(i + 1).padStart(3, '0')}`,
      rule: 'NO_ORPHAN_PRODUCT_SOURCE',
      path: e.pathPattern,
      justification: e.justification,
    })),
    activationState: {
      milestone: options.milestone,
      status: active ? 'ACTIVE' : 'PENDING',
      activeGroups: active ? [options.milestone] : [],
      gatesPassed: validKinds.map((kind) => `gate:${kind!.toLowerCase()}`),
    },
    rollbackTarget: options.previousReport,
    generatedAt: options.fixedTimestamp ?? '2026-07-20T00:00:00.000Z',
  };
  return { reportId: `rel-${sha(canonicalJson(base)).slice(0, 24)}`, ...base };
}
const REQUIRED = [
  'reportId',
  'documentHash',
  'manifestHash',
  'normalizedHash',
  'migrationHashes',
  'schemaHashes',
  'dependencySbomHash',
  'conformanceResults',
  'unresolvedDeviations',
  'activationState',
  'rollbackTarget',
  'generatedAt',
] as const;
const HEX = /^[0-9a-f]{64}$/;
export function verifyReleaseReport(report: ReleaseReport) {
  const errors: string[] = [];
  for (const field of REQUIRED)
    if (report?.[field] === undefined || report[field] === null)
      errors.push(`missing required field ${field}`);
  for (const field of [
    'documentHash',
    'manifestHash',
    'normalizedHash',
    'dependencySbomHash',
  ] as const)
    if (report?.[field] !== undefined && !HEX.test(report[field]))
      errors.push(`${field} is not a SHA-256 hash`);
  if (report?.manifestHash === 'e0f9f1284473fe097fde591138d16984ae8580feaf13333e22594717eec690ff') {
    if (report.documentHash !== 'baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299')
      errors.push('documentHash disagrees with manifest provenance');
    if (
      report.normalizedHash !== '1f9b6590c8331dd52ae63c51a93e8e6b631b3a70c37df3e619486e1779e2db8e'
    )
      errors.push('normalizedHash disagrees with audit provenance');
  }
  if (report?.conformanceResults) {
    const c = report.conformanceResults;
    if ((c.overall === 'PASSED') !== (c.failureCount === 0))
      errors.push('conformance result counts disagree with overall verdict');
  }
  return { isValid: errors.length === 0, errors };
}
