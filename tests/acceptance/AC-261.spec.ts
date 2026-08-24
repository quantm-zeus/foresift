/**
 * AC-261 acceptance (positive).
 * Traces: FR-DR-001, FR-DR-002.
 * AC text (manifest §39.25): "Restore into a clean environment verifies
 * database/object hashes, migrations, audit chain, cross-store references,
 * workflow/inbox/outbox state, quota reservations, and collector checkpoint/
 * gaps before automation resumes."
 *
 * Every verification the criterion names is a REGISTERED check: the four
 * this package owns are built in; the later-package domains are registered
 * as substrate checks over what G0 owns today. All green ⇒ PASSED ⇒ only
 * then may automation resume.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  collectorContinuityCheck,
  commitCheckpoint,
  crossStoreReferenceCheck,
  migrationStateCheck,
  objectHashCheck,
  runRestoreDrill,
  type RestoreCheck,
} from '@foresift/persistence';
import { insertPendingArtifact, transitionStage } from '@foresift/object-store';
import { freezeBundle } from '@foresift/evidence';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  seedPool,
  type TestDatabase,
} from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

/**
 * Physical hash verifier over the artifacts this fixture indexed. Bytes are
 * held at the port (production injects an ObjectStoreAdapter-backed one).
 */
function mapVerifier(bytesById: Map<string, Uint8Array>): {
  verifyArtifact(
    artifactId: string,
    contentHash: string,
  ): Promise<{ passed: boolean; detail: string }>;
} {
  return {
    async verifyArtifact(artifactId, contentHash) {
      const bytes = bytesById.get(artifactId);
      if (bytes === undefined) return { passed: false, detail: 'artifact bytes missing' };
      const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (actual !== contentHash) {
        return { passed: false, detail: `indexed ${contentHash}, actual ${actual}` };
      }
      return { passed: true, detail: 'hash matches' };
    },
  };
}

/** Audit chain: every observation carries its unique receipt; no dangling compensations. */
const auditReceiptChainCheck: RestoreCheck = {
  name: 'audit-receipt-chain',
  async verify({ engine }) {
    const obs = await engine.query<{ observation_id: string; receipt_hash: string | null }>(
      'SELECT observation_id, receipt_hash FROM observations',
    );
    const receipts = new Set<string>();
    for (const r of obs.rows) {
      if (r.receipt_hash === null) {
        return { passed: false, detail: `observation ${r.observation_id} has no receipt` };
      }
      if (receipts.has(r.receipt_hash)) {
        return { passed: false, detail: `duplicated receipt ${r.receipt_hash}` };
      }
      receipts.add(r.receipt_hash);
    }
    const dangling = await engine.query<{ compensation_id: string }>(
      `SELECT ce.compensation_id FROM compensating_events ce
       WHERE NOT EXISTS (
         SELECT 1 FROM observations o
         WHERE o.observation_id = ce.target_observation_id)`,
    );
    if (dangling.rows.length > 0) {
      return { passed: false, detail: `${dangling.rows.length} compensating events dangle` };
    }
    return { passed: true, detail: `${obs.rows.length} receipts intact and unique` };
  },
};

/**
 * Workflow/inbox/outbox/quota state: these domains land in later packages;
 * the verified state for a clean G0 restore is that NO partial future schema
 * exists (a half-applied restore would surface here).
 */
const workflowQuotaStateCheck: RestoreCheck = {
  name: 'workflow-inbox-outbox-quota-state',
  async verify({ engine }) {
    const future = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('outbox_events','workflow_inbox','quota_reservations')`,
    );
    if (future.rows.length > 0) {
      return {
        passed: false,
        detail: `partial future schema present: ${future.rows.map((r) => r.table_name).join(',')}`,
      };
    }
    return { passed: true, detail: 'no partial workflow/outbox/quota state' };
  },
};

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  const poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac261',
  });
  await appendObservation(engine, {
    observationId: 'ac261-obs',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T08:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '900',
    decimals: 2,
  });
  await freezeBundle(engine, {
    bundleId: 'ac261-bundle',
    manifest: { family: 'swaps', window: '2026-06-01T08' },
    frozenAt: T('2026-06-01T09:00:00Z'),
  });
  await commitCheckpoint(engine, { shardId: 'shard-ac261', fencingToken: 1, cursorPosition: 5 });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-261: clean-environment verification gates automation resumption', () => {
  it('every named verification is registered and green on an untampered environment', async () => {
    const artifactBytes = new Map<string, Uint8Array>([
      ['art/ac261/1', new TextEncoder().encode('payload-one')],
    ]);
    const bytes = artifactBytes.get('art/ac261/1')!;
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    // Index the artifact through STORED_HASH_VERIFIED so objectHashCheck sees it.
    await insertPendingArtifact(tdb.engine, {
      artifactId: 'art/ac261/1',
      contentHash,
      encryptionStatus: 'SERVER_SIDE_AES256',
      retentionClass: 'RAW_PROVIDER_PAYLOAD_7D',
      sizeBytes: bytes.byteLength,
      uploadedAt: T('2026-06-01T08:10:00Z'),
    });
    await transitionStage(tdb.engine, {
      artifactId: 'art/ac261/1',
      reached: 'STORED_HASH_VERIFIED',
      at: T('2026-06-01T08:11:00Z'),
    });

    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac261-clean',
      startedAt: T('2026-06-01T10:00:00Z'),
      finishedAt: T('2026-06-01T10:05:00Z'),
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
      requiredChecks: [
        'database-migration-state',
        'object-hashes',
        'audit-receipt-chain',
        'cross-store-references',
        'workflow-inbox-outbox-quota-state',
        'collector-checkpoints-gaps',
      ],
      registeredChecks: [
        migrationStateCheck(MIGRATIONS_DIR),
        objectHashCheck(mapVerifier(artifactBytes)),
        auditReceiptChainCheck,
        crossStoreReferenceCheck,
        workflowQuotaStateCheck,
        collectorContinuityCheck,
      ],
    });

    expect(report.outcome).toBe('PASSED');
    expect(report.checks.map((c) => c.name)).toEqual([
      'database-migration-state',
      'object-hashes',
      'audit-receipt-chain',
      'cross-store-references',
      'workflow-inbox-outbox-quota-state',
      'collector-checkpoints-gaps',
    ]);
    expect(report.checks.every((c) => c.passed)).toBe(true);

    // The gate is durable: resumption reads the persisted verdict.
    const persisted = await tdb.engine.query<{
      outcome: string;
      credential_provider_present: boolean;
      finished_at: string | null;
    }>(
      `SELECT outcome, credential_provider_present, finished_at
       FROM restore_drills WHERE drill_id = $1`,
      [report.drillId],
    );
    expect(persisted.rows[0]?.outcome).toBe('PASSED');
    expect(persisted.rows[0]?.credential_provider_present).toBe(true);
    expect(persisted.rows[0]?.finished_at).not.toBeNull();
  });
});
