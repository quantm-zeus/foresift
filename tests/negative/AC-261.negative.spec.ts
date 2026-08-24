/**
 * AC-261 negative / failure-path — task T061.
 * Traces: FR-DR-001, FR-DR-002.
 * A clean-environment verification that finds tampering must refuse
 * resumption: drifted object bytes or an unresolved checkpoint gap fail the
 * drill; a missing restore credential provider or a policy-required check
 * without a registered implementation blocks before anything runs.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  collectorContinuityCheck,
  commitCheckpoint,
  migrationStateCheck,
  objectHashCheck,
  registerGap,
  runRestoreDrill,
} from '@foresift/persistence';
import { insertPendingArtifact, transitionStage } from '@foresift/object-store';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  // Shard whose cursor advanced past an UNRECOVERED gap — the stale-checkpoint shape.
  await commitCheckpoint(engine, {
    shardId: 'shard-ac261n',
    fencingToken: 1,
    cursorPosition: 5,
    at: T('2026-06-01T08:00:00Z'),
  });
  await registerGap(engine, {
    gapId: 'gap-ac261n',
    shardId: 'shard-ac261n',
    gapStartSlot: 2,
    gapEndSlot: 4,
    reason: 'provider outage window',
    registeredAt: T('2026-06-01T07:00:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-261 negative: tampering and missing prerequisites refuse resumption', () => {
  it('a missing restore credential provider blocks before any verification runs', async () => {
    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac261n-no-credentials',
      startedAt: T('2026-06-01T10:00:00Z'),
      // No credentialProvider at all.
      registeredChecks: [migrationStateCheck(MIGRATIONS_DIR)],
    });
    expect(report.outcome).toBe('BLOCKED');
    expect(report.checks).toHaveLength(0);
    expect(report.finishedAt).toBeNull();

    const row = await tdb.engine.query<{
      credential_provider_present: boolean;
      finished_at: string | null;
    }>('SELECT credential_provider_present, finished_at FROM restore_drills WHERE drill_id = $1', [
      'drill-ac261n-no-credentials',
    ]);
    expect(row.rows[0]?.credential_provider_present).toBe(false);
    expect(row.rows[0]?.finished_at).toBeNull();
  });

  it('a policy-required check without a registered implementation blocks by name', async () => {
    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac261n-unregistered',
      startedAt: T('2026-06-01T10:05:00Z'),
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
      requiredChecks: ['database-migration-state', 'quota-reservations'],
      registeredChecks: [migrationStateCheck(MIGRATIONS_DIR), collectorContinuityCheck],
    });
    expect(report.outcome).toBe('BLOCKED');
    expect(report.checks.map((c) => c.name)).toEqual(['quota-reservations']);
    expect(report.checks[0]?.detail).toContain('no registered verifier');

    const row = await tdb.engine.query<{ outcome: string }>(
      'SELECT outcome FROM restore_drills WHERE drill_id = $1',
      ['drill-ac261n-unregistered'],
    );
    expect(row.rows[0]?.outcome).toBe('BLOCKED');
  });

  it('tampered artifact bytes fail the object-hash check and the whole drill', async () => {
    // The index says sha256("clean payload"); the physical world holds
    // different bytes — exactly what a drifted restore looks like.
    const clean = new TextEncoder().encode('clean payload');
    const contentHash = `sha256:${createHash('sha256').update(clean).digest('hex')}`;
    await insertPendingArtifact(tdb.engine, {
      artifactId: 'art/ac261n/tampered',
      contentHash,
      encryptionStatus: 'SERVER_SIDE_AES256',
      retentionClass: 'RAW_PROVIDER_PAYLOAD_7D',
      sizeBytes: clean.byteLength,
      uploadedAt: T('2026-06-01T09:00:00Z'),
    });
    await transitionStage(tdb.engine, {
      artifactId: 'art/ac261n/tampered',
      reached: 'STORED_HASH_VERIFIED',
      at: T('2026-06-01T09:01:00Z'),
    });

    const tamperedBytes = new Map<string, Uint8Array>([
      ['art/ac261n/tampered', new TextEncoder().encode('tampered payload')],
    ]);
    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac261n-tampered',
      startedAt: T('2026-06-01T10:10:00Z'),
      finishedAt: T('2026-06-01T10:12:00Z'),
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
      registeredChecks: [
        migrationStateCheck(MIGRATIONS_DIR),
        objectHashCheck({
          async verifyArtifact(artifactId, expected) {
            const bytes = tamperedBytes.get(artifactId);
            if (bytes === undefined) return { passed: false, detail: 'artifact bytes missing' };
            const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
            return actual === expected
              ? { passed: true, detail: 'hash matches' }
              : { passed: false, detail: `indexed ${expected}, actual ${actual}` };
          },
        }),
      ],
    });
    expect(report.outcome).toBe('FAILED');
    const objectCheck = report.checks.find((c) => c.name === 'object-hashes');
    expect(objectCheck?.passed).toBe(false);
    expect(objectCheck?.detail).toContain('actual sha256:');
  });

  it('an unresolved gap below the checkpoint cursor fails continuity', async () => {
    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac261n-gap',
      startedAt: T('2026-06-01T10:15:00Z'),
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
      registeredChecks: [collectorContinuityCheck],
    });
    expect(report.outcome).toBe('FAILED');
    const continuity = report.checks.find((c) => c.name === 'collector-checkpoints-gaps');
    expect(continuity?.passed).toBe(false);
    expect(continuity?.detail).toContain('unresolved gaps below its cursor 5');
  });
});
