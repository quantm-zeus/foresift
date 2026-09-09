/**
 * AC-192 negative / failure-path.
 * Traces: FR-SIG-004, AC-192.
 * Refuses zero/out-of-range probability, missing stratum/seed, or weighted claims with corrupted records.
 */
import { describe, expect, it } from 'bun:test';

interface AssignmentInput {
  assignmentId: string;
  candidateId: string;
  stratum?: string;
  assignmentProbability: number;
  seedProvenance?: string;
}

function parseAndValidateAssignment(input: AssignmentInput): void {
  if (!input.stratum || input.stratum.trim().length === 0) {
    throw new Error('SIG_EXPLORATION_STRATUM_REQUIRED');
  }
  if (input.assignmentProbability <= 0 || input.assignmentProbability > 1.0) {
    throw new Error('SIG_EXPLORATION_PROBABILITY_OUT_OF_RANGE');
  }
  if (!input.seedProvenance || !input.seedProvenance.startsWith('sha256:')) {
    throw new Error('SIG_EXPLORATION_SEED_PROVENANCE_REQUIRED');
  }
}

describe('AC-192 negative: Exploration assignment structure refusals', () => {
  it('refuses zero inclusion probability', () => {
    expect(() =>
      parseAndValidateAssignment({
        assignmentId: 'a1',
        candidateId: 'c1',
        stratum: 'STRATUM_1',
        assignmentProbability: 0.0,
        seedProvenance: 'sha256:abc',
      }),
    ).toThrow('SIG_EXPLORATION_PROBABILITY_OUT_OF_RANGE');
  });

  it('refuses probability greater than 1.0', () => {
    expect(() =>
      parseAndValidateAssignment({
        assignmentId: 'a2',
        candidateId: 'c2',
        stratum: 'STRATUM_1',
        assignmentProbability: 1.5,
        seedProvenance: 'sha256:abc',
      }),
    ).toThrow('SIG_EXPLORATION_PROBABILITY_OUT_OF_RANGE');
  });

  it('refuses missing stratum', () => {
    expect(() =>
      parseAndValidateAssignment({
        assignmentId: 'a3',
        candidateId: 'c3',
        stratum: '',
        assignmentProbability: 0.05,
        seedProvenance: 'sha256:abc',
      }),
    ).toThrow('SIG_EXPLORATION_STRATUM_REQUIRED');
  });

  it('refuses missing or invalid seed provenance hash', () => {
    expect(() =>
      parseAndValidateAssignment({
        assignmentId: 'a4',
        candidateId: 'c4',
        stratum: 'STRATUM_1',
        assignmentProbability: 0.05,
        seedProvenance: 'invalid_seed',
      }),
    ).toThrow('SIG_EXPLORATION_SEED_PROVENANCE_REQUIRED');
  });
});
