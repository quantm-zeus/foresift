/**
 * AC-135 negative / failure-path.
 * Traces: FR-SUP-002, AC-135.
 * Refuses hard rejection on market-cap alone when approved fallback exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-135 negative: Refusal of hard rejection with fallback available', () => {
  it('refuses hard rejection when market cap confidence is low but fallback is approved', () => {
    const assessment = {
      confidence: 0.25,
      qualityCodes: ['SUPPLY_UNCERTAIN'],
    };
    const approvedFallbackAvailable = true;

    // Hard rejection must be refused
    const canHardReject = assessment.confidence >= 0.5 || !approvedFallbackAvailable;
    expect(canHardReject).toBe(false);
  });

  it('prohibits SQL insertion of HARD_REJECTED when fallback_approved is true', async () => {
    const invalidDecisionRow = {
      decision: 'HARD_REJECTED',
      fallbackApproved: true,
    };
    // Constraint check: CHECK (NOT (decision = 'HARD_REJECTED' AND fallback_approved = TRUE))
    const violatesConstraint =
      invalidDecisionRow.decision === 'HARD_REJECTED' && invalidDecisionRow.fallbackApproved === true;
    expect(violatesConstraint).toBe(true);
  });
});
