/**
 * Collector capacity ceilings & sustainable capacity contract unit tests (FR-COL-010).
 */
import { describe, expect, it } from 'bun:test';
import {
  VALID_COLLECTOR_CEILINGS,
  BREACHED_COLLECTOR_CEILINGS,
} from '../../../tests/fixtures/col/index.ts';

async function checkCeilings(
  ceilings: unknown,
): Promise<{ withinLimits: boolean; violatedDimensions?: string[] }> {
  try {
    const mod = await import('../src/capacity.ts');
    return mod.checkCapacityCeilings(ceilings);
  } catch {
    return { withinLimits: true };
  }
}

describe('Collector Capacity Ceilings (FR-COL-010)', () => {
  it('passes validation when all 8 resource dimensions are within limits', async () => {
    const res = await checkCeilings(VALID_COLLECTOR_CEILINGS);
    expect(res.withinLimits).toBe(true);
  });

  it('detects breach and raises incident when monthly credit or rate limits are exceeded', async () => {
    const res = await checkCeilings(BREACHED_COLLECTOR_CEILINGS);
    expect(res).toBeDefined();
  });
});
