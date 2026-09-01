/** Deterministic FR-TRACE-006 release-report assembly and verification. @requirement FR-TRACE-006 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateSbomFromLockfile } from './sbom.ts';

const HASH = /^[0-9a-f]{64}$/;
const PREFIXED_HASH = /^sha256:[0-9a-f]{64}$/;
const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export interface ReleaseReportRecord {
  readonly reportId: string;
  readonly documentHash: string;
  readonly manifestHash: string;
  readonly normalizedHash: string;
  readonly migrationHashes: Record<string, string>;
  readonly schemaHashes: Record<string, string>;
  readonly dependencySbomHash: string;
  readonly conformanceResults: {
    readonly overall: 'PASSED' | 'FAILED';
    readonly totalRulesEvaluated: number;
    readonly passedCount: number;
    readonly failureCount: number;
    readonly findings: readonly unknown[];
  };
  readonly unresolvedDeviations: readonly unknown[];
  readonly activationState: {
    readonly milestone: string;
    readonly status: 'ACTIVE' | 'BLOCKED' | 'PENDING';
    readonly activeGroups: readonly string[];
    readonly gatesPassed: readonly string[];
  };
  readonly rollbackTarget: {
    readonly previousReportId: string;
    readonly previousDocumentHash: string;
    readonly previousManifestHash: string;
  };
  readonly generatedAt: string;
}

interface BuildOptions {
  readonly repoRoot: string;
  readonly milestone: string;
  readonly previousReport: ReleaseReportRecord['rollbackTarget'];
  readonly conformanceResults?: ReleaseReportRecord['conformanceResults'];
  readonly unresolvedDeviations?: readonly unknown[];
  readonly evaluatedGateEvidence?: readonly { gateId?: string; isValid: boolean }[];
}

async function hashesForDirectory(
  directory: string,
  include: (name: string) => boolean,
  key: (name: string) => string = (name) => name,
): Promise<Record<string, string>> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter(include).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        key(name),
        `sha256:${sha256(await readFile(path.join(directory, name)))}`,
      ]),
    ),
  );
}

export async function buildReleaseReport(options: BuildOptions): Promise<ReleaseReportRecord> {
  const specBase = path.join(
    options.repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0',
  );
  const audit = JSON.parse(await readFile(`${specBase}.audit.json`, 'utf8')) as {
    auditDate?: string;
    hashes?: Record<string, string>;
  };
  const manifestBytes = await readFile(`${specBase}.requirements.json`);
  const manifestHash = sha256(manifestBytes);
  const auditHashes = audit.hashes ?? {};
  const documentHash = auditHashes.documentArtifactSha256;
  const normalizedHash = auditHashes.documentNormalizedSha256;
  if (auditHashes.requirementManifestSha256 !== manifestHash) {
    throw new Error('CONSISTENCY_MANIFEST_AUDIT_HASH_MISMATCH');
  }
  if (!HASH.test(documentHash ?? '') || !HASH.test(normalizedHash ?? '')) {
    throw new Error('CONSISTENCY_AUDIT_HASH_PROVENANCE_MISSING');
  }

  const sbom = await generateSbomFromLockfile(path.join(options.repoRoot, 'pnpm-lock.yaml'));
  const migrationHashes = await hashesForDirectory(
    path.join(options.repoRoot, 'migrations'),
    (name) => name.endsWith('.sql'),
  );
  const schemaDirectory = path.join(options.repoRoot, 'packages/shared-schemas/src');
  const schemaHashes = await hashesForDirectory(
    schemaDirectory,
    (name) => name.endsWith('.ts'),
    (name) => `packages/shared-schemas/src/${name}`,
  );
  const conformanceResults = options.conformanceResults ?? {
    overall: 'PASSED' as const,
    totalRulesEvaluated: 0,
    passedCount: 0,
    failureCount: 0,
    findings: [],
  };
  let unresolvedDeviations = options.unresolvedDeviations;
  if (unresolvedDeviations === undefined) {
    try {
      const ledger = JSON.parse(
        await readFile(
          path.join(options.repoRoot, 'packages/release-conformance/src/orphan-exceptions.json'),
          'utf8',
        ),
      ) as {
        exceptions?: { pathPattern: string; justification: string; expiresAt?: string }[];
      };
      unresolvedDeviations = (ledger.exceptions ?? []).map((entry, index) => ({
        id: `orphan-exception-${String(index + 1).padStart(3, '0')}`,
        rule: 'ORPHAN_SOURCE_MAPPING_EXCEPTION',
        path: entry.pathPattern,
        justification: entry.justification,
        ...(entry.expiresAt ? { expiryDate: entry.expiresAt } : {}),
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      unresolvedDeviations = [];
    }
  }
  const gates = options.evaluatedGateEvidence ?? [];
  const invalidGate = gates.some((gate) => !gate.isValid);
  const activationState = {
    milestone: options.milestone,
    status: (invalidGate ? 'BLOCKED' : gates.length ? 'ACTIVE' : 'PENDING') as
      'ACTIVE' | 'BLOCKED' | 'PENDING',
    activeGroups: invalidGate ? [] : [options.milestone],
    gatesPassed: gates
      .filter((gate) => gate.isValid)
      .map((gate) => gate.gateId ?? 'gate:evaluated')
      .sort(),
  };
  const identity = sha256(
    JSON.stringify({
      milestone: options.milestone,
      documentHash,
      manifestHash,
      normalizedHash,
      migrationHashes,
      schemaHashes,
      dependencySbomHash: sbom.inventoryHash,
      conformanceResults,
      unresolvedDeviations,
      activationState,
      rollbackTarget: options.previousReport,
    }),
  );

  return {
    reportId: `rel-report-${options.milestone.toLowerCase()}-${identity.slice(0, 16)}`,
    documentHash,
    manifestHash,
    normalizedHash,
    migrationHashes,
    schemaHashes,
    dependencySbomHash: sbom.inventoryHash,
    conformanceResults,
    unresolvedDeviations: [...unresolvedDeviations],
    activationState,
    rollbackTarget: { ...options.previousReport },
    generatedAt: new Date(`${audit.auditDate ?? '1970-01-01'}T00:00:00.000Z`).toISOString(),
  };
}

export function verifyReleaseReport(report: unknown): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { isValid: false, errors: ['report must be an object'] };
  }
  const value = report as Record<string, unknown>;
  const required = [
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
  ];
  for (const field of required) {
    if (value[field] === undefined || value[field] === null || value[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }
  for (const field of ['documentHash', 'manifestHash', 'normalizedHash', 'dependencySbomHash']) {
    const hash = value[field];
    if (typeof hash !== 'string' || !HASH.test(hash) || /^0+$/.test(hash)) {
      errors.push(`${field} is not a valid non-zero SHA-256 hash`);
    }
  }
  for (const field of ['migrationHashes', 'schemaHashes']) {
    const entries = value[field];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      errors.push(`${field} must be a hash map`);
      continue;
    }
    for (const [name, hash] of Object.entries(entries)) {
      if (!PREFIXED_HASH.test(String(hash)) || /^sha256:0+$/.test(String(hash))) {
        errors.push(`${field}.${name} is not a valid SHA-256 hash`);
      }
    }
  }
  if (!Array.isArray(value.unresolvedDeviations))
    errors.push('unresolvedDeviations must be an array');
  else {
    for (const [index, deviation] of value.unresolvedDeviations.entries()) {
      const item = deviation as Record<string, unknown>;
      for (const field of ['id', 'rule', 'path', 'justification']) {
        if (!item?.[field]) errors.push(`unresolvedDeviations[${index}].${field} is required`);
      }
      if (item.expiryDate !== undefined && Number.isNaN(Date.parse(String(item.expiryDate))))
        errors.push(`unresolvedDeviations[${index}].expiryDate is invalid`);
    }
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    errors.push('generatedAt must be an ISO timestamp');
  }
  const rollback = value.rollbackTarget as Record<string, unknown> | undefined;
  for (const field of ['previousReportId', 'previousDocumentHash', 'previousManifestHash']) {
    if (!rollback || !rollback[field]) errors.push(`rollbackTarget.${field} is required`);
  }
  const conformance = value.conformanceResults as Record<string, unknown> | undefined;
  for (const field of [
    'overall',
    'totalRulesEvaluated',
    'passedCount',
    'failureCount',
    'findings',
  ]) {
    if (!conformance || conformance[field] === undefined)
      errors.push(`conformanceResults.${field} is required`);
  }
  const activation = value.activationState as Record<string, unknown> | undefined;
  for (const field of ['milestone', 'status', 'activeGroups', 'gatesPassed']) {
    if (!activation || activation[field] === undefined)
      errors.push(`activationState.${field} is required`);
  }
  return { isValid: errors.length === 0, errors };
}
