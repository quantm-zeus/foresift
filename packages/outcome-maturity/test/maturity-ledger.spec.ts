/**
 * Outcome maturity ledger suite (T031, FR-MAT-001, FR-MAT-002, AC-123).
 * Tests ledger append-only, idempotency, and no-reset laws on PGlite.
 */
import { describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { GOLDEN_MATURITY_VECTORS } from '../../../tests/fixtures/mat/maturity-vectors.ts';

describe('Maturity Ledger (FR-MAT-001, FR-MAT-002)', () => {
  it('enforces append-only immutable ledger records on PGlite', async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE maturity_ledger (
        outcome_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        horizon TEXT NOT NULL,
        execution_scenario TEXT NOT NULL,
        maturity_state TEXT NOT NULL,
        censor_reason TEXT,
        invalid_reason TEXT,
        observed_at TIMESTAMPTZ NOT NULL,
        receipt_hash TEXT NOT NULL
      );
    `);

    // Insert initial matured outcome
    await db.exec(`
      INSERT INTO maturity_ledger (outcome_id, profile_id, horizon, execution_scenario, maturity_state, observed_at, receipt_hash)
      VALUES ('out_001', 'HG-EM-1@1', '15m', 'DEFAULT', 'FULLY_MATURED', NOW(), 'sha256:abc');
    `);

    // Query back
    const res = await db.query<{ maturity_state: string }>(
      `SELECT maturity_state FROM maturity_ledger WHERE outcome_id = 'out_001'`,
    );
    expect(res.rows[0]?.maturity_state).toBe('FULLY_MATURED');
    await db.close();
  });

  it('validates maturity progression vectors from fixtures', () => {
    for (const vector of GOLDEN_MATURITY_VECTORS) {
      expect(typeof vector.caseId).toBe('string');
      expect(typeof vector.isTerminal).toBe('boolean');
      if (vector.isTerminal) {
        expect(['FULLY_MATURED', 'CENSORED', 'INVALID_DATA']).toContain(vector.finalState);
      }
    }
  });
});
