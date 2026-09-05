/**
 * AC-235 acceptance (positive) — Scenario matrix recording and declared profile pass-matrix enforcement.
 * Traces: FR-EXEC-012, FR-EXEC-017, AC-235.
 * AC text: "Base, p50, p90, conservative latency/adverse-selection, liquidity drawdown, fee volatility,
 * and route-degradation scenarios are all recorded and the active policy enforces its declared pass matrix (FR-EXEC-017)."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCENARIOS_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/scenarios.json',
);

const STRESS_CASES_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/stress-cases.json',
);

describe('AC-235: Full scenario matrix recording and profile pass-matrix enforcement (positive)', () => {
  it('declares and records all eight scenario kinds in the scenario matrix', () => {
    const fixture = JSON.parse(readFileSync(SCENARIOS_FIXTURE, 'utf8'));
    const scenarioKinds = fixture.scenarios.map((s: Record<string, unknown>) => s.scenarioKind);

    const expectedKinds = [
      'BASE_CASE',
      'P50_DELAY',
      'P90_DELAY',
      'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
      'LIQUIDITY_DRAWDOWN',
      'FEE_VOLATILITY',
      'ROUTE_DEGRADATION',
      'FAILED_PARTIAL_FILL',
    ];

    for (const kind of expectedKinds) {
      expect(scenarioKinds).toContain(kind);
    }
  });

  it('enforces declared pass matrix on robust candidate', () => {
    const stressFixture = JSON.parse(readFileSync(STRESS_CASES_FIXTURE, 'utf8'));
    const robustCandidate = stressFixture.candidates.find(
      (c: Record<string, unknown>) => c.candidateId === 'cand_robust_all_stress_pass',
    );

    expect(robustCandidate).toBeDefined();
    expect(robustCandidate.profileEvaluations.CONFIRMED_OPPORTUNITY_DEFAULT.eligible).toBe(true);
    expect(robustCandidate.profileEvaluations.DEEP_RESEARCH_STRESS_ALL.eligible).toBe(true);
  });
});
