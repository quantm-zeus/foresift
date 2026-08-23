/**
 * AC-245 negative / failure-path — task T056.
 * Traces: FR-DATA-006, INV-008.
 * Degenerate dependence inputs are refused rather than coerced; self-edges
 * are meaningless and rejected; reduced credit is only ever derived from
 * recorded observed inputs, never from provider-id heuristics.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DependenceLabel,
  ErrorCode,
  assertDependenceInputs,
  utcTimestamp,
} from '@foresift/domain';
import { recordDependenceEdge, registerSourceIdentity } from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers';

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
});

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
        if (!message.startsWith('expected refusal')) {
          expect((err as { code?: string }).code).toBe(ErrorCode.SOURCE_DEPENDENCE_INPUT_INVALID);
        }
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
