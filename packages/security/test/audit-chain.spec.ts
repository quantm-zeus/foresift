// Audit chain behavior (T109): fenced chaining, checkpoint mirroring, and
// divergence classification. Each corruption fixture gets a FRESH database
// (migrations applied) so classifications never cross-contaminate; tampering
// simulates an attacker WITH DDL privileges (trigger dropped and restored),
// proving detection survives even owner-level mutation.
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
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
import { AuditChain } from '../src/audit-chain.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const FAKE_HASH = `sha256:${'ef'.repeat(32)}`; // well-formed but matches nothing

class MemoryObjectStore implements ObjectStoreAdapter {
  readonly puts: PutObjectRequest[] = [];

  async put(request: PutObjectRequest): Promise<StoredObject> {
    this.puts.push(request);
    const contentHash = `sha256:${createHash('sha256').update(request.bytes).digest('hex')}`;
    return {
      artifactId: request.artifactId,
      contentHash,
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

const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

interface Harness {
  db: PGlite;
  engine: DatabaseEngine;
  chain: AuditChain;
}

async function makeHarness(): Promise<Harness> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  const chain = new AuditChain({ engine, objectStore: new MemoryObjectStore() });
  return { db, engine, chain };
}

async function appendThree(h: Harness): Promise<void> {
  await h.chain.append({
    occurredAt: at('2026-08-01T00:00:00Z'),
    actor: 'admin@example.com',
    actionClass: 'CONFIGURATION_CHANGE',
    subject: 's-1',
    payload: { n: 1 },
  });
  await h.chain.append({
    occurredAt: at('2026-08-01T00:01:00Z'),
    actor: 'admin@example.com',
    actionClass: 'CAPABILITY_CHANGE',
    subject: 's-2',
    payload: { n: 2 },
  });
  await h.chain.append({
    occurredAt: at('2026-08-01T00:02:00Z'),
    actor: 'admin@example.com',
    actionClass: 'SECRET_LIFECYCLE',
    subject: 's-3',
    payload: { n: 3 },
  });
}

/** Simulate DDL-capable tampering: drop the immutability trigger, mutate, restore. */
async function withTriggerDropped(db: PGlite, mutate: () => Promise<unknown>): Promise<void> {
  await db.exec('DROP TRIGGER sec_audit_events_append_only ON sec.sec_audit_events');
  try {
    await mutate();
  } finally {
    await db.exec(`CREATE TRIGGER sec_audit_events_append_only
                   BEFORE UPDATE OR DELETE ON sec.sec_audit_events
                   FOR EACH ROW EXECUTE FUNCTION sec.refuse_mutation()`);
  }
}

describe('audit chain appends (FR-SEC-002)', () => {
  it('chains entry_hash = sha256(prev || canonical payload) from GENESIS', async () => {
    const h = await makeHarness();
    try {
      const first = await h.chain.append({
        occurredAt: at('2026-08-01T00:00:00Z'),
        actor: 'admin@example.com',
        actionClass: 'CONFIGURATION_CHANGE',
        subject: 'provider:helius',
        payload: { enabled: true },
      });
      expect(first.seq).toBe(1);
      expect(first.prevEntryHash).toBe('GENESIS');
      expect(first.entryHash).toBe(sha256Text(`GENESIS${first.payloadCanonical}`));

      const second = await h.chain.append({
        occurredAt: at('2026-08-01T00:01:00Z'),
        actor: 'admin@example.com',
        actionClass: 'CAPABILITY_CHANGE',
        subject: 'capability:x',
        payload: { expanded: false },
      });
      expect(second.seq).toBe(2);
      expect(second.prevEntryHash).toBe(first.entryHash);
      expect(second.entryHash).toBe(sha256Text(`${first.entryHash}${second.payloadCanonical}`));
    } finally {
      await h.db.close();
    }
  });

  it('canonicalizes payloads so key order cannot fork the hash', async () => {
    const h = await makeHarness();
    try {
      const a = await h.chain.append({
        occurredAt: at('2026-08-01T00:02:00Z'),
        actor: 'x',
        actionClass: 'COST_CHANGE',
        subject: 'cost',
        payload: { b: 2, a: 1 },
      });
      expect(a.entryHash).toBe(sha256Text(`${a.prevEntryHash}{"a":1,"b":2}`));
    } finally {
      await h.db.close();
    }
  });

  it('refuses SQL-level mutation and deletion via the immutability trigger', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await expect(
        h.engine.query('UPDATE sec.sec_audit_events SET actor = $1', ['attacker']),
      ).rejects.toThrow(/AUDIT_IMMUTABLE/);
      await expect(h.engine.query('DELETE FROM sec.sec_audit_events')).rejects.toThrow(
        /AUDIT_IMMUTABLE/,
      );
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('OK');
    } finally {
      await h.db.close();
    }
  });

  it('verifies a clean chain OK and records the run durably', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('OK');
      expect(outcome.run.divergenceKind).toBeNull();
      const runs = await h.engine.query('SELECT verdict FROM sec.sec_audit_verify_runs');
      expect(runs.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await h.db.close();
    }
  });

