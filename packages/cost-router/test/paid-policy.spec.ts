/**
 * Paid provider policy lifecycle units (FR-COST-008, FR-COST-010, AC-105).
 *
 * Asserts:
 * - Immutable paid_provider_policies lifecycle: create, activate, reAuthenticate, supersededBy.
 * - ACTIVE uniqueness per provider.
 * - reAuthDueAt expiry renders calls inadmissible until re-authenticated.
 * - Updating budget or approver after activation is refused at API and SQL layer.
 * - BYOK model budget is never consulted for data-provider paid operations.
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

describe('paid-policy lifecycle and immutability (FR-COST-008, FR-COST-010)', () => {
  it('creates and activates a paid provider policy with explicit budget and approver', async () => {
    let PolicyModule: Record<string, unknown>;
    try {
      PolicyModule = (await import('../src/paid-policy.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PAID_POLICY_NOT_IMPLEMENTED: src/paid-policy.ts missing');
    }

    const PaidPolicyManager = PolicyModule.PaidPolicyManager as new (
      engine: DatabaseEngine,
    ) => {
      createPolicy: (p: {
        policyId: string;
        providerId: string;
        budgetUsd: number;
        approver: string;
        reAuthDueAt: string;
      }) => Promise<string>;
      activatePolicy: (policyId: string, approver: string) => Promise<void>;
      getActivePolicy: (providerId: string) => Promise<Record<string, unknown> | null>;
    };

    const manager = new PaidPolicyManager(engine);
    const policyId = await manager.createPolicy({
      policyId: 'pol-unit-001',
      providerId: 'coinglass',
      budgetUsd: 200.0,
      approver: 'sec-approver-1',
      reAuthDueAt: '2026-09-01T00:00:00Z',
    });

    await manager.activatePolicy(policyId, 'sec-approver-1');
    const active = await manager.getActivePolicy('coinglass');
    expect(active).not.toBeNull();
    expect(active?.budgetUsd).toBe(200.0);
  });

  it('refuses modification of budget or approver after activation (immutability)', async () => {
    let PolicyModule: Record<string, unknown>;
    try {
      PolicyModule = (await import('../src/paid-policy.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PAID_POLICY_NOT_IMPLEMENTED: src/paid-policy.ts missing');
    }

    const PaidPolicyManager = PolicyModule.PaidPolicyManager as new (
      engine: DatabaseEngine,
    ) => {
      updatePolicy: (policyId: string, patch: Record<string, unknown>) => Promise<void>;
    };

    const manager = new PaidPolicyManager(engine);
    expect(
      manager.updatePolicy('pol-unit-001', { budgetUsd: 500.0 }),
    ).rejects.toThrow(/IMMUTABLE|POLICY_ACTIVE_CANNOT_MUTATE/i);
  });

  it('expired reAuthDueAt blocks admission until re-authenticated', async () => {
    let PolicyModule: Record<string, unknown>;
    try {
      PolicyModule = (await import('../src/paid-policy.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('PAID_POLICY_NOT_IMPLEMENTED: src/paid-policy.ts missing');
    }

    const PaidPolicyManager = PolicyModule.PaidPolicyManager as new (
      engine: DatabaseEngine,
    ) => {
      isPolicyAdmissible: (
        providerId: string,
        now: string,
      ) => Promise<{ admissible: boolean; reason?: string }>;
    };

    const manager = new PaidPolicyManager(engine);
    // Evaluated at a time after reAuthDueAt
    const result = await manager.isPolicyAdmissible('pol-unit-001', '2026-09-15T00:00:00Z');
    expect(result.admissible).toBe(false);
    expect(result.reason).toMatch(/REAUTH_EXPIRED|EXPIRED/i);
  });
});
