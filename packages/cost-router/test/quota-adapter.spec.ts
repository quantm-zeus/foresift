/**
 * Quota adapter unit tests (FR-COST-001, FR-COST-002, FR-COST-005, FR-COST-008, AC-100, AC-102).
 * Verifies QuotaReservationAdapter state-machine congruence with tool-core helpers:
 * estimate -> admit -> reserve -> commit / release, and guarded SQL idempotency.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import type { QuotaReservationAdapter } from '../../../packages/tool-core/src/quota-contract.ts';
import { CostQuotaAdapter } from '../src/quota-adapter.ts';
import { FREE_QUOTA_OP } from '../../../tests/fixtures/cost/operations.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let adapter: QuotaReservationAdapter;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  adapter = new CostQuotaAdapter({ engine, mode: 'STRICT_FREE' });
});

afterAll(async () => {
  await db.close();
});

describe('CostQuotaAdapter lifecycle', () => {
  it('estimates quota units from operation declaration', async () => {
    const estimate = await adapter.estimate({
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
    });

    expect(estimate.quotaModel).toBe('REQUESTS_PER_PERIOD');
    expect(estimate.estimatedUnits).toBe(1);
  });

  it('admits requests within quota and mode constraints', async () => {
    const estimate = await adapter.estimate({
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
    });

    const admission = await adapter.admit({
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
      estimate,
    });

    expect(admission.allowed).toBe(true);
  });

  it('reserves quota and returns reservationId', async () => {
    const estimate = { quotaModel: 'REQUESTS_PER_PERIOD' as const, estimatedUnits: 1 };
    const reservationId = await adapter.reserve({
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH',
      actorId: 'actor_alice',
      pipelineRunId: 'run_lifecycle_001',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      estimate,
    });

    expect(reservationId).toBeDefined();

    // Commit reservation
    await adapter.commit({ reservationId, actualUnits: 1 });
  });

  it('replaying reserve with identical (pipelineRunId, stage) is idempotent', async () => {
    const req = {
      provider: FREE_QUOTA_OP.providerId,
      operation: FREE_QUOTA_OP.operationId,
      workloadClass: 'INTERACTIVE_HIGH' as const,
      actorId: 'actor_alice',
      pipelineRunId: 'run_idempotent_002',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD' as const, estimatedUnits: 1 },
    };

    const rsv1 = await adapter.reserve(req);
    const rsv2 = await adapter.reserve(req);

    expect(rsv1).toBe(rsv2);
    await adapter.release({ reservationId: rsv1 });
  });
});
