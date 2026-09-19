import { createHash } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import { canonicalJson } from '@foresift/persistence';
import type { DecisionTraceRecord } from '@foresift/shared-schemas';
import { DecisionTraceRecordSchema } from '@foresift/shared-schemas';
import { ConformanceError, ConformanceErrorCode } from './errors.ts';

export type DecisionTraceInput = Omit<DecisionTraceRecord, 'traceId'>;
const REQUIRED_MAPS = [
  'policyVersions',
  'featureVersions',
  'modelVersions',
  'providerVersions',
  'adapterVersions',
  'artifactVersions',
] as const;

export function assembleDecisionTrace(input: Partial<DecisionTraceInput>): DecisionTraceRecord {
  const scalarDimensions = [
    'decisionRef',
    'recordedAt',
    'toolName',
    'toolVersion',
    'manifestSha256',
    'releaseReportId',
  ] as const;
  for (const dimension of scalarDimensions)
    if (typeof input[dimension] !== 'string' || input[dimension]?.length === 0)
      throw new ConformanceError(
        ConformanceErrorCode.DECISION_TRACE_INCOMPLETE,
        `missing dimension ${dimension}`,
        { dimension },
      );
  if (!Array.isArray(input.requirementIds) || input.requirementIds.length === 0)
    throw new ConformanceError(
      ConformanceErrorCode.DECISION_TRACE_INCOMPLETE,
      'missing dimension requirementIds',
      { dimension: 'requirementIds' },
    );
  for (const dimension of REQUIRED_MAPS)
    if (input[dimension] === undefined || Object.keys(input[dimension] ?? {}).length === 0)
      throw new ConformanceError(
        ConformanceErrorCode.DECISION_TRACE_INCOMPLETE,
        `missing dimension ${dimension}`,
        { dimension },
      );
  const content = input as DecisionTraceInput;
  const traceId = `sha256:${createHash('sha256').update(canonicalJson(content)).digest('hex')}`;
  const record = { ...content, traceId };
  const parsed = DecisionTraceRecordSchema.safeParse(record);
  if (!parsed.success)
    throw new ConformanceError(
      ConformanceErrorCode.DECISION_TRACE_INCOMPLETE,
      parsed.error.message,
    );
  return parsed.data;
}

export async function persistDecisionTrace(
  engine: DatabaseEngine,
  record: DecisionTraceRecord,
): Promise<void> {
  await engine.query(
    `INSERT INTO trace.decision_traces
      (trace_id, decision_ref, recorded_at, requirement_ids, policy_versions, feature_versions, model_versions,
       provider_versions, adapter_versions, artifact_versions, tool_name, tool_version, manifest_sha256, release_report_id)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14)`,
    [
      record.traceId,
      record.decisionRef,
      record.recordedAt,
      JSON.stringify(record.requirementIds),
      JSON.stringify(record.policyVersions),
      JSON.stringify(record.featureVersions),
      JSON.stringify(record.modelVersions),
      JSON.stringify(record.providerVersions),
      JSON.stringify(record.adapterVersions),
      JSON.stringify(record.artifactVersions),
      record.toolName,
      record.toolVersion,
      record.manifestSha256,
      record.releaseReportId,
    ],
  );
}

export async function fetchDecisionTraceAt(
  engine: DatabaseEngine,
  decisionRef: string,
  at: string,
): Promise<DecisionTraceRecord | null> {
  const result = await engine.query<Record<string, unknown>>(
    `SELECT trace_id AS "traceId", decision_ref AS "decisionRef", recorded_at AS "recordedAt",
       requirement_ids AS "requirementIds", policy_versions AS "policyVersions", feature_versions AS "featureVersions",
       model_versions AS "modelVersions", provider_versions AS "providerVersions", adapter_versions AS "adapterVersions",
       artifact_versions AS "artifactVersions", tool_name AS "toolName", tool_version AS "toolVersion",
       manifest_sha256 AS "manifestSha256", release_report_id AS "releaseReportId"
     FROM trace.decision_traces WHERE decision_ref=$1 AND recorded_at <= $2
     ORDER BY recorded_at DESC, trace_id DESC LIMIT 1`,
    [decisionRef, at],
  );
  const row = result.rows[0];
  return row === undefined ? null : DecisionTraceRecordSchema.parse(row);
}

export const createDecisionTrace = assembleDecisionTrace;
export const getDecisionTraceAt = fetchDecisionTraceAt;
