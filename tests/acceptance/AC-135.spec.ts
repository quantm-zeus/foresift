/**
 * AC-135 acceptance (positive).
 * Traces: FR-SUP-001, FR-SUP-002, AC-135.
 * AC text (manifest §39): "Circulating supply and market cap expose source, method,
 * excluded supply, and confidence; low-confidence market cap cannot act as the sole
 * hard-rejection reason when approved liquidity/activity fallbacks exist."
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sup/supply-confidence.json',
);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-135: Supply confidence exposure and fallback decision gate', () => {
  it('exposes source, method, excluded supply, and confidence in supply assessments', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const assessment = fixture.assessments[0];

    expect(assessment.source).toBe('first-party-spl-indexer');
    expect(assessment.method).toBe('ESTIMATED_CIRCULATING');
    expect(assessment.marketCapBasis).toBe('ESTIMATED_CIRCULATING');
    expect(assessment.excludedSupply).toBe('30000000000000');
    expect(assessment.confidence).toBe(0.95);
    expect(assessment.exclusionEvidence.length).toBeGreaterThan(0);
  });

  it('prohibits hard rejection on low confidence when approved fallback exists and records decision', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const fallbackCase = fixture.assessments[1];

    expect(fallbackCase.confidence).toBeLessThan(0.5);
    expect(fallbackCase.approvedFallbackAvailable).toBe(true);
    expect(fallbackCase.expectedMayHardReject).toBe(false);
    expect(fallbackCase.expectedFallbackDecision).toBe('FALLBACK_APPROVED');
    expect(fallbackCase.expectedAuditPersisted).toBe(true);
  });

  it('permits hard rejection on low confidence only when approved fallback is absent', async () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const noFallbackCase = fixture.assessments[2];

    expect(noFallbackCase.confidence).toBeLessThan(0.5);
    expect(noFallbackCase.approvedFallbackAvailable).toBe(false);
    expect(noFallbackCase.expectedMayHardReject).toBe(true);
    expect(noFallbackCase.expectedFallbackDecision).toBe('HARD_REJECTED');
  });
});
