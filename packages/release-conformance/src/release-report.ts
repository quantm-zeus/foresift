import { createHash } from 'node:crypto';
import { canonicalJson } from '@foresift/persistence';
import { ConformanceError, ConformanceErrorCode } from './errors.ts';

const SHA = /^sha256:[0-9a-f]{64}$/;
const sha256 = (text: string): string =>
  `sha256:${createHash('sha256').update(text).digest('hex')}`;

export interface ReleaseReportBody {
  readonly schema: 'foresift/release-conformance-report@1';
  readonly documentHash: string;
  readonly normalizedDocumentHash: string;
  readonly manifestHash: string;
  readonly normalizedHashConsistency: 'CONSISTENT';
  readonly migrationHashes: Readonly<Record<string, string>>;
  readonly schemaHashes: Readonly<Record<string, string>>;
  readonly sbomHash: string;
  readonly dependencyHash: string;
  readonly conformanceResults: readonly unknown[];
  readonly unresolvedDeviations: readonly unknown[];
  readonly activationState: Readonly<Record<string, unknown>>;
  readonly rollbackTarget: string;
}
export interface ReleaseReport extends ReleaseReportBody {
  readonly reportId: string;
}
export interface ReleaseReportInput extends Omit<
  ReleaseReportBody,
  'schema' | 'normalizedHashConsistency'
> {
  readonly auditNormalizedDocumentHash?: string;
}

function requireHash(name: string, value: string): void {
  if (!SHA.test(value))
    throw new ConformanceError(
      ConformanceErrorCode.RELEASE_REPORT_INCOMPLETE,
      `${name} must be sha256:<hex>`,
      { field: name },
    );
}

export function buildReleaseReport(input: ReleaseReportInput): ReleaseReport {
  for (const field of [
    'documentHash',
    'normalizedDocumentHash',
    'manifestHash',
    'sbomHash',
    'dependencyHash',
  ] as const)
    requireHash(field, input[field]);
  if (
    input.auditNormalizedDocumentHash !== undefined &&
    input.auditNormalizedDocumentHash !== input.normalizedDocumentHash
  )
    throw new ConformanceError(
      ConformanceErrorCode.RELEASE_REPORT_HASH_MISMATCH,
      'manifest and audit normalized hashes disagree',
      { field: 'normalizedDocumentHash' },
    );
  if (!input.rollbackTarget)
    throw new ConformanceError(
      ConformanceErrorCode.RELEASE_REPORT_INCOMPLETE,
      'previous approved rollback report is required',
      { field: 'rollbackTarget' },
    );
  for (const [name, value] of [
    ...Object.entries(input.migrationHashes),
    ...Object.entries(input.schemaHashes),
  ])
    requireHash(name, value);
  const body: ReleaseReportBody = {
    schema: 'foresift/release-conformance-report@1',
    documentHash: input.documentHash,
    normalizedDocumentHash: input.normalizedDocumentHash,
    manifestHash: input.manifestHash,
    normalizedHashConsistency: 'CONSISTENT',
    migrationHashes: Object.fromEntries(Object.entries(input.migrationHashes).sort()),
    schemaHashes: Object.fromEntries(Object.entries(input.schemaHashes).sort()),
    sbomHash: input.sbomHash,
    dependencyHash: input.dependencyHash,
    conformanceResults: input.conformanceResults,
    unresolvedDeviations: input.unresolvedDeviations,
    activationState: input.activationState,
    rollbackTarget: input.rollbackTarget,
  };
  return { ...body, reportId: sha256(canonicalJson(body)) };
}

export function verifyReleaseReport(report: ReleaseReport): {
  readonly valid: true;
  readonly reportId: string;
} {
  const required = [
    'schema',
    'documentHash',
    'normalizedDocumentHash',
    'manifestHash',
    'normalizedHashConsistency',
    'migrationHashes',
    'schemaHashes',
    'sbomHash',
    'dependencyHash',
    'conformanceResults',
    'unresolvedDeviations',
    'activationState',
    'rollbackTarget',
    'reportId',
  ] as const;
  for (const field of required)
    if (report[field] === undefined || report[field] === null || report[field] === '')
      throw new ConformanceError(
        ConformanceErrorCode.RELEASE_REPORT_INCOMPLETE,
        `missing field ${field}`,
        { field },
      );
  const { reportId, ...body } = report;
  const expected = sha256(canonicalJson(body));
  if (reportId !== expected)
    throw new ConformanceError(
      ConformanceErrorCode.RELEASE_REPORT_HASH_MISMATCH,
      'report content hash disagrees',
      { field: 'reportId' },
    );
  if (report.normalizedHashConsistency !== 'CONSISTENT')
    throw new ConformanceError(
      ConformanceErrorCode.RELEASE_REPORT_HASH_MISMATCH,
      'normalized provenance is inconsistent',
      { field: 'normalizedHashConsistency' },
    );
  for (const field of [
    'documentHash',
    'normalizedDocumentHash',
    'manifestHash',
    'sbomHash',
    'dependencyHash',
    'reportId',
  ] as const)
    requireHash(field, report[field]);
  for (const [name, value] of [
    ...Object.entries(report.migrationHashes),
    ...Object.entries(report.schemaHashes),
  ])
    requireHash(name, value);
  return { valid: true, reportId };
}

export function serializeReleaseReport(report: ReleaseReport): string {
  verifyReleaseReport(report);
  return `${canonicalJson(report)}\n`;
}
