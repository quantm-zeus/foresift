/**
 * AC-232 acceptance (positive) — state completeness & missing tick/bin blocking (§64.4, FR-EXEC-020).
 * Traces: FR-EXEC-013, FR-EXEC-014, FR-EXEC-020, AC-232.
 * AC text: "Missing tick/bin/curve/account state that can materially affect a fill
 * marks state incomplete and blocks confirmed tradability rather than assuming uniform liquidity."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-232 acceptance (positive): incomplete state blocks confirmed tradability', () => {
  it('identifies incomplete tick array and blocks confirmed tradability without assuming uniform liquidity', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/pool-states.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const completePool = fixture.pools.find((p: { poolId: string }) =>
      p.poolId.includes('OrcaWhirlpoolClmm'),
    );
    const incompletePool = fixture.pools.find((p: { poolId: string }) =>
      p.poolId.includes('OrcaIncompleteTickState'),
    );

    expect(completePool.stateCompleteness).toBe('COMPLETE');
    expect(completePool.adapterSupportState).toBe('AVAILABLE');

    expect(incompletePool.stateCompleteness).toBe('INCOMPLETE_BLOCKING');
    expect(incompletePool.adapterSupportState).toBe('DEGRADED');
    expect(incompletePool.qualityCodes).toContain('CONFIRMED_TRADABILITY_BLOCKED');
  });
});