  it('reports GAP for an explicitly requested empty range', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const outcome = await h.chain.verifyRange(100, 200);
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('GAP');
      expect(outcome.run.firstDivergenceSeq).toBe(100);
    } finally {
      await h.db.close();
    }
  });

  it('reports GAP for a WIPED chain even under a full-range request (M2)', async () => {
    const h = await makeHarness();
    try {
      // An unexamined or wiped chain never attests its own health.
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('GAP');
      expect(outcome.run.firstDivergenceSeq).toBe(1);
      // The recorded run names REAL walked bounds — nothing was verified.
      expect(outcome.run.verifiedFromSeq).toBe(1);
      expect(outcome.run.verifiedToSeq).toBe(1);
    } finally {
      await h.db.close();
    }
  });

  it('REFUSES inverted, zero, or fractional ranges before any query (M2)', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await expect(h.chain.verifyRange(3, 2)).rejects.toThrow(/ascending/);
      await expect(h.chain.verifyRange(0)).rejects.toThrow(/positive integers/);
      await expect(h.chain.verifyRange(1.5)).rejects.toThrow(/positive integers/);
      await expect(h.chain.verifyRange(-2, 3)).rejects.toThrow(/positive integers/);
    } finally {
      await h.db.close();
    }
  });

  it('records the ACTUAL walked bounds of partial-range verification (M2)', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const outcome = await h.chain.verifyRange(2, 3);
      expect(outcome.run.verdict).toBe('OK');
      expect(outcome.run.verifiedFromSeq).toBe(2);
      expect(outcome.run.verifiedToSeq).toBe(3);
    } finally {
      await h.db.close();
    }
  });

  it('surfaces a leading-edge deletion as DELETION at the missing seq (M2)', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      // Delete seq 1 entirely: the earliest PRESENT entry's predecessor is
      // missing, which is a deletion at the window edge — not a confusing
      // hash-link verdict.
      await withTriggerDropped(h.db, async () => {
        await h.db.exec('DELETE FROM sec.sec_audit_events WHERE seq = 1');
      });
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('DELETION');
      expect(outcome.run.firstDivergenceSeq).toBe(1);
    } finally {
      await h.db.close();
    }
  });
});

describe('audit checkpoints mirror to the object store (FR-SEC-002, AC-259)', () => {
  it('writes the chained anchor to SQL AND an independent copy to the store', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const store = h.chain['objectStore'] as MemoryObjectStore;
      const cp = await h.chain.checkpointBatch(1, 3, at('2026-08-01T00:05:00Z'));
      expect(cp.fromSeq).toBe(1);
      expect(cp.toSeq).toBe(3);
      expect(cp.prevCheckpointHash).toBe('GENESIS');
      expect(store.puts).toHaveLength(1);
      const sqlRow = await h.engine.query('SELECT * FROM sec.sec_audit_checkpoints');
      expect(sqlRow.rows).toHaveLength(1);
    } finally {
      await h.db.close();
    }
  });

  it('chains successive checkpoints and refuses checkpointing without a store', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const first = await h.chain.checkpointBatch(1, 2, at('2026-08-01T00:05:00Z'));
      const second = await h.chain.checkpointBatch(3, 3, at('2026-08-01T00:06:00Z'));
      expect(second.prevCheckpointHash).toBe(first.checkpointHash);

      const bare = new AuditChain({ engine: h.engine });
      await expect(bare.checkpointBatch(1, 2, at('2026-08-01T00:07:00Z'))).rejects.toThrow(
        /independently verifiable/,
      );
    } finally {
      await h.db.close();
    }
  });

  it('refuses non-contiguous or uncovered ranges', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await expect(h.chain.checkpointBatch(5, 2, at('2026-08-01T00:06:30Z'))).rejects.toThrow();
      await expect(h.chain.checkpointBatch(100, 200, at('2026-08-01T00:06:31Z'))).rejects.toThrow();
    } finally {
      await h.db.close();
    }
  });

  it('checkpoints are append-only in SQL too', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await h.chain.checkpointBatch(1, 3, at('2026-08-01T00:05:00Z'));
      await expect(h.engine.query('DELETE FROM sec.sec_audit_checkpoints')).rejects.toThrow(
        /AUDIT_IMMUTABLE/,
      );
    } finally {
      await h.db.close();
    }
  });
});

