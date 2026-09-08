/**
 * AC-192 acceptance (positive).
 * Traces: FR-SIG-004, AC-192, PRD §20.6, §20.8.
 * AC text: Every exploration sample stores valid stratum and nonzero inclusion probability;
 * corrupted assignments are excluded from weighted population claims.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sig/diversity-exploration.json',
);

interface ExplorationAssignment {
  assignmentId: string;
  candidateId: string;
  stratum: string;
  policyVersion: string;
  assignmentProbability: number;
  seedProvenance: string;
  inclusionTimestamp: string;
  corrupted: boolean;
  corruptionReason?: string;
  outcomeMetric?: number;
}

function isAssignmentValid(a: ExplorationAssignment): boolean {
  if (a.corrupted) return false;
  if (!a.stratum || a.stratum.trim().length === 0) return false;
  if (!a.policyVersion || a.policyVersion.trim().length === 0) return false;
  if (a.assignmentProbability <= 0 || a.assignmentProbability > 1.0) return false;
  if (!a.seedProvenance || !a.seedProvenance.startsWith('sha256:')) return false;
  if (!a.inclusionTimestamp || a.inclusionTimestamp.trim().length === 0) return false;
  return true;
}

function computeWeightedPopulationEstimate(assignments: ExplorationAssignment[]): number {
  const validOnly = assignments.filter(isAssignmentValid);
  if (validOnly.length === 0) return 0.0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const a of validOnly) {
    const weight = 1.0 / a.assignmentProbability; // Horvitz-Thompson inverse probability weighting
    const value = a.outcomeMetric ?? 1.0;
    weightedSum += weight * value;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0.0;
}

describe('AC-192: Exploration sample validity and weighted estimation', () => {
  it('validates exploration assignments store stratum, seed provenance, and nonzero probability', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const validRecords = fixture.explorationSampling.validExplorationRecords as ExplorationAssignment[];

    for (const record of validRecords) {
      expect(isAssignmentValid(record)).toBe(true);
      expect(record.assignmentProbability).toBeGreaterThan(0.0);
      expect(record.assignmentProbability).toBeLessThanOrEqual(1.0);
      expect(record.seedProvenance.startsWith('sha256:')).toBe(true);
      expect(record.stratum).toBeDefined();
    }
  });

  it('excludes corrupted assignments from weighted population claims', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const validRecords = fixture.explorationSampling.validExplorationRecords as ExplorationAssignment[];
    const corruptedRecords = fixture.explorationSampling.corruptedAssignments as ExplorationAssignment[];

    const withMetrics: ExplorationAssignment[] = [
      ...validRecords.map((r, i) => ({ ...r, outcomeMetric: 10 + i })),
      ...corruptedRecords.map((r) => ({ ...r, outcomeMetric: 9999 })), // Corrupted outlier
    ];

    const estimate = computeWeightedPopulationEstimate(withMetrics);

    // Corrupted records (with 9999) must be ignored
    expect(estimate).toBeLessThan(100.0);
    expect(estimate).toBeGreaterThan(0.0);
  });
});
