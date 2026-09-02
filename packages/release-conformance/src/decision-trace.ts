/** Fail-closed, content-addressed production decision traces (FR-TRACE-005). */
import { createHash } from 'node:crypto';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';

export interface DecisionTraceInput {
  readonly decisionRef: string;
  readonly requirementIds: readonly string[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly featureVersions: Readonly<Record<string, string>>;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly providerVersions: Readonly<Record<string, string>>;
  readonly adapterVersions: Readonly<Record<string, string>>;
  readonly artifactVersions: Readonly<Record<string, string>>;
  readonly testReleaseId: string;
  readonly conformanceReleaseId: string;
  readonly manifestSha256: string;
  readonly releaseReportId: string;
  readonly recordedAt: string;
}

export interface DecisionTraceRecord extends DecisionTraceInput {
  readonly traceId: string;
}

const REQUIRED_MAPS = [
  'policyVersions',
  'featureVersions',
  'modelVersions',
  'toolVersions',
  'providerVersions',
  'adapterVersions',
  'artifactVersions',
] as const;

const REQUIRED_STRINGS = [
  'decisionRef',
  'testReleaseId',
  'conformanceReleaseId',
  'manifestSha256',
  'releaseReportId',
  'recordedAt',
] as const;

function missingDimension(dimension: string, detail?: string): never {
  throw new TypeError(
    `missing required dimension ${dimension}${detail === undefined ? '' : `: ${detail}`}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function assertVersionMap(
  dimension: (typeof REQUIRED_MAPS)[number],
  value: unknown,
): asserts value is Record<string, string> {
  if (!isPlainObject(value) || Object.keys(value).length === 0) missingDimension(dimension);
  for (const [name, version] of Object.entries(value)) {
    if (name.trim().length === 0 || typeof version !== 'string' || version.trim().length === 0) {
      missingDimension(dimension, 'every component name and version must be non-empty');
    }
  }
}

function isIsoInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function assertDecisionTraceInput(input: unknown): asserts input is DecisionTraceInput {
  if (!isPlainObject(input)) throw new TypeError('decision trace input must be an object');
  for (const dimension of REQUIRED_STRINGS) {
    const value = input[dimension];
    if (typeof value !== 'string' || value.trim().length === 0) missingDimension(dimension);
  }
  if (
    !Array.isArray(input.requirementIds) ||
    input.requirementIds.length === 0 ||
    input.requirementIds.some(
      (id) => typeof id !== 'string' || !/^FR-[A-Z][A-Z0-9]*-\d{3}$/.test(id),
    )
  ) {
    missingDimension('requirementIds', 'at least one valid requirement ID is required');
  }
  for (const dimension of REQUIRED_MAPS) assertVersionMap(dimension, input[dimension]);
  if (!/^[a-f0-9]{64}$/.test(input.manifestSha256 as string)) {
    missingDimension('manifestSha256', 'expected a lowercase SHA-256 digest');
  }
  if (!isIsoInstant(input.recordedAt as string)) {
    missingDimension('recordedAt', 'expected an ISO UTC instant');
  }
}

export function computeDecisionTraceId(input: DecisionTraceInput): string {
  return `trc-${createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex')}`;
}

export function assembleDecisionTrace(input: DecisionTraceInput): DecisionTraceRecord {
  assertDecisionTraceInput(input);
  const normalized: DecisionTraceInput = {
    decisionRef: input.decisionRef,
    requirementIds: [...input.requirementIds],
    policyVersions: { ...input.policyVersions },
    featureVersions: { ...input.featureVersions },
    modelVersions: { ...input.modelVersions },
    toolVersions: { ...input.toolVersions },
    providerVersions: { ...input.providerVersions },
    adapterVersions: { ...input.adapterVersions },
    artifactVersions: { ...input.artifactVersions },
    testReleaseId: input.testReleaseId,
    conformanceReleaseId: input.conformanceReleaseId,
    manifestSha256: input.manifestSha256,
    releaseReportId: input.releaseReportId,
    recordedAt: input.recordedAt,
  };
  return { traceId: computeDecisionTraceId(normalized), ...normalized };
}

function assertDecisionTraceRecord(record: unknown): asserts record is DecisionTraceRecord {
  assertDecisionTraceInput(record);
  const supplied = (record as Partial<DecisionTraceRecord>).traceId;
  if (typeof supplied !== 'string' || !/^trc-[a-f0-9]{64}$/.test(supplied)) {
    missingDimension('traceId', 'expected a content-addressed trace ID');
  }
  const { traceId: _traceId, ...content } = record as DecisionTraceRecord;
  const expected = computeDecisionTraceId(content);
  if (supplied !== expected) {
    throw new TypeError('decision trace traceId does not match its canonical content hash');
  }
}

export async function recordDecisionTrace(
  engine: DatabaseEngine,
  record: DecisionTraceRecord,
): Promise<void> {
  assertDecisionTraceRecord(record);
  await engine.query(
    `INSERT INTO trace.decision_traces
       (trace_id, decision_ref, requirement_ids, policy_versions, feature_versions,
        model_versions, tool_versions, provider_versions, adapter_versions,
        artifact_versions, test_release_id, conformance_release_id, manifest_sha256,
        release_report_id, recorded_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
             $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15::timestamptz)`,
    [
      record.traceId,
      record.decisionRef,
      canonicalJson(record.requirementIds),
      canonicalJson(record.policyVersions),
      canonicalJson(record.featureVersions),
      canonicalJson(record.modelVersions),
      canonicalJson(record.toolVersions),
      canonicalJson(record.providerVersions),
      canonicalJson(record.adapterVersions),
      canonicalJson(record.artifactVersions),
      record.testReleaseId,
      record.conformanceReleaseId,
      record.manifestSha256,
      record.releaseReportId,
      record.recordedAt,
    ],
  );
}

interface DecisionTraceRow {
  readonly trace_id: string;
  readonly decision_ref: string;
  readonly requirement_ids: readonly string[] | string;
  readonly policy_versions: Record<string, string> | string;
  readonly feature_versions: Record<string, string> | string;
  readonly model_versions: Record<string, string> | string;
  readonly tool_versions: Record<string, string> | string;
  readonly provider_versions: Record<string, string> | string;
  readonly adapter_versions: Record<string, string> | string;
  readonly artifact_versions: Record<string, string> | string;
  readonly test_release_id: string;
  readonly conformance_release_id: string;
  readonly manifest_sha256: string;
  readonly release_report_id: string;
  readonly recorded_at: string;
}

function parseJson<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function fromRow(row: DecisionTraceRow): DecisionTraceRecord {
  const record: DecisionTraceRecord = {
    traceId: row.trace_id,
    decisionRef: row.decision_ref,
    requirementIds: parseJson(row.requirement_ids),
    policyVersions: parseJson(row.policy_versions),
    featureVersions: parseJson(row.feature_versions),
    modelVersions: parseJson(row.model_versions),
    toolVersions: parseJson(row.tool_versions),
    providerVersions: parseJson(row.provider_versions),
    adapterVersions: parseJson(row.adapter_versions),
    artifactVersions: parseJson(row.artifact_versions),
    testReleaseId: row.test_release_id,
    conformanceReleaseId: row.conformance_release_id,
    manifestSha256: row.manifest_sha256,
    releaseReportId: row.release_report_id,
    recordedAt: row.recorded_at,
  };
  // SQL constraints protect the normal path, but callers may inject any
  // DatabaseEngine implementation. Never allow a malformed row to become an
  // apparently authorized production trace at this boundary.
  assertDecisionTraceInput(record);
  if (!/^trc-[a-f0-9]{64}$/.test(record.traceId)) {
    missingDimension('traceId', 'stored value is not a content address');
  }
  return record;
}

const TRACE_COLUMNS = `trace_id, decision_ref, requirement_ids, policy_versions,
  feature_versions, model_versions, tool_versions, provider_versions, adapter_versions,
  artifact_versions, test_release_id, conformance_release_id, manifest_sha256,
  release_report_id, recorded_at`;

export async function fetchDecisionTraceByRef(
  engine: DatabaseEngine,
  decisionRef: string,
  asOf?: string,
): Promise<DecisionTraceRecord | undefined> {
  if (typeof decisionRef !== 'string' || decisionRef.trim().length === 0) {
    missingDimension('decisionRef');
  }
  if (asOf !== undefined && !isIsoInstant(asOf))
    throw new TypeError('asOf must be an ISO UTC instant');
  const result = await engine.query<DecisionTraceRow>(
    `SELECT ${TRACE_COLUMNS} FROM trace.decision_traces
      WHERE decision_ref = $1 ${asOf === undefined ? '' : 'AND recorded_at <= $2::timestamptz'}
      ORDER BY recorded_at DESC, trace_id DESC LIMIT 1`,
    asOf === undefined ? [decisionRef] : [decisionRef, asOf],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : fromRow(row);
}

export async function fetchDecisionTraceById(
  engine: DatabaseEngine,
  traceId: string,
): Promise<DecisionTraceRecord | undefined> {
  if (!/^trc-[a-f0-9]{64}$/.test(traceId)) {
    missingDimension('traceId', 'expected a content-addressed trace ID');
  }
  const result = await engine.query<DecisionTraceRow>(
    `SELECT ${TRACE_COLUMNS} FROM trace.decision_traces WHERE trace_id = $1`,
    [traceId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : fromRow(row);
}
