/**
 * AC-247 negative / failure-path — task T056.
 * Traces: FR-DATA-006, INV-005.
 * A frozen historical evidence count cannot be moved by any later dependence
 * estimate, and the availability classifier refuses to bless late inputs as
 * available-at-the-time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcquisitionState,
  DependenceLabel,
  utcTimestamp,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  classifyInputsAvailability,
  maturedEvidenceCountAt,
  completeRetrieval,
  recordAcquisitionDecision,
  recordDependenceEdge,
  recordProbeAssignment,
  registerSourceIdentity,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const BOUNDARY: UtcTimestamp = utcTimestamp('2026-06-05T00:00:00Z');

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  await registerSourceIdentity(engine, {
    id: 'src/ac247n-a' as never,
    brandProvider: 'A',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/a',
    endpointRegion: 'eu-central',
    collectionMethod: 'POLLING_API',
  });
  await registerSourceIdentity(engine, {
    id: 'src/ac247n-b' as never,
    brandProvider: 'B',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/b',
    endpointRegion: 'eu-central',
    collectionMethod: 'POLLING_API',
  });
  // One frozen RETURNED retrieval maturing at the boundary.
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac247n-frozen',
    candidateId: 'cand/ac247n',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: utcTimestamp('2026-06-01T09:00:00Z'),
  });
  await recordProbeAssignment(engine, {
    decisionId: 'ac247n-frozen',
    assignment: {
      eligibilityStratum: 'stratum-a',
      assignmentProbability: 0.5,
      seedProvenance: 'seed/x',
      selectionAt: utcTimestamp('2026-06-01T09:00:01Z'),
      requestedFields: ['volume'],
    },
    estimatedDecisionImpact: 0.3,
  });
  await completeRetrieval(engine, {
    decisionId: 'ac247n-frozen',
    completedAt: utcTimestamp('2026-06-01T10:00:00Z'),
    state: AcquisitionState.RETURNED,
    evidenceIds: ['ev/ac247n/1'],
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-247 negative: frozen counts are immovable', () => {
  it('a retrospective estimate recorded after the boundary never moves the count', async () => {
    await recordDependenceEdge(tdb.engine, {
      edgeId: 'ac247n-retro-edge',
      edge: {
        sourceA: 'src/ac247n-a' as never,
        sourceB: 'src/ac247n-b' as never,
        sharedUpstreamLineageKeys: [],
        inputs: {
          valueErrorTimingCorrelation: 0.99,
          outageOverlap: 0.99,
          firstSeenLagAgreement: 0.99,
          fingerprintSimilarity: 0.99,
        },
        label: DependenceLabel.DIAGNOSTIC_RETROSPECTIVE,
        availableAt: utcTimestamp('2026-07-20T00:00:00Z'),
      },
    });
    expect(
      await maturedEvidenceCountAt(tdb.engine, { candidateId: 'cand/ac247n', t: BOUNDARY }),
    ).toBe(1); // exactly the pre-boundary RETURNED retrieval
  });

  it('the count stays frozen across repeated resolution', async () => {
    const first = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac247n',
      t: BOUNDARY,
    });
    const second = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac247n',
      t: BOUNDARY,
    });
    expect(second).toBe(first);
    expect(first).toBe(1);
  });

  it('the honest classifier refuses to bless late inputs as available-at-the-time', () => {
    expect(
      classifyInputsAvailability({
        inputsAvailableAt: '2026-07-01T00:00:00Z', // AFTER the edge availability
        edgeAvailableAt: '2026-06-20T00:00:00Z',
      }),
    ).not.toBe(DependenceLabel.AVAILABLE_AT_THE_TIME);
  });
});
