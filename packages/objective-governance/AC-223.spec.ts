/**
 * AC-223 acceptance (positive).
 * Traces: FR-OBJ-003, FR-OBJ-006, AC-223.
 * AC text: "Critical security, execution, rights, leakage, public-claim, capacity,
 * and tail-risk constraints are hard constraints applied before utility optimization;
 * no weighted score may compensate for a failed hard constraint. Detected integrity
 * failures block promotion."
 *
 * Driven by constraint-matrices.json and integrity-cases.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/obj',
);

const ALL_OBJ_CONSTRAINT_KINDS = [
  'CRITICAL_SECURITY',
  'EXECUTION_INTEGRITY',
  'RIGHTS_FENCING',
  'LEAKAGE_PREVENTION',
  'PUBLIC_CLAIM_BOUND',
  'CAPACITY_BOUND',
  'TAIL_RISK',
] as const;

const ALL_INTEGRITY_SIGNAL_KINDS = [
  'DENOMINATOR_GAMING',
  'SELECTIVE_UNIVERSE_CHANGE',
  'REDUCED_EXPLORATION',
  'DELAYED_OUTCOME_OMISSION',
  'HORIZON_SWITCHING',
  'SCENARIO_CHERRY_PICKING',
  'REPEATED_HOLDOUT_INSPECTION',
] as const;

describe('AC-223: seven-kind hard constraint evaluation precedes utility optimization and integrity enforcement (FR-OBJ-003, FR-OBJ-006)', () => {
  const constraintFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, 'constraint-matrices.json'), 'utf8'),
  );
  const integrityFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, 'integrity-cases.json'), 'utf8'),
  );

  it('evaluates all seven hard constraint kinds (FR-OBJ-003)', () => {
    expect(constraintFixture.kinds.length).toBe(7);
    expect(constraintFixture.kinds).toEqual(ALL_OBJ_CONSTRAINT_KINDS);

    const allPassing = constraintFixture.allPassingMatrix;
    for (const kind of ALL_OBJ_CONSTRAINT_KINDS) {
      expect(allPassing[kind].verdict).toBe('PASS');
    }
    expect(allPassing.overallPass).toBe(true);
  });

  it('evaluates all seven integrity detection signal categories (FR-OBJ-006)', () => {
    expect(integrityFixture.signals.length).toBe(7);
    expect(integrityFixture.signals).toEqual(ALL_INTEGRITY_SIGNAL_KINDS);

    for (const signal of ALL_INTEGRITY_SIGNAL_KINDS) {
      expect(integrityFixture.cases[signal]).toBeDefined();
      expect(integrityFixture.cases[signal].blocksPromotion).toBe(true);
    }
  });
});
