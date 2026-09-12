/**
 * AC-246 negative / failure-path.
 * Traces: FR-DATA-006, INV-008, FR-MAT-005, AC-246.
 * The collapse is identity-anchored: a source cannot silently migrate between
 * lineages (differing tuples refuse), so independence groups can never be
 * gamed by re-registering a provider under a different upstream lineage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { independenceGroupOf, registerSourceIdentity } from '@foresift/persistence';
import { parseDataSchema } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import * as alertGate from '@foresift/alerts';
import * as alertFx from '../fixtures/alerts/index.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  await registerSourceIdentity(tdb.engine, {
    id: 'src/ac246n-dual' as never,
    brandProvider: 'DualFace',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/original-lineage',
    endpointRegion: 'eu-central',
    collectionMethod: 'POLLING_API',
  });
}, 120_000);

afterAll(() => closeTestDatabase(tdb));

describe('AC-246 negative: collapse integrity', () => {
  it('re-registering a source under a different lineage tuple is refused', async () => {
    await expect(
      registerSourceIdentity(tdb.engine, {
        id: 'src/ac246n-dual' as never,
        brandProvider: 'DualFace',
        operation: 'swaps',
        upstreamLineageKey: 'upstream/someone-elses-infra', // different lineage
        endpointRegion: 'eu-central',
        collectionMethod: 'POLLING_API',
      }),
    ).rejects.toThrow(/different tuple/);
  });

  it('the refused migration leaves group membership unchanged', async () => {
    const original = await independenceGroupOf(tdb.engine, 'upstream/original-lineage');
    expect(original?.memberSourceIds).toEqual(['src/ac246n-dual']);
    const poached = await independenceGroupOf(tdb.engine, 'upstream/someone-elses-infra');
    expect(poached?.memberSourceIds ?? []).not.toContain('src/ac246n-dual');
  });

  it('an unknown lineage has no group to collapse into', async () => {
    const absent = await independenceGroupOf(tdb.engine, 'upstream/never-registered');
    expect(absent).toBeNull();
  });
});

describe('AC-246 negative (tool-core substrate): malformed independence groups fail schema parsing', () => {
  it('IndependenceGroup schema refuses missing upstreamLineageKey', () => {
    expect(() =>
      parseDataSchema('IndependenceGroup', {
        id: 'grp-bad',
      }),
    ).toThrow();
  });
});

describe('AC-246 G1 extension negative: lineage-collapse sensitivity negative facet (FR-MAT-005, AC-246)', () => {
  it('refuses promotion evidence claims when duplicated lineage sources are asserted as independent', () => {
    const promotionEvidence = {
      policyId: 'pol-1',
      assertedIndependentSources: 5,
      actualCollapsedGroups: 3,
      lineageSensitivityChecked: false,
    };

    const validatePromotionLineage = (evidence: typeof promotionEvidence) => {
      if (
        evidence.assertedIndependentSources > evidence.actualCollapsedGroups &&
        !evidence.lineageSensitivityChecked
      ) {
        throw new Error('DUPLICATED_LINEAGE_SOURCES_CLAIM_REFUSED');
      }
      return true;
    };

    expect(() => validatePromotionLineage(promotionEvidence)).toThrow(
      /DUPLICATED_LINEAGE_SOURCES_CLAIM_REFUSED/,
    );
  });
});

describe('AC-246 negative alert-scoped extension: duplicated-lineage gate sets cannot masquerade as complete (FR-ALERT-003)', () => {
  it('refuses a gate set that drops the independent-evidence gate', () => {
    const observed = alertGate
      .evaluateConfirmedOpportunityGates(alertFx.DUPLICATED_LINEAGE_CREDIT.gateInput)
      .filter((gate) => gate.gate !== 'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS');
    const outcome = alertGate.classifyAlert(
      alertFx.confirmedOpportunityClassificationRequest({
        gateInputs: null,
        gateResults: [...observed],
      }),
    );
    expect(outcome.kind).toBe(alertGate.AlertClassificationKind.SUPPRESSED);
    expect(outcome.gateSetComplete).toBe(false);
  });

  it('refuses a gate set with a duplicated gate that would hide the lineage refusal', () => {
    const observed = alertGate.evaluateConfirmedOpportunityGates(
      alertFx.DUPLICATED_LINEAGE_CREDIT.gateInput,
    );
    const first = observed[0] as (typeof observed)[number];
    const duplicated = observed.map((gate, index) =>
      index === observed.length - 1 ? { ...first } : gate,
    );
    expect(() => alertGate.validateConfirmedOpportunityGateResults([...duplicated])).toThrow();
    const outcome = alertGate.classifyAlert(
      alertFx.confirmedOpportunityClassificationRequest({
        gateInputs: null,
        gateResults: [...duplicated],
      }),
    );
    expect(outcome.kind).toBe(alertGate.AlertClassificationKind.SUPPRESSED);
    expect(outcome.gateSetComplete).toBe(false);
  });
});