describe('divergence classification (AC-259 fixture battery)', () => {
  it('detects MUTATION when content no longer matches its stored hashes', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await withTriggerDropped(h.db, () =>
        h.db.exec(
          `UPDATE sec.sec_audit_events SET payload_canonical = '{"n":"tampered"}'
           WHERE subject = 's-2'`,
        ),
      );
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('MUTATION');
      expect(outcome.run.firstDivergenceSeq).toBe(2);
      await expect(h.chain.verifyOrRaise()).rejects.toThrow(/MUTATION/);
    } finally {
      await h.db.close();
    }
  });

  it('detects DELETION as a sequence discontinuity', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await withTriggerDropped(h.db, () =>
        h.db.exec("DELETE FROM sec.sec_audit_events WHERE subject = 's-2'"),
      );
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('DELETION');
      expect(outcome.run.firstDivergenceSeq).toBe(2);
    } finally {
      await h.db.close();
    }
  });

  it('detects REORDERING when a predecessor hash exists but off-position', async () => {
    const h = await makeHarness();
    try {
      // Seed three correctly-chained CONTENTS but with two seq positions
      // swapped (an attacker-reordered history inserted wholesale). Walking
      // by seq meets r3 whose prev points at r2's hash — a hash that exists
      // on the chain, just not beside it.
      const p1 = '{"n":1}',
        p2 = '{"n":2}',
        p3 = '{"n":3}';
      const e0 = 'GENESIS';
      const e1 = sha256Text(`${e0}${p1}`);
      const e2 = sha256Text(`${e1}${p2}`);
      const e3 = sha256Text(`${e2}${p3}`);
      // [seq, subject, payload, truePrev, entryHash]
      const rows: [number, string, string, string, string][] = [
        [1, 'r-1', p1, e0, e1], // correct at position 1
        [2, 'r-3', p3, e2, e3], // belongs third…
        [3, 'r-2', p2, e1, e2], // …but its predecessor sits here instead
      ];
      for (const [seq, subject, payload, prevHash, entryHash] of rows) {
        await h.engine.query(
          `INSERT INTO sec.sec_audit_events
             (seq, occurred_at, actor, action_class, subject, payload_canonical,
              payload_sha256, prev_entry_hash, entry_hash)
           OVERRIDING SYSTEM VALUE VALUES ($1,$2,'fixture','CONFIGURATION_CHANGE',$3,$4,$5,$6,$7)`,
          [
            seq,
            at('2026-08-01T00:00:00Z'),
            subject,
            payload,
            sha256Text(payload),
            prevHash,
            entryHash,
          ],
        );
      }
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('REORDERING');
      expect(outcome.run.firstDivergenceSeq).toBe(2);
    } finally {
      await h.db.close();
    }
  });

  it('detects CHAIN_BREAK when a predecessor matches nothing on the chain', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      // Rewrite the s-3 link onto a fabricated predecessor (consistently
      // re-hashed, so this is NOT a mutation): the link points nowhere.
      const payload = '{"n":3}';
      await withTriggerDropped(h.db, () =>
        h.engine.query(
          `UPDATE sec.sec_audit_events
           SET prev_entry_hash = $1, entry_hash = $2
           WHERE subject = 's-3'`,
          [FAKE_HASH, sha256Text(`${FAKE_HASH}${payload}`)],
        ),
      );
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(outcome.run.divergenceKind).toBe('CHAIN_BREAK');
      expect(outcome.run.firstDivergenceSeq).toBe(3);
    } finally {
      await h.db.close();
    }
  });

  it('a forged mid-chain insertion surfaces as a downstream divergence', async () => {
    const h = await makeHarness();
    try {
      // Seed r1→r2→r3 correctly, plus a forged entry wedged at seq 3 that
      // chains off r2; the true r3 (now at seq 4) still points at r2 — its
      // predecessor is on the chain but no longer beside it. INSERT-only:
      // the immutability triggers never fire on inserts, which is exactly
      // why the verifier must catch insertion class corruption.
      const p1 = '{"n":1}',
        p2 = '{"n":2}',
        p3 = '{"n":3}',
        pf = '{"forged":true}';
      const e1 = sha256Text(`GENESIS${p1}`);
      const e2 = sha256Text(`${e1}${p2}`);
      const ef = sha256Text(`${e2}${pf}`);
      const e3 = sha256Text(`${e2}${p3}`);
      const rows: [number, string, string, string, string][] = [
        [1, 'r-1', p1, 'GENESIS', e1],
        [2, 'r-2', p2, e1, e2],
        [3, 'forged', pf, e2, ef],
        [4, 'r-3', p3, e2, e3], // displaced successor
      ];
      for (const [seq, subject, payload, prevHash, entryHash] of rows) {
        await h.engine.query(
          `INSERT INTO sec.sec_audit_events
             (seq, occurred_at, actor, action_class, subject, payload_canonical,
              payload_sha256, prev_entry_hash, entry_hash)
           OVERRIDING SYSTEM VALUE VALUES ($1,$2,'fixture','CONFIGURATION_CHANGE',$3,$4,$5,$6,$7)`,
          [
            seq,
            at('2026-08-01T00:00:00Z'),
            subject,
            payload,
            sha256Text(payload),
            prevHash,
            entryHash,
          ],
        );
      }
      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('FAILED');
      expect(['CHAIN_BREAK', 'REORDERING']).toContain(outcome.run.divergenceKind);
      expect(outcome.run.firstDivergenceSeq).toBe(4);
    } finally {
      await h.db.close();
    }
  });
});
