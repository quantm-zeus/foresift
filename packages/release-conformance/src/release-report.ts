/** @requirement FR-TRACE-006 @acceptance AC-269 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReleaseReportRecordSchema } from '@foresift/shared-schemas';
import { generateSbomFromLockfile } from './sbom.ts';

const HASH = /^[a-f0-9]{64}$/;
const PREFIXED_HASH = /^sha256:[a-f0-9]{64}$/;

export interface ReleaseFinding {
  readonly requirementId: string;
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

export interface ReleaseReportRecord {
  readonly reportId: string;
  readonly documentHash: string;
  readonly manifestHash: string;
  readonly normalizedHash: string;
  readonly migrationHashes: Readonly<Record<string, string>>;
  readonly schemaHashes: Readonly<Record<string, string>>;
  readonly dependencySbomHash: string;
  readonly conformanceResults: {
    readonly overall: 'PASSED' | 'FAILED';
    readonly totalRulesEvaluated: number;
    readonly passedCount: number;
    readonly failureCount: number;
    readonly findings: readonly ReleaseFinding[];
  };
  readonly unresolvedDeviations: readonly {
    readonly id: string;
    readonly rule: string;
    readonly path: string;
    readonly justification: string;
    readonly expiryDate?: string;
  }[];
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

export interface BuildReleaseReportOptions {
  readonly repoRoot: string;
  readonly milestone: string;
  readonly previousReport: ReleaseReportRecord['rollbackTarget'];
  readonly conformanceResults?: ReleaseReportRecord['conformanceResults'];
  readonly deviations?: ReleaseReportRecord['unresolvedDeviations'];
  readonly gateEvidence?: readonly { gateKind?: string; isValid?: boolean }[];
  /** Deterministic clock override for reproducibility checks and historical rebuilds. */
  readonly fixedTimestamp?: string;
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function hashFiles(root: string, directory: string, predicate: (name: string) => boolean) {
  const absolute = path.join(root, directory);
  let names: string[] = [];
  try {
    names = (await readdir(absolute)).filter(predicate).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        directory === 'migrations' ? name : path.posix.join(directory, name),
        `sha256:${sha256(await readFile(path.join(absolute, name)))}`,
      ]),
    ),
  );
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

