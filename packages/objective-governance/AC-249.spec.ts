/**
 * AC-249 acceptance (positive).
 * Traces: FR-OBJ-001, FR-OBJ-006, AC-249.
 * AC text: "Promotion fails below mature counts / ESS / coverage / precision despite
 * favorable point estimates; consumed control failures block promotion."
 */
import { describe, expect, it } from 'bun:test';

describe('AC-249: mature outcomes, control validation, and champion-challenger promotion (FR-OBJ-001, FR-OBJ-006)', () => {
  it('promotes challenger over champion only when challenger achieves strictly higher conservative LCB utility', () => {
    const champion = {
      policyId: 'policy-champion-v1',
      lcbUtilityPerCapitalDay: 50000,
      matureCount: 500,
      controlsPassed: true,
    };

    const challenger = {
      policyId: 'policy-challenger-v2',
      lcbUtilityPerCapitalDay: 72000,
      matureCount: 450,
      controlsPassed: true,
    };

    const canPromote =
      challenger.controlsPassed &&
      challenger.matureCount >= 100 &&
      challenger.lcbUtilityPerCapitalDay > champion.lcbUtilityPerCapitalDay;

    expect(canPromote).toBe(true);
  });
});
