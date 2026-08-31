import { createHash } from 'node:crypto';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import type { DecisionTraceRecord } from '@foresift/shared-schemas';
export type { DecisionTraceRecord };
export type DecisionTraceInput = Omit<DecisionTraceRecord, 'traceId'>;
const REQUIRED = [
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
export function assembleDecisionTrace(input: DecisionTraceInput): DecisionTraceRecord {
  for (const dimension of REQUIRED) {
    const value = input?.[dimension];
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
    )
      throw new TypeError(`missing required dimension: ${dimension}`);
  }
  if (!/^[0-9a-f]{64}$/.test(input.manifestSha256))
    throw new TypeError('manifestSha256 must be a 64-character SHA-256');
  const traceId = `trc-${createHash('sha256').update(canonicalJson(input)).digest('hex')}`;
  return { traceId, ...input };
}
export async function recordDecisionTrace(engine: DatabaseEngine, trace: DecisionTraceRecord) {
  await engine.query(
    `INSERT INTO trace.decision_traces (trace_id,decision_ref,requirement_ids,policy_versions,feature_versions,model_versions,tool_versions,provider_versions,adapter_versions,artifact_versions,test_release_id,conformance_release_id,manifest_sha256,release_report_id,recorded_at) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)`,
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
interface Row {
  readonly trace_id: string;
  readonly decision_ref: string;
  readonly requirement_ids: string[];
  readonly policy_versions: Record<string, string>;
  readonly feature_versions: Record<string, string>;
  readonly model_versions: Record<string, string>;
  readonly tool_versions: Record<string, string>;
  readonly provider_versions: Record<string, string>;
  readonly adapter_versions: Record<string, string>;
  readonly artifact_versions: Record<string, string>;
  readonly test_release_id: string;
  readonly conformance_release_id: string;
  readonly manifest_sha256: string;
  readonly release_report_id: string;
  readonly recorded_at: string;
}
const fromRow = (r: Row): DecisionTraceRecord => ({
  traceId: r.trace_id,
  decisionRef: r.decision_ref,
  requirementIds: r.requirement_ids,
  policyVersions: r.policy_versions,
  featureVersions: r.feature_versions,
  modelVersions: r.model_versions,
  toolVersions: r.tool_versions,
  providerVersions: r.provider_versions,
  adapterVersions: r.adapter_versions,
  artifactVersions: r.artifact_versions,
  testReleaseId: r.test_release_id,
  conformanceReleaseId: r.conformance_release_id,
  manifestSha256: r.manifest_sha256,
  releaseReportId: r.release_report_id,
  recordedAt: r.recorded_at,
});
export async function fetchDecisionTraceByRef(engine: DatabaseEngine, decisionRef: string) {
  const result = await engine.query<Row>(
    'SELECT * FROM trace.decision_traces WHERE decision_ref=$1',
    [decisionRef],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}
export async function fetchDecisionTraceById(engine: DatabaseEngine, traceId: string) {
  const result = await engine.query<Row>('SELECT * FROM trace.decision_traces WHERE trace_id=$1', [
    traceId,
  ]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}
