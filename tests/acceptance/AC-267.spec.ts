/**
 * AC-267 acceptance (positive).
 * Traces: FR-TRACE-005.
 * AC text (manifest §39.25): "Every production decision/alert can be traced to exact
 * document/manifest hash, release, migration, policy, feature, model, tool, provider,
 * pool adapter, evidence, and alpha artifact versions."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  assembleDecisionTrace,
  recordDecisionTrace,
  fetchDecisionTraceByRef,
  fetchDecisionTraceById,
} from '@foresift/release-conformance';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';
import { VALID_DECISION_TRACE_INPUT } from '../fixtures/trace/index.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-267 acceptance (positive)', () => {
  it('records and traces every production decision dimension via point-in-time fetch', async () => {
    const trace = assembleDecisionTrace({
      ...VALID_DECISION_TRACE_INPUT,
      decisionRef: 'dec-ac267-acceptance-001',
    });

    await recordDecisionTrace(tdb.engine, trace);

    const fetched = await fetchDecisionTraceByRef(tdb.engine, 'dec-ac267-acceptance-001');

    expect(fetched).toBeDefined();
    expect(fetched?.traceId).toBe(trace.traceId);
    expect(fetched?.decisionRef).toBe('dec-ac267-acceptance-001');
    expect(fetched?.manifestSha256).toBe(VALID_DECISION_TRACE_INPUT.manifestSha256);
    expect(fetched?.requirementIds).toEqual(VALID_DECISION_TRACE_INPUT.requirementIds);
    expect(fetched?.policyVersions).toEqual(VALID_DECISION_TRACE_INPUT.policyVersions);
    expect(fetched?.featureVersions).toEqual(VALID_DECISION_TRACE_INPUT.featureVersions);
    expect(fetched?.modelVersions).toEqual(VALID_DECISION_TRACE_INPUT.modelVersions);
    expect(fetched?.toolVersions).toEqual(VALID_DECISION_TRACE_INPUT.toolVersions);
    expect(fetched?.providerVersions).toEqual(VALID_DECISION_TRACE_INPUT.providerVersions);
    expect(fetched?.adapterVersions).toEqual(VALID_DECISION_TRACE_INPUT.adapterVersions);
    expect(fetched?.artifactVersions).toEqual(VALID_DECISION_TRACE_INPUT.artifactVersions);
    expect(fetched?.testReleaseId).toBe(VALID_DECISION_TRACE_INPUT.testReleaseId);
    expect(fetched?.conformanceReleaseId).toBe(VALID_DECISION_TRACE_INPUT.conformanceReleaseId);
    expect(fetched?.releaseReportId).toBe(VALID_DECISION_TRACE_INPUT.releaseReportId);

    const fetchedById = await fetchDecisionTraceById(tdb.engine, trace.traceId);
    expect(fetchedById).toEqual(fetched);

    const fetchedAsOf = await fetchDecisionTraceByRef(
      tdb.engine,
      'dec-ac267-acceptance-001',
      '2026-08-31T09:00:00.000Z',
    );
    expect(fetchedAsOf?.traceId).toBe(trace.traceId);
  });
});
