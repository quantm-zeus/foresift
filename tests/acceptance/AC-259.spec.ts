// AC-259 (acceptance): append → checkpoint → INDEPENDENT verification runs
// green end-to-end on PGlite + an object-store adapter: entries chain by
// hash, checkpoints mirror OUTSIDE SQL truth, and continuous verification
// records durable OK verdicts.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { ObjectStoreAdapter, PutObjectRequest, StoredObject } from '@foresift/object-store';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  sha256Text,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditChain } from '../../packages/security/src/audit-chain.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

class MemoryObjectStore implements ObjectStoreAdapter {
  readonly puts: PutObjectRequest[] = [];
  async put(request: PutObjectRequest): Promise<StoredObject> {
    this.puts.push(request);
    return {
      artifactId: request.artifactId,
      contentHash: `sha256:${createHash('sha256').update(request.bytes).digest('hex')}`,
      version: 1,
      sizeBytes: request.bytes.byteLength,
      metadata: request.metadata,
      storedAt: '2026-08-01T00:00:00Z',
    };
  }
  async get(): Promise<null> {
    return null;
  }
  async verify(): Promise<{ outcome: 'MISSING' }> {
    return { outcome: 'MISSING' };
  }
  async versions(): Promise<readonly StoredObject[]> {
    return [];
  }
}

let db: PGlite;
let engine: DatabaseEngine;
let chain: AuditChain;
let store: MemoryObjectStore;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  store = new MemoryObjectStore();
  chain = new AuditChain({ engine, objectStore: store });
});

afterAll(async () => {
  await db.close();
});

async function append(entry: { subject: string; n: number }): Promise<void> {
  await chain.append({
    occurredAt: at('2026-08-01T00:00:00Z'),
    actor: 'operator@example.com',
    actionClass: 'CONFIGURATION_CHANGE',
    subject: entry.subject,
    payload: { n: entry.n },
  });
}

describe('AC-259: append → checkpoint → independent verification is green', () => {
  it('chains entries from GENESIS with recomputable hashes', async () => {
    const first = await chain.append({
      occurredAt: at('2026-08-01T00:00:00Z'),
      actor: 'operator@example.com',
      actionClass: 'CONFIGURATION_CHANGE',
      subject: 'ac259-e1',
      payload: { step: 1 },
    });
    expect(first.seq).toBe(1);
    expect(first.prevEntryHash).toBe('GENESIS');
    expect(first.entryHash).toBe(sha256Text(`GENESIS${first.payloadCanonical}`));

    const second = await chain.append({
      occurredAt: at('2026-08-01T00:01:00Z'),
      actor: 'operator@example.com',
      actionClass: 'CAPABILITY_CHANGE',
      subject: 'ac259-e2',
      payload: { step: 2 },
    });
    expect(second.prevEntryHash).toBe(first.entryHash);
    expect(second.entryHash).toBe(sha256Text(`${first.entryHash}${second.payloadCanonical}`));
  });

  it('checkpoints mirror chained anchors to the INDEPENDENT object store', async () => {
    await append({ subject: 'ac259-e3', n: 3 });
    const cp = await chain.checkpointBatch(1, 3, at('2026-08-01T00:05:00Z'));
    expect(cp.fromSeq).toBe(1);
    expect(cp.toSeq).toBe(3);

    // The checkpoint exists BOTH in SQL truth AND as an out-of-band copy…
    const sqlRows = await engine.query('SELECT * FROM sec.sec_audit_checkpoints');
    expect(sqlRows.rows).toHaveLength(1);
    expect(store.puts).toHaveLength(1);

    // …and the mirrored bytes carry the same anchor hash.
    const mirrored = Buffer.from(store.puts[0]?.bytes as unknown as number[]).toString('utf8');
    expect(mirrored).toContain(cp.checkpointHash);
  });

  it('continuous verification records a durable OK verdict over the whole chain', async () => {
    const outcome = await chain.verifyRange();
    expect(outcome.run.verdict).toBe('OK');
    expect(outcome.run.divergenceKind).toBeNull();

    const runs = await engine.query<{ verdict: string }>(
      'SELECT verdict FROM sec.sec_audit_verify_runs',
    );
    expect(runs.rows.some((row) => row.verdict === 'OK')).toBe(true);

    // verifyOrRaise resolves on healthy chains — the gate consumers call.
    await expect(chain.verifyOrRaise()).resolves.toBeDefined();
  });
});
