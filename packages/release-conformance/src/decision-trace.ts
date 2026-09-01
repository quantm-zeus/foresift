/** @requirement FR-TRACE-005 @acceptance AC-267 */
import { createHash } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';

const DIMENSIONS = ['decisionRef', 'requirementIds', 'policyVersions', 'featureVersions', 'modelVersions',
  'toolVersions', 'providerVersions', 'adapterVersions', 'artifactVersions', 'testReleaseId',
  'conformanceReleaseId', 'manifestSha256', 'releaseReportId', 'recordedAt'] as const;
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export function assembleDecisionTrace(input: any): any {
  for (const dimension of DIMENSIONS) if (input?.[dimension] === undefined || input[dimension] === null) {
    throw new Error(`missing required dimension: ${dimension}`);
  }
  if (!/^[a-f0-9]{64}$/.test(input.manifestSha256)) {
    throw new Error('invalid hash format for manifestSha256');
  }
  const traceId = `trc-${createHash('sha256').update(canonical(input)).digest('hex')}`;
  return { traceId, ...input };
}
export async function recordDecisionTrace(engine: DatabaseEngine, trace: any): Promise<void> {
  await engine.query(`INSERT INTO trace.decision_traces
    (trace_id, decision_ref, requirement_ids, policy_versions, feature_versions, model_versions,
     tool_versions, provider_versions, adapter_versions, artifact_versions, test_release_id,
     conformance_release_id, manifest_sha256, release_report_id, recorded_at)
    VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)`,
  [trace.traceId, trace.decisionRef, JSON.stringify(trace.requirementIds), JSON.stringify(trace.policyVersions),
    JSON.stringify(trace.featureVersions), JSON.stringify(trace.modelVersions), JSON.stringify(trace.toolVersions),
    JSON.stringify(trace.providerVersions), JSON.stringify(trace.adapterVersions), JSON.stringify(trace.artifactVersions),
    trace.testReleaseId, trace.conformanceReleaseId, trace.manifestSha256, trace.releaseReportId, trace.recordedAt]);
}
function fromRow(row: any): any {
  if (!row) return undefined;
  return { traceId: row.trace_id, decisionRef: row.decision_ref, requirementIds: row.requirement_ids,
    policyVersions: row.policy_versions, featureVersions: row.feature_versions, modelVersions: row.model_versions,
    toolVersions: row.tool_versions, providerVersions: row.provider_versions, adapterVersions: row.adapter_versions,
    artifactVersions: row.artifact_versions, testReleaseId: row.test_release_id,
    conformanceReleaseId: row.conformance_release_id, manifestSha256: row.manifest_sha256,
    releaseReportId: row.release_report_id, recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : row.recorded_at };
}
export async function fetchDecisionTraceByRef(engine: DatabaseEngine, ref: string) {
  return fromRow((await engine.query('SELECT * FROM trace.decision_traces WHERE decision_ref = $1', [ref])).rows[0]);
}
export async function fetchDecisionTraceById(engine: DatabaseEngine, id: string) {
  return fromRow((await engine.query('SELECT * FROM trace.decision_traces WHERE trace_id = $1', [id])).rows[0]);
}
