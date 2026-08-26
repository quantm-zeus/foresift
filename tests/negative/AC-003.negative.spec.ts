/**
 * AC-003 negative / failure-path — single-flight lease fencing violation.
 * Traces: FR-CORE-006, INV-009.
 *
 * Asserts:
 * - A stale lease holder attempting release after expiry and takeover is refused
 *   fail-closed with a typed fencing error.
 * - Monotonic fencing tokens prevent race-condition state corruption.
 * - Releasing an already-released lease fails closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  SingleFlightManager,
  StaleFencingTokenError,
} from '../../packages/tool-core/src/single-flight.ts';
import { MIGRATIONS_DIR } from '../acceptance/helpers.ts';

let db: PGlite;
let engine: DatabaseEngine;

let NOW_MS = Date.parse('2026-08-01T00:00:00Z');
const now = () => new Date(NOW_MS).toISOString();
const advance = (seconds: number) => {
  NOW_MS += seconds * 1000;
};

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('AC-003 negative: stale-holder fencing violation refused (INV-009)', () => {
  it('refuses release from a stale holder whose lease expired and was re-acquired', async () => {
    const manager = new SingleFlightManager({ engine, now, defaultTtlSeconds: 60 });
    const resourceKey = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';

    // Holder 1 acquires lease at T0 with token 1
    const handle1 = await manager.acquire({
      resourceKeyHash: resourceKey,
      holderMode: 'CHATGPT',
      holderId: 'holder-chatgpt-1',
    });
    expect(handle1.fencingToken).toBe(1);

    // Time advances past the 60s TTL
    advance(65);

    // Holder 2 detects expired lease and acquires takeover with bumped token 2
    const handle2 = await manager.acquire({
      resourceKeyHash: resourceKey,
      holderMode: 'AUTOMATION',
      holderId: 'holder-automation-1',
    });
    expect(handle2.fencingToken).toBeGreaterThan(handle1.fencingToken);

    // Holder 1 (slow/stale) attempts to release with token 1 -> MUST BE REFUSED
    await expect(manager.release(handle1)).rejects.toBeInstanceOf(StaleFencingTokenError);
  });

  it('refuses release replay on an already released lease handle', async () => {
    const manager = new SingleFlightManager({ engine, now, defaultTtlSeconds: 60 });
    const resourceKey = 'sha256:4444444444444444444444444444444444444444444444444444444444444444';

    const handle = await manager.acquire({
      resourceKeyHash: resourceKey,
      holderMode: 'ADMIN_CHAT',
      holderId: 'holder-admin-1',
    });

    // First release succeeds
    await expect(manager.release(handle)).resolves.toBeUndefined();

    // Second release replay is refused
    await expect(manager.release(handle)).rejects.toBeInstanceOf(StaleFencingTokenError);
  });
});