/** Builds the immutable report from released tree inputs; no wall-clock value is consulted. */
export async function buildReleaseReport(
  options: BuildReleaseReportOptions,
): Promise<ReleaseReportRecord> {
  const documentPath = path.join(
    options.repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md',
  );
  const manifestPath = path.join(
    options.repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
  );
  const auditPath = path.join(
    options.repoRoot,
    'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json',
  );
  const [document, manifest, audit, sbom, migrationHashes, schemaHashes] = await Promise.all([
    readFile(documentPath),
    readFile(manifestPath),
    readJson(auditPath),
    generateSbomFromLockfile(path.join(options.repoRoot, 'pnpm-lock.yaml')),
    hashFiles(options.repoRoot, 'migrations', (name) => name.endsWith('.sql')),
    hashFiles(options.repoRoot, 'packages/shared-schemas/src', (name) => name.endsWith('.ts')),
  ]);
  const documentHash = sha256(document);
  const manifestHash = sha256(manifest);
  const auditRecord = record(audit) ? audit : {};
  const auditHashes = record(auditRecord.hashes) ? auditRecord.hashes : {};
  const normalizedHash = auditHashes.documentNormalizedSha256;
  if (
    auditHashes.documentArtifactSha256 !== documentHash ||
    auditHashes.requirementManifestSha256 !== manifestHash ||
    typeof normalizedHash !== 'string' ||
    !HASH.test(normalizedHash)
  ) {
    throw new Error(
      'CONSISTENCY: released document/manifest hashes disagree with ADR-0023 audit provenance',
    );
  }

  const defaultConformance: ReleaseReportRecord['conformanceResults'] = {
    overall: 'PASSED',
    totalRulesEvaluated: 0,
    passedCount: 0,
    failureCount: 0,
    findings: [],
  };
  const conformanceResults = options.conformanceResults ?? defaultConformance;
  const gatesPassed = (options.gateEvidence ?? [])
    .filter((item) => item.isValid && item.gateKind)
    .map((item) => `gate:${item.gateKind!.toLowerCase().replace('_', '-')}`)
    .sort();
  const status = conformanceResults.overall === 'FAILED' ? 'BLOCKED' : 'ACTIVE';
  const stableIdentity = sha256(
    JSON.stringify({
      milestone: options.milestone,
      documentHash,
      manifestHash,
      normalizedHash,
      migrationHashes,
      schemaHashes,
      dependencySbomHash: sbom.inventoryHash,
      conformanceResults,
      deviations: options.deviations ?? [],
      gatesPassed,
      rollbackTarget: options.previousReport,
    }),
  );
  return {
    reportId: `rel-report-${options.milestone.toLowerCase()}-${stableIdentity.slice(0, 16)}`,
    documentHash,
    manifestHash,
    normalizedHash,
    migrationHashes,
    schemaHashes,
    dependencySbomHash: sbom.inventoryHash,
    conformanceResults,
    unresolvedDeviations: [...(options.deviations ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    activationState: {
      milestone: options.milestone,
      status,
      activeGroups: status === 'ACTIVE' ? [options.milestone] : [],
      gatesPassed,
    },
    rollbackTarget: options.previousReport,
    generatedAt: options.fixedTimestamp ?? `${String(auditRecord.auditDate)}T00:00:00.000Z`,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict structural/hash verifier. Pass expected hashes when verifying against a live tree. */
export function verifyReleaseReport(
  input: unknown,
  expected: Partial<
    Pick<
      ReleaseReportRecord,
      'documentHash' | 'manifestHash' | 'normalizedHash' | 'dependencySbomHash'
    >
  > = {},
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!record(input)) return { isValid: false, errors: ['report must be an object'] };
  const schemaResult = ReleaseReportRecordSchema.safeParse(input);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      const field = issue.path.length === 0 ? 'report' : issue.path.join('.');
      errors.push(`${field}: ${issue.message}`);
    }
  }
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
  ] as const;
  for (const field of required)
    if (input[field] === undefined || input[field] === null) errors.push(`${field} is required`);
  for (const field of [
    'documentHash',
    'manifestHash',
    'normalizedHash',
    'dependencySbomHash',
  ] as const) {
    const value = input[field];
    if (typeof value !== 'string' || !HASH.test(value) || /^0+$/.test(value))
      errors.push(`${field} must be a non-zero SHA-256 hash`);
    if (expected[field] !== undefined && expected[field] !== value)
      errors.push(`${field} disagrees with released artifact`);
  }
  for (const field of ['migrationHashes', 'schemaHashes'] as const) {
    if (!record(input[field])) errors.push(`${field} must be an object`);
    else
      for (const [name, hash] of Object.entries(input[field])) {
        if (
          !name ||
          typeof hash !== 'string' ||
          !PREFIXED_HASH.test(hash) ||
          /^sha256:0+$/.test(hash)
        )
          errors.push(`${field}.${name} must be a non-zero sha256: hash`);
      }
  }
  if (!record(input.conformanceResults)) errors.push('conformanceResults must be an object');
  else {
    for (const key of [
      'overall',
      'totalRulesEvaluated',
      'passedCount',
      'failureCount',
      'findings',
    ]) {
      if (input.conformanceResults[key] === undefined)
        errors.push(`conformanceResults.${key} is required`);
    }
    if (
      typeof input.conformanceResults.overall !== 'string' ||
      !['PASSED', 'FAILED'].includes(input.conformanceResults.overall)
    ) {
      errors.push('conformanceResults.overall is invalid');
    }
  }
  if (!Array.isArray(input.unresolvedDeviations))
    errors.push('unresolvedDeviations must be an array');
  if (!record(input.activationState)) errors.push('activationState must be an object');
  else
    for (const key of ['milestone', 'status', 'activeGroups', 'gatesPassed']) {
      if (input.activationState[key] === undefined)
        errors.push(`activationState.${key} is required`);
    }
  if (!record(input.rollbackTarget)) errors.push('rollbackTarget must be an object');
  else {
    for (const key of ['previousReportId', 'previousDocumentHash', 'previousManifestHash']) {
      if (input.rollbackTarget[key] === undefined) errors.push(`rollbackTarget.${key} is required`);
    }
    for (const key of ['previousDocumentHash', 'previousManifestHash']) {
      const value = input.rollbackTarget[key];
      if (typeof value !== 'string' || !HASH.test(value) || /^0+$/.test(value))
        errors.push(`rollbackTarget.${key} must be a non-zero SHA-256 hash`);
    }
  }
  return { isValid: errors.length === 0, errors };
}
