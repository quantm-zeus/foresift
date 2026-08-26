/**
 * Seam-stability proof (T503; milestone objective). The reference adapter
 * pair lives OUTSIDE packages/tool-core/src/**, implements BOTH extension-
 * point interfaces, and drives the reservation lifecycle end-to-end without
 * any edit to tool-core sources. A source-text sweep asserts tool-core src
 * contains no cost-table vocabulary — cost semantics belong to
 * g0-cost-capacity, behind the seam.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  ReferenceLicenseSource,
  ReferenceQuotaAdapter,
} from '../../../tests/fixtures/core/reference-adapters.ts';

const TOOL_CORE_SRC = join(import.meta.dirname, '../src');
const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url).pathname;

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('extension-point seams are implementable from outside the package', () => {
  it('the fixture module path is outside packages/tool-core/src', () => {
    const fixtureUrl = new URL(
      '../../../tests/fixtures/core/reference-adapters.ts',
      import.meta.url,
    ).pathname;
    expect(fixtureUrl.includes(join('packages', 'tool-core', 'src'))).toBe(false);
    expect(fixtureUrl.includes(join('tests', 'fixtures', 'core'))).toBe(true);
  });

  it('reference adapters drive reserve→commit through BOTH seams with zero src edits', async () => {
    const quota = new ReferenceQuotaAdapter(engine);
    const license = new ReferenceLicenseSource();

    const estimate = await quota.estimate({
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
    });
    const admission = await quota.admit({
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
      estimate,
    });
    expect(admission.allowed).toBe(true);

    const verdict = await license.verdict({
      licensePolicyId: 'rights-verified-only',
      provider: 'gmgn',
      operation: 'token_security',
      requestedVersion: estimate.quotaModel === 'REQUESTS_PER_PERIOD' ? 'rights-1' : 'rights-x',
    });
    expect(verdict.allowed).toBe(true);

    const reservationId = await quota.reserve({
      pipelineRunId: 'seam-run-1',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      actorId: 'actor-seam',
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
      estimate,
    });
    await quota.commit({ reservationId, actualUnits: estimate.estimatedUnits });

    const row = await engine.query<{ state: string; actual_units: string }>(
      `SELECT state, actual_units FROM core.core_quota_reservations WHERE reservation_id = $1`,
      [reservationId],
    );
    expect(row.rows[0]?.state).toBe('COMMITTED');

    // Release-after-commit is refused by the SAME guarded SQL — the adapter
    // cannot bypass the state machine it did not define.
    await expect(quota.release({ reservationId })).rejects.toMatchObject({
      code: 'QUOTA_RESERVATION_TRANSITION_ILLEGAL',
    });
  });
});

describe('tool-core src carries no cost-table vocabulary', () => {
  // Tokens that would indicate pricing/cost-table semantics leaking into the
  // seam package. The contract interface names (quota, estimate, units) are
  // deliberately NOT forbidden — the seam itself is quota-shaped.
  const FORBIDDEN = [
    /cost_table/i,
    /costTable/,
    /price_table/i,
    /priceTable/,
    /unit_price/i,
    /unitPrice/,
    /PRICE_BOOK/,
    /pricing_catalog/i,
  ];

  function* tsFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) yield* tsFiles(p);
      else if (entry.name.endsWith('.ts')) yield p;
    }
  }

  it('no forbidden token appears in any src file', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(TOOL_CORE_SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
