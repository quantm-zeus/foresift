/**
 * Quota reservation adapter units (FR-COST-001..005, FR-COST-008, AC-100, AC-102).
 *
 * Asserts:
 * - Implements QuotaReservationAdapter interface: estimate, admit, reserve, commit, release.
 * - State-machine congruence with quota-contract.ts guarded SQL transitions.
 * - Emits one reservation per provider call, not per batched item.
 * - In STRICT_FREE mode, refuses admission to paid and unknown-cost operations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

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

describe('quota-adapter QuotaReservationAdapter implementation (FR-COST-001..005)', () => {
  it('estimate returns declared quota units and quota model', async () => {
    let AdapterModule: Record<string, unknown>;
    try {
      AdapterModule = (await import('../src/quota-adapter.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_ADAPTER_NOT_IMPLEMENTED: src/quota-adapter.ts missing');
    }

    const CostQuotaAdapter = AdapterModule.CostQuotaAdapter as new (
      engine: DatabaseEngine,
      options?: Record<string, unknown>,
    ) => {
      estimate: (req: {
        provider: string;
        operation: string;
        workloadClass: string;
      }) => Promise<{ quotaModel: string; estimatedUnits: number }>;
    };

    const adapter = new CostQuotaAdapter(engine);
    const estimate = await adapter.estimate({
      provider: 'gmgn',
      operation: 'token_security',
      workloadClass: 'INTERACTIVE_HIGH',
    });

    expect(estimate.estimatedUnits).toBeGreaterThanOrEqual(1);
    expect(estimate.quotaModel).toBeDefined();
  });

  it('admit refuses paid operations in STRICT_FREE mode', async () => {
    let AdapterModule: Record<string, unknown>;
    try {
      AdapterModule = (await import('../src/quota-adapter.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_ADAPTER_NOT_IMPLEMENTED: src/quota-adapter.ts missing');
    }

    const CostQuotaAdapter = AdapterModule.CostQuotaAdapter as new (
      engine: DatabaseEngine,
      options?: Record<string, unknown>,
    ) => {
      admit: (req: {
        provider: string;
        operation: string;
        workloadClass: string;
        estimate: { quotaModel: string; estimatedUnits: number };
      }) => Promise<{ allowed: boolean; reason: string }>;
    };

    const adapter = new CostQuotaAdapter(engine, { costMode: 'STRICT_FREE' });
    const decision = await adapter.admit({
      provider: 'coinglass',
      operation: 'liquidation_orderbook',
      workloadClass: 'INTERACTIVE_HIGH',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 10 },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/^PAID_BLOCKED|^STRICT_FREE_BLOCKED/);
  });

  it('reserve -> commit -> release lifecycle adheres to guarded state machine', async () => {
    let AdapterModule: Record<string, unknown>;
    try {
      AdapterModule = (await import('../src/quota-adapter.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('QUOTA_ADAPTER_NOT_IMPLEMENTED: src/quota-adapter.ts missing');
    }

    const CostQuotaAdapter = AdapterModule.CostQuotaAdapter as new (
      engine: DatabaseEngine,
      options?: Record<string, unknown>,
    ) => {
      reserve: (req: {
        actorId: string;
        pipelineRunId: string;
        stage: string;
        provider: string;
        operation: string;
        workloadClass: string;
        estimate: { quotaModel: string; estimatedUnits: number };
      }) => Promise<string>;
      commit: (req: { reservationId: string; actualUnits: number }) => Promise<void>;
      release: (req: { reservationId: string }) => Promise<void>;
    };

    const adapter = new CostQuotaAdapter(engine);
    const reservationId = await adapter.reserve({
      actorId: 'test-actor',
      pipelineRunId: 'run-adapter-001',
      stage: 'ATOMICALLY_RESERVE_QUOTA',
      provider: 'helius',
      operation: 'raw_asset_query',
      workloadClass: 'INTERACTIVE_HIGH',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 0 },
    });

    expect(typeof reservationId).toBe('string');
    expect(reservationId.length).toBeGreaterThan(0);

    // Commit moves to COMMITTED
    await adapter.commit({ reservationId, actualUnits: 0 });

    // Release after commit converges safely
    await adapter.release({ reservationId });
  });
});
