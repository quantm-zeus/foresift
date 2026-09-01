/** Complete content-addressed decision authorization traces. @requirement FR-TRACE-005 */
import { createHash } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';

const DIMENSIONS = [
  'decisionRef',
  'requirementIds',
  'policyVersions',
  'featureVersions',
  'modelVersions',
  'toolVersions',
  'providerVersions',
  'adapterVersions',
  'artifactVersions',
  'testReleaseId',
  'conformanceReleaseId',
  'manifestSha256',
  'releaseReportId',
  'recordedAt',
] as const;

type TraceInput = Record<(typeof DIMENSIONS)[number], any>;
export type DecisionTraceRecord = TraceInput & { traceId: string };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

export function assembleDecisionTrace(input: TraceInput): DecisionTraceRecord {
  if (!input || typeof input !== 'object')
    throw new Error('missing required decision trace dimensions');
  const normalized: Record<string, unknown> = {};
  for (const dimension of DIMENSIONS) {
    const value = input[dimension];
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
    )
      throw new Error(`missing required dimension: ${dimension}`);
    normalized[dimension] = value;
  }
  if (!/^[0-9a-f]{64}$/.test(input.manifestSha256))
    throw new Error('manifestSha256 is an invalid hash');
  const traceId = `trc-${createHash('sha256').update(canonicalJson(normalized)).digest('hex')}`;
  return { traceId, ...(normalized as TraceInput) };
}

export async function recordDecisionTrace(engine: DatabaseEngine, trace: DecisionTraceRecord) {
  await engine.query(
    `INSERT INTO trace.decision_traces (
       trace_id, decision_ref, requirement_ids, policy_versions, feature_versions,
       model_versions, tool_versions, provider_versions, adapter_versions, artifact_versions,
       test_release_id, conformance_release_id, manifest_sha256, release_report_id, recorded_at
     ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)`,
    [
      trace.traceId,
      trace.decisionRef,
      JSON.stringify(trace.requirementIds),
      JSON.stringify(trace.policyVersions),
      JSON.stringify(trace.featureVersions),
      JSON.stringify(trace.modelVersions),
      JSON.stringify(trace.toolVersions),
      JSON.stringify(trace.providerVersions),
      JSON.stringify(trace.adapterVersions),
      JSON.stringify(trace.artifactVersions),
      trace.testReleaseId,
      trace.conformanceReleaseId,
      trace.manifestSha256,
      trace.releaseReportId,
      trace.recordedAt,
    ],
  );
}

function fromRow(row: any): DecisionTraceRecord {
  return {
    traceId: row.trace_id,
    decisionRef: row.decision_ref,
    requirementIds: row.requirement_ids,
    policyVersions: row.policy_versions,
    featureVersions: row.feature_versions,
    modelVersions: row.model_versions,
    toolVersions: row.tool_versions,
    providerVersions: row.provider_versions,
    adapterVersions: row.adapter_versions,
    artifactVersions: row.artifact_versions,
    testReleaseId: row.test_release_id,
    conformanceReleaseId: row.conformance_release_id,
    manifestSha256: row.manifest_sha256,
    releaseReportId: row.release_report_id,
    recordedAt: row.recorded_at,
  };
}

const SELECT = 'SELECT * FROM trace.decision_traces';
export async function fetchDecisionTraceByRef(engine: DatabaseEngine, decisionRef: string) {
  const result = await engine.query(`${SELECT} WHERE decision_ref = $1`, [decisionRef]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}
export async function fetchDecisionTraceById(engine: DatabaseEngine, traceId: string) {
  const result = await engine.query(`${SELECT} WHERE trace_id = $1`, [traceId]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}
