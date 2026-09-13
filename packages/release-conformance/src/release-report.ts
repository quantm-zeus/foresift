/** @requirement FR-TRACE-006 @acceptance AC-269 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReleaseReportRecordSchema } from '@foresift/shared-schemas';
import { generateSbomFromLockfile } from './sbom.ts';
import { loadOrphanExceptions } from './orphans.ts';
import {
  numericFilter,
  numericFromEntries,
  numericIncludes,
  numericMap,
  numericSome,
  numericSortStrings,
  numericSortWith,
  promiseAllNumeric,
} from './shadow-safe.ts';

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

type ReleaseDeviation = ReleaseReportRecord['unresolvedDeviations'][number];

export interface BuildReleaseReportOptions {
  readonly repoRoot: string;
  readonly milestone: string;
  readonly previousReport: ReleaseReportRecord['rollbackTarget'];
  readonly conformanceResults?: ReleaseReportRecord['conformanceResults'];
  readonly deviations?: ReleaseReportRecord['unresolvedDeviations'];
  readonly gateEvidence?: readonly {
    gateKind?: string;
    evidenceId?: string;
    isValid?: boolean;
    reason?: string;
  }[];
  /** Override the reviewed exception ledger, primarily for isolated repository projections. */
  readonly exceptionLedgerPath?: string;
  /** Deterministic clock override for reproducibility checks and historical rebuilds. */
  readonly fixedTimestamp?: string;
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function hashFiles(root: string, directory: string, predicate: (name: string) => boolean) {
  const absolute = path.join(root, directory);
  let names: string[] = [];
  try {
    // Numeric filter/sort only (audit HIGH): `.filter`/`.sort` are shadowable.
    names = numericSortStrings(numericFilter(await readdir(absolute), predicate));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // `numericFromEntries` never iterates (audit residual): `Object.fromEntries`
  // reads `Array.prototype[Symbol.iterator]` on the settled pair array, so a
  // surgical iterator could forge empty `migrationHashes`/`schemaHashes`.
  return numericFromEntries(
    await promiseAllNumeric(
      numericMap(names, async (name): Promise<[string, string]> => [
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
  const exceptionLedgerPath =
    options.exceptionLedgerPath ??
    path.join(options.repoRoot, 'packages/release-conformance/src/orphan-exceptions.json');
  // `promiseAllNumeric` (audit residual): `Promise.all` reads
  // `Array.prototype[Symbol.iterator]` on its ARGUMENT, so a surgical iterator
  // could forge an empty document/manifest before the numeric reads below hash
  // them (`documentHash === sha256('')`).
  const settled = await promiseAllNumeric([
    readFile(documentPath),
    readFile(manifestPath),
    readJson(auditPath),
    generateSbomFromLockfile(path.join(options.repoRoot, 'pnpm-lock.yaml')),
    hashFiles(options.repoRoot, 'migrations', (name) => name.endsWith('.sql')),
    hashFiles(options.repoRoot, 'packages/shared-schemas/src', (name) => name.endsWith('.ts')),
    loadOrphanExceptions(exceptionLedgerPath),
  ]);
  // Numeric-index selection (audit N2): destructuring the settled array reads
  // `Array.prototype[Symbol.iterator]`, so a surgical iterator could substitute
  // forged inputs (for example an empty document/manifest) before hashing.
  const document = settled[0];
  const manifest = settled[1];
  const audit = settled[2];
  const sbom = settled[3];
  const migrationHashes = settled[4];
  const schemaHashes = settled[5];
  const exceptionLedger = settled[6];
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
  const gateEvidence = options.gateEvidence ?? [];
  // Numeric-index aggregation only (audit HIGH): `filter`/`map`/`sort`/`some`
  // are all shadowable in-process, and an emptied pass/refusal set would let a
  // refused evidence set produce an ACTIVE activation state.
  const passingGates: string[] = [];
  for (let index = 0; index < gateEvidence.length; index += 1) {
    const item = gateEvidence[index];
    if (item !== undefined && item.isValid && item.gateKind)
      passingGates[passingGates.length] = `gate:${item.gateKind.toLowerCase().replace('_', '-')}`;
  }
  const gatesPassed = numericSortStrings(passingGates);
  const ledgerDeviations: ReleaseDeviation[] = numericMap(
    exceptionLedger.exceptions,
    (exception) => ({
      id: `orphan-exception:${exception.pathPattern}`,
      rule: 'ORPHAN_EXCEPTION',
      path: exception.pathPattern,
      justification: exception.justification,
    }),
  );
  const refusedEvidence: ReleaseDeviation[] = [];
  let refusedIndex = 0;
  for (let index = 0; index < gateEvidence.length; index += 1) {
    const evidence = gateEvidence[index];
    if (evidence === undefined || evidence.isValid) continue;
    refusedEvidence[refusedEvidence.length] = {
      id: evidence.evidenceId ?? `gate-evidence:${refusedIndex}`,
      rule: 'GATE_EVIDENCE_REFUSED',
      path: evidence.gateKind ? `gate:${evidence.gateKind}` : 'gate:unknown',
      justification: evidence.reason ?? 'gate evidence did not pass evaluation',
    };
    refusedIndex += 1;
  }
  const combinedDeviations: ReleaseDeviation[] = [];
  const deviationSources: readonly (readonly ReleaseDeviation[])[] = [
    ledgerDeviations,
    refusedEvidence,
    options.deviations ?? [],
  ];
  for (let sourceIndex = 0; sourceIndex < deviationSources.length; sourceIndex += 1) {
    const source = deviationSources[sourceIndex] as readonly ReleaseDeviation[];
    for (let index = 0; index < source.length; index += 1) {
      combinedDeviations[combinedDeviations.length] = source[index] as ReleaseDeviation;
    }
  }
  const unresolvedDeviations = numericSortWith(
    combinedDeviations,
    (left, right) => compareText(left.id, right.id) || compareText(left.path, right.path),
  );
  const status: ReleaseReportRecord['activationState']['status'] =
    conformanceResults.overall === 'FAILED' ||
    numericSome(gateEvidence, (item) => item.isValid !== true)
      ? 'BLOCKED'
      : gateEvidence.length === 0
        ? 'PENDING'
        : 'ACTIVE';
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
      deviations: unresolvedDeviations,
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
    unresolvedDeviations,
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
    // Numeric-index walk only (audit HIGH): a shadowed iterator would collect
    // zero schema issues and declare a structurally invalid report valid.
    for (let issueIndex = 0; issueIndex < schemaResult.error.issues.length; issueIndex += 1) {
      const issue = schemaResult.error.issues[
        issueIndex
      ] as (typeof schemaResult.error.issues)[number];
      const field = issue.path.length === 0 ? 'report' : issue.path.join('.');
      errors[errors.length] = `${field}: ${issue.message}`;
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
  for (let fieldIndex = 0; fieldIndex < required.length; fieldIndex += 1) {
    const field = required[fieldIndex] as (typeof required)[number];
    if (input[field] === undefined || input[field] === null)
      errors[errors.length] = `${field} is required`;
  }
  const hashFields = [
    'documentHash',
    'manifestHash',
    'normalizedHash',
    'dependencySbomHash',
  ] as const;
  for (let fieldIndex = 0; fieldIndex < hashFields.length; fieldIndex += 1) {
    const field = hashFields[fieldIndex] as (typeof hashFields)[number];
    const value = input[field];
    if (typeof value !== 'string' || !HASH.test(value) || /^0+$/.test(value))
      errors[errors.length] = `${field} must be a non-zero SHA-256 hash`;
    if (expected[field] !== undefined && expected[field] !== value)
      errors[errors.length] = `${field} disagrees with released artifact`;
  }
  const hashMaps = ['migrationHashes', 'schemaHashes'] as const;
  for (let fieldIndex = 0; fieldIndex < hashMaps.length; fieldIndex += 1) {
    const field = hashMaps[fieldIndex] as (typeof hashMaps)[number];
    if (!record(input[field])) {
      errors[errors.length] = `${field} must be an object`;
      continue;
    }
    const names = Object.keys(input[field]);
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      const name = names[nameIndex] as string;
      const hash = (input[field] as Record<string, unknown>)[name];
      if (
        !name ||
        typeof hash !== 'string' ||
        !PREFIXED_HASH.test(hash) ||
        /^sha256:0+$/.test(hash)
      )
        errors[errors.length] = `${field}.${name} must be a non-zero sha256: hash`;
    }
  }
  if (!record(input.conformanceResults))
    errors[errors.length] = 'conformanceResults must be an object';
  else {
    const conformanceKeys = [
      'overall',
      'totalRulesEvaluated',
      'passedCount',
      'failureCount',
      'findings',
    ] as const;
    for (let keyIndex = 0; keyIndex < conformanceKeys.length; keyIndex += 1) {
      const key = conformanceKeys[keyIndex] as (typeof conformanceKeys)[number];
      if (input.conformanceResults[key] === undefined)
        errors[errors.length] = `conformanceResults.${key} is required`;
    }
    if (
      typeof input.conformanceResults.overall !== 'string' ||
      !numericIncludes(['PASSED', 'FAILED'], input.conformanceResults.overall)
    ) {
      errors[errors.length] = 'conformanceResults.overall is invalid';
    }
  }
  if (!Array.isArray(input.unresolvedDeviations))
    errors[errors.length] = 'unresolvedDeviations must be an array';
  if (!record(input.activationState)) errors[errors.length] = 'activationState must be an object';
  else {
    const activationKeys = ['milestone', 'status', 'activeGroups', 'gatesPassed'] as const;
    for (let keyIndex = 0; keyIndex < activationKeys.length; keyIndex += 1) {
      const key = activationKeys[keyIndex] as (typeof activationKeys)[number];
      if (input.activationState[key] === undefined)
        errors[errors.length] = `activationState.${key} is required`;
    }
  }
  if (!record(input.rollbackTarget)) errors[errors.length] = 'rollbackTarget must be an object';
  else {
    const rollbackKeys = [
      'previousReportId',
      'previousDocumentHash',
      'previousManifestHash',
    ] as const;
    for (let keyIndex = 0; keyIndex < rollbackKeys.length; keyIndex += 1) {
      const key = rollbackKeys[keyIndex] as (typeof rollbackKeys)[number];
      if (input.rollbackTarget[key] === undefined)
        errors[errors.length] = `rollbackTarget.${key} is required`;
    }
    const rollbackHashKeys = ['previousDocumentHash', 'previousManifestHash'] as const;
    for (let keyIndex = 0; keyIndex < rollbackHashKeys.length; keyIndex += 1) {
      const key = rollbackHashKeys[keyIndex] as (typeof rollbackHashKeys)[number];
      const value = input.rollbackTarget[key];
      if (typeof value !== 'string' || !HASH.test(value) || /^0+$/.test(value))
        errors[errors.length] = `rollbackTarget.${key} must be a non-zero SHA-256 hash`;
    }
  }
  return { isValid: errors.length === 0, errors };
}
