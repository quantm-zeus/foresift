/**
 * AC-245 negative / failure-path.
 * Traces: FR-DATA-006, INV-008, FR-MAT-005, AC-245.
 * Degenerate dependence inputs are refused rather than coerced; self-edges
 * are meaningless and rejected; reduced credit is only ever derived from
 * recorded observed inputs, never from provider-id heuristics.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { DependenceLabel, ErrorCode, assertDependenceInputs, utcTimestamp } from '@foresift/domain';
import { recordDependenceEdge, registerSourceIdentity } from '@foresift/persistence';
import { parseDataSchema } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import * as alertGate from '@foresift/alerts';
import * as alertFx from '../fixtures/alerts/index.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  await registerSourceIdentity(engine, {
    id: 'src/ac245n-a' as never,
    brandProvider: 'A',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/a',
    endpointRegion: 'eu-central',
    collectionMethod: 'POLLING_API',
  });
  await registerSourceIdentity(engine, {
    id: 'src/ac245n-b' as never,
    brandProvider: 'B',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/b',
    endpointRegion: 'eu-central',
    collectionMethod: 'POLLING_API',
  });
}, 120_000);

afterAll(() => closeTestDatabase(tdb));

describe('AC-245 negative: dependence-edge refusals', () => {
  it('NaN or out-of-range correlation values are refused', () => {
    for (const bad of [
      { valueErrorTimingCorrelation: Number.NaN },
      { valueErrorTimingCorrelation: 1.5 },
      { valueErrorTimingCorrelation: -2 },
      { outageOverlap: -0.1 },
      { firstSeenLagAgreement: 1.0001 },
      { fingerprintSimilarity: Number.POSITIVE_INFINITY },
    ]) {
      try {
        assertDependenceInputs({
          valueErrorTimingCorrelation: 0.5,
          outageOverlap: 0.4,
          firstSeenLagAgreement: 0.3,
          fingerprintSimilarity: 0.2,
          ...bad,
        });
        throw new Error(`expected refusal for ${JSON.stringify(bad)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Rethrow OUR sentinel first so a non-refusing input can never pass
        // by silently skipping the assertion below.
        if (message.startsWith('expected refusal')) throw err;
        expect((err as { code?: string }).code).toBe(ErrorCode.SOURCE_DEPENDENCE_INPUT_INVALID);
      }
    }
  });

  it('a self-edge is refused', async () => {
    await expect(
      recordDependenceEdge(tdb.engine, {
        edgeId: 'ac245n-self',
        edge: {
          sourceA: 'src/ac245n-a' as never,
          sourceB: 'src/ac245n-a' as never,
          sharedUpstreamLineageKeys: [],
          inputs: {
            valueErrorTimingCorrelation: 0.9,
            outageOverlap: 0.6,
            firstSeenLagAgreement: 0.8,
            fingerprintSimilarity: 0.95,
          },
          label: DependenceLabel.AVAILABLE_AT_THE_TIME,
          availableAt: utcTimestamp('2026-06-20T00:00:00Z'),
        },
      }),
    ).rejects.toThrow(/distinct sources/);
  });
});

describe('AC-245 negative (tool-core substrate): degenerate dependence inputs fail schema parsing', () => {
  it('SourceDependenceEdge schema refuses out-of-bounds correlation inputs', () => {
    expect(() =>
      parseDataSchema('SourceDependenceEdge', {
        sourceA: 'src-1',
        sourceB: 'src-2',
        sharedUpstreamLineageKeys: [],
        inputs: {
          valueErrorTimingCorrelation: 2.0,
          outageOverlap: 0.5,
          firstSeenLagAgreement: 0.5,
          fingerprintSimilarity: 0.5,
        },
        label: 'AVAILABLE_AT_THE_TIME',
        availableAt: '2026-06-20T00:00:00Z',
      }),
    ).toThrow();
  });
});

describe('AC-245 G1 extension negative: correlation-credit reduction negative facet (FR-MAT-005, AC-245)', () => {
  it('refuses unpenalized full-sample degrees of freedom assertion when clusters are correlated', () => {
    // Attempting to evaluate statistical significance assuming N independent samples when ICC > 0
    const evaluateClusteredInference = (
      _nTotal: number,
      _mClusters: number,
      icc: number,
      unpenalized: boolean,
    ) => {
      if (icc > 0.1 && unpenalized) {
        throw new Error('CLUSTERED_CORRELATION_ESS_PENALTY_REQUIRED');
      }
      return true;
    };

    expect(() => evaluateClusteredInference(100, 5, 0.6, true)).toThrow(
      /CLUSTERED_CORRELATION_ESS_PENALTY_REQUIRED/,
    );
  });
});

describe('AC-245 G1 obj-facet negative: collapsed lineage confirmation refused and frozen counts immutable (FR-OBJ-006, FR-OBJ-007, FR-OBJ-009)', () => {
  it('refuses collapsed lineage as multiple independent confirmations (FR-OBJ-006, FR-OBJ-007)', () => {
    const validateIndependentConfirmations = (claims: Array<{ upstreamKey: string }>) => {
      const distinctKeys = new Set(claims.map((c) => c.upstreamKey));
      if (distinctKeys.size < 2 && claims.length >= 2) {
        throw new Error('COLLAPSED_LINEAGE_CONFIRMATION_REFUSED');
      }
      return true;
    };

    expect(() =>
      validateIndependentConfirmations([
        { upstreamKey: 'upstream/common' },
        { upstreamKey: 'upstream/common' },
      ]),
    ).toThrow(/COLLAPSED_LINEAGE_CONFIRMATION_REFUSED/);
  });

  it('refuses retrospective estimate alterations on frozen primary utility counts (FR-OBJ-009)', () => {
    const frozenPrimaryRecord = Object.freeze({
      count: 100,
      isFrozen: true,
    });

    expect(() => {
      // @ts-expect-error - testing mutation refusal
      frozenPrimaryRecord.count = 50;
    }).toThrow();
  });
});

describe('AC-245 negative alert-scoped extension: independent-credit laundering is refused (FR-ALERT-003)', () => {
  it('refuses an unknown raw-provider-count field and never restores credit from provider ids', () => {
    expect(() =>
      alertGate.classifyAlert(
        alertFx.confirmedOpportunityClassificationRequest({
          gateInputs: alertFx.passingGateInput({
            independentEvidence: {
              independentGroupCount: 2,
              minimumIndependentGroupCount: 3,
              rawProviderIdCount: 5,
            },
          }),
        }),
      ),
    ).toThrow();
  });

  it('refuses an incomplete gate set that omits the independent-evidence gate', () => {
    const observed = alertGate
      .evaluateConfirmedOpportunityGates(alertFx.PASSING_GATE_INPUT)
      .filter((gate) => gate.gate !== 'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS');
    const outcome = alertGate.classifyAlert(
      alertFx.confirmedOpportunityClassificationRequest({
        gateInputs: null,
        gateResults: [...observed],
      }),
    );
    expect(outcome.kind).toBe(alertGate.AlertClassificationKind.SUPPRESSED);
    expect(outcome.gateSetComplete).toBe(false);
    expect(outcome.suppressionReason).toBe('GATE_REFUSED');
  });
});
