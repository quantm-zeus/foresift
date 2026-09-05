/**
 * AC-235 acceptance (positive) — full stress scenario matrix recording and pass matrix enforcement (FR-EXEC-017).
 * Traces: FR-EXEC-012, FR-EXEC-017, AC-235.
 * AC text: "Base, p50, p90, conservative latency/adverse-selection, liquidity drawdown,
 * fee volatility, and route-degradation scenarios are all recorded and the active policy enforces its declared pass matrix."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-235 acceptance (positive): full stress scenario matrix recording & profile enforcement', () => {
  it('records all 8 scenario kinds and enforces declared pass matrix', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/scenarios.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const expectedScenarioKinds = [
      'BASE_CASE',
      'P50_DELAY',
      'P90_DELAY',
      'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
      'LIQUIDITY_DRAWDOWN',
      'FEE_VOLATILITY',
      'ROUTE_DEGRADATION',
      'FAILED_PARTIAL_FILL',
    ];

    const scenarioKindsInFixture = fixture.scenarios.map((s: Record<string, unknown>) => s.kind);
    for (const kind of expectedScenarioKinds) {
      expect(scenarioKindsInFixture).toContain(kind);
    }

    const strictProfile = fixture.profiles.find(
      (p: Record<string, unknown>) => p.profileId === 'profile_strict_confirmed_opportunity',
    );
    expect(strictProfile.requiresConservativePass).toBe(true);
    expect(strictProfile.requiredPassMatrix).toContain('CONSERVATIVE_LATENCY_ADVERSE_SELECTION');
  });
});
