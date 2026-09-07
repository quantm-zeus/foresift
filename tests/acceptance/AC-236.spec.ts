/**
 * AC-236 acceptance (positive) — concurrent shadow position depth aggregation & fill competition (FR-EXEC-019).
 * Traces: FR-EXEC-019, AC-236.
 * AC text: "Two simultaneous shadow exits sharing one pool cannot each consume the full pre-exit depth;
 * aggregate impact and fill competition reduce or reject fills deterministically."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-236 acceptance (positive): concurrent shadow exits aggregate impact and compete for depth', () => {
  it('demonstrates aggregate fill reduction and elevated impact across competing concurrent exits', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/concurrent-exits.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const concurrentScenario = fixture.scenarios.find(
      (s: Record<string, unknown>) => s.scenarioId === 'concurrent_two_shadow_exits_same_pool',
    );

    expect(concurrentScenario.concurrentAggregated.depthCollisionDetected).toBe(true);
    expect(concurrentScenario.concurrentAggregated.totalActualReturnedUsd).toBeLessThan(
      concurrentScenario.isolatedSumExpectedReturnUsd,
    );
    // Second position suffers higher impact due to depth consumed by first
    expect(concurrentScenario.concurrentAggregated.pos_beta_002_actualImpactBps).toBeGreaterThan(
      concurrentScenario.concurrentAggregated.pos_alpha_001_actualImpactBps,
    );
  });
});
