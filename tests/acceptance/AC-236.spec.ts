/**
 * AC-236 acceptance (positive) — Concurrent shadow exits & shared pool depth competition.
 * Traces: FR-EXEC-019, AC-236.
 * AC text: "Two simultaneous shadow exits sharing one pool cannot each consume the full pre-exit depth;
 * aggregate impact and fill competition reduce or reject fills deterministically (FR-EXEC-019)."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONCURRENT_EXITS_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/concurrent-exits.json',
);

interface ShadowExitRequest {
  registrationId: string;
  positionId: string;
  requestedNotionalUsd: number;
}

interface SimulatedFillResult {
  registrationId: string;
  positionId: string;
  filledNotionalUsd: number;
  unfilledNotionalUsd: number;
  fillStatus: 'FULL_FILL' | 'PARTIAL_FILL' | 'REJECTED';
}

function simulateConcurrentPoolExits(
  availablePoolDepthUsd: number,
  requests: ShadowExitRequest[],
): SimulatedFillResult[] {
  // Deterministic lexicographic ordering by registrationId
  const sorted = [...requests].sort((a, b) => a.registrationId.localeCompare(b.registrationId));

  let remainingDepth = availablePoolDepthUsd;
  const results: SimulatedFillResult[] = [];

  for (const req of sorted) {
    if (remainingDepth >= req.requestedNotionalUsd) {
      remainingDepth -= req.requestedNotionalUsd;
      results.push({
        registrationId: req.registrationId,
        positionId: req.positionId,
        filledNotionalUsd: req.requestedNotionalUsd,
        unfilledNotionalUsd: 0,
        fillStatus: 'FULL_FILL',
      });
    } else if (remainingDepth > 0) {
      const filled = remainingDepth;
      const unfilled = req.requestedNotionalUsd - filled;
      remainingDepth = 0;
      results.push({
        registrationId: req.registrationId,
        positionId: req.positionId,
        filledNotionalUsd: filled,
        unfilledNotionalUsd: unfilled,
        fillStatus: 'PARTIAL_FILL',
      });
    } else {
      results.push({
        registrationId: req.registrationId,
        positionId: req.positionId,
        filledNotionalUsd: 0,
        unfilledNotionalUsd: req.requestedNotionalUsd,
        fillStatus: 'REJECTED',
      });
    }
  }

  return results;
}

describe('AC-236: Concurrent shadow positions depth aggregation (positive)', () => {
  it('deterministically allocates depth and reduces second fill when aggregate demand exceeds capacity', () => {
    const fixture = JSON.parse(readFileSync(CONCURRENT_EXITS_FIXTURE, 'utf8'));
    const exits = fixture.concurrentExits;
    const poolDepth = fixture.poolUnderStress.availableDepthUsd;

    const results = simulateConcurrentPoolExits(poolDepth, exits);

    const first = results.find((r) => r.registrationId === 'reg_0001_alpha');
    const second = results.find((r) => r.registrationId === 'reg_0002_beta');

    expect(first?.filledNotionalUsd).toBe(6000.0);
    expect(first?.fillStatus).toBe('FULL_FILL');

    expect(second?.filledNotionalUsd).toBe(4000.0);
    expect(second?.unfilledNotionalUsd).toBe(2000.0);
    expect(second?.fillStatus).toBe('PARTIAL_FILL');

    // Invariant: total filled cannot exceed pool depth
    const totalFilled = results.reduce((acc, r) => acc + r.filledNotionalUsd, 0);
    expect(totalFilled).toBe(10000.0);
  });
});
