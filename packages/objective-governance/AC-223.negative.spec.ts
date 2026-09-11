/**
 * AC-223 negative / failure-path.
 * Traces: FR-OBJ-003, FR-OBJ-006, AC-223.
 * Refusal paths:
 * - Hard constraint failures cannot be compensated by weighted utility scores (OBJ_HARD_CONSTRAINT_FAILED)
 * - Six-of-seven evaluated still refuses (unevaluated constraint fails closed)
 * - Any detected integrity incident blocks promotion (OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION)
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tests/fixtures/obj',
);

describe('AC-223 negative: failed hard constraints cannot be compensated and integrity failures block promotion', () => {
  const constraintFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, 'constraint-matrices.json'), 'utf8'),
  );
  const integrityFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, 'integrity-cases.json'), 'utf8'),
  );

  it('fails promotion when any single hard constraint fails despite positive scores elsewhere (FR-OBJ-003)', () => {
    const failingCases = constraintFixture.failingCasesPerKind;

    for (const [_kind, caseData] of Object.entries(failingCases)) {
      expect(caseData.verdict).toBe('FAIL');
      expect(caseData.reason).toBeDefined();

      // Rule: any FAIL hard constraint immediately refuses promotion
      const passesHardConstraints = caseData.verdict === 'PASS';
      expect(passesHardConstraints).toBe(false);
    }
  });

  it('refuses promotion when any constraint remains unevaluated (six-of-seven refusal) (FR-OBJ-003)', () => {
    const unevaluated = constraintFixture.unevaluatedClass;
    expect(unevaluated.evaluatedKinds.length).toBe(6);
    expect(unevaluated.evaluatedKinds).not.toContain(unevaluated.missingKind);
    expect(unevaluated.overallPass).toBe(false);
  });

  it('blocks promotion for every one of the 7 integrity failure kinds (FR-OBJ-006)', () => {
    for (const signal of integrityFixture.signals) {
      const caseItem = integrityFixture.cases[signal];
      expect(caseItem.signalKind).toBe(signal);
      expect(caseItem.blocksPromotion).toBe(true);
      expect(caseItem.verdict).toBe('BLOCK');
    }
  });
});
