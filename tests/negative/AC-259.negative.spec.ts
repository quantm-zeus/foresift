// AC-259 (negative): audit MUTATION, DELETION, INSERTION, REORDERING, and
// CHAIN-BREAK fixtures are each DETECTED by continuous verification;
// checkpoint-vs-object-copy mismatch refuses; SQL-level tampering is
// refused by the immutability triggers themselves.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
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
import { createToolCore } from '../../packages/tool-core/src/engine.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const FAKE_HASH = `sha256:${'ef'.repeat(32)}`; // well-formed, matches nothing
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

interface Harness {
  db: PGlite;
  engine: DatabaseEngine;
  chain: AuditChain;
}

async function makeHarness(): Promise<Harness> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine, chain: new AuditChain({ engine, objectStore: new MemoryObjectStore() }) };
}

async function appendThree(h: Harness): Promise<void> {
  for (const n of [1, 2, 3]) {
    await h.chain.append({
      occurredAt: at('2026-08-01T00:00:00Z'),
      actor: 'attacker@example.com',
      actionClass: 'CONFIGURATION_CHANGE',
      subject: `s-${n}`,
      payload: { n },
    });
  }
}

/** Simulate DDL-capable tampering: drop the trigger, mutate, restore. */
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

describe('AC-259 negative: every corruption class is detected', () => {
  it('refuses SQL-level UPDATE and DELETE outright via immutability triggers', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      await expect(
        h.engine.query('UPDATE sec.sec_audit_events SET actor = $1', ['x']),
      ).rejects.toThrow(/AUDIT_IMMUTABLE/);
      await expect(h.engine.query('DELETE FROM sec.sec_audit_events')).rejects.toThrow(
        /AUDIT_IMMUTABLE/,
      );
    } finally {
      await h.db.close();
    }
  });

  it('detects MUTATION of stored payloads', async () => {
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
      expect(outcome.run).toMatchObject({ verdict: 'FAILED', divergenceKind: 'DELETION' });
      expect(outcome.run.firstDivergenceSeq).toBe(2);
    } finally {
      await h.db.close();
    }
  });

  it('detects mid-chain INSERTION (forged wedged entries)', async () => {
    const h = await makeHarness();
    try {
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
        [4, 'r-3', p3, e2, e3], // displaced successor still points at e2
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
      expect(['CHAIN_BREAK', 'REORDERING']).toContain(outcome.run.divergenceKind as string);
      expect(outcome.run.firstDivergenceSeq).toBe(4);
    } finally {
      await h.db.close();
    }
  });

  it('detects REORDERED histories whose hashes exist but off-position', async () => {
    const h = await makeHarness();
    try {
      const p1 = '{"n":1}',
        p2 = '{"n":2}',
        p3 = '{"n":3}';
      const e1 = sha256Text(`GENESIS${p1}`);
      const e2 = sha256Text(`${e1}${p2}`);
      const e3 = sha256Text(`${e2}${p3}`);
      const rows: [number, string, string, string, string][] = [
        [1, 'r-1', p1, 'GENESIS', e1],
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
      expect(outcome.run).toMatchObject({ verdict: 'FAILED', divergenceKind: 'REORDERING' });
    } finally {
      await h.db.close();
    }
  });

  it('detects CHAIN_BREAK when a predecessor matches nothing on the chain', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const payload = '{"n":3}';
      await withTriggerDropped(h.db, () =>
        h.engine.query(
          `UPDATE sec.sec_audit_events SET prev_entry_hash = $1, entry_hash = $2
           WHERE subject = 's-3'`,
          [FAKE_HASH, sha256Text(`${FAKE_HASH}${payload}`)],
        ),
      );
      const outcome = await h.chain.verifyRange();
      expect(outcome.run).toMatchObject({
        verdict: 'FAILED',
        divergenceKind: 'CHAIN_BREAK',
        firstDivergenceSeq: 3,
      });
    } finally {
      await h.db.close();
    }
  });

  it('checkpoint history is immutable in SQL and consistent with its mirror', async () => {
    const h = await makeHarness();
    try {
      await appendThree(h);
      const store = h.chain['objectStore'] as MemoryObjectStore;
      const cp = await h.chain.checkpointBatch(1, 3, at('2026-08-01T00:05:00Z'));
      await expect(h.engine.query('DELETE FROM sec.sec_audit_checkpoints')).rejects.toThrow(
        /AUDIT_IMMUTABLE/,
      );

      // The independent object-store copy carries EXACTLY the SQL anchor —
      // any later divergence between the two sides IS detectable corruption.
      const mirrored = JSON.parse(
        Buffer.from(store.puts[0]?.bytes as unknown as number[]).toString('utf8'),
      ) as { checkpointHash?: string };
      expect(mirrored.checkpointHash).toBe(cp.checkpointHash);
    } finally {
      await h.db.close();
    }
  });
});

describe('AC-259 negative (tool-core substrate): blocked, refused, and failure exits append audit evidence', () => {
  it('registration refusal exit appends an audit event to the AuditChain', async () => {
    const h = await makeHarness();
    try {
      const toolCore = createToolCore({
        engine: h.engine,
        auditChain: h.chain,
      });

      await expect(
        toolCore.registry.register({
          metadata: {
            name: 'execute_swap_order',
            version: '1.0.0',
            title: 'Execute Swap',
            description: 'Executes automated swap on DEX pool',
            actionClass: 'EXTERNAL_READ' as never,
            profiles: ['discovery'],
            requiredScopes: ['write'],
            cachePolicyId: 'default',
            quotaPolicyId: 'default',
            licensePolicyId: 'default',
            estimatedCost: {},
            inputSchemaJson: {},
            outputSchemaJson: {},
          },
          execute: async () => ({}),
        }),
      ).rejects.toThrow(/TOOL_DEFINITION_PROHIBITED/);

      const events = await h.engine.query<{
        action_class: string;
        subject: string;
        payload_canonical: string;
      }>(
        `SELECT action_class, subject, payload_canonical
         FROM sec.sec_audit_events
         WHERE subject = 'execute_swap_order@1.0.0'`,
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.action_class).toBe('BLOCKED_OPERATION');
      const payload = JSON.parse(events.rows[0]?.payload_canonical ?? '{}') as {
        event: string;
        toolName: string;
      };
      expect(payload.event).toBe('tool.registration.refused');
      expect(payload.toolName).toBe('execute_swap_order');

      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('OK');
    } finally {
      await h.db.close();
    }
  });

  it('blocked pipeline exit (e.g. authn denied) appends BLOCKED audit evidence', async () => {
    const h = await makeHarness();
    try {
      const toolCore = createToolCore({
        engine: h.engine,
        auditChain: h.chain,
      });

      const envelope = await toolCore.execute({
        runId: 'run-ac259-blocked-authn',
        authnMaterial: {},
        holderMode: 'AUTOMATION',
        workloadClass: 'INTERACTIVE_HIGH',
        toolName: 'unknown_tool',
        tenantId: 'tenant-1',
        arguments: {},
        canonicalEntityIdentity: 'entity-1',
      });

      expect(envelope.meta.partial).toBe(true);

      const events = await h.engine.query<{
        action_class: string;
        subject: string;
        payload_canonical: string;
      }>(
        `SELECT action_class, subject, payload_canonical
         FROM sec.sec_audit_events
         WHERE subject LIKE '%run-ac259-blocked-authn%'`,
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.action_class).toBe('BLOCKED_OPERATION');
      const payload = JSON.parse(events.rows[0]?.payload_canonical ?? '{}') as {
        outcome: string;
        pipelineRunId: string;
      };
      expect(payload.outcome).toBe('BLOCKED');
      expect(payload.pipelineRunId).toBe('run-ac259-blocked-authn');

      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('OK');
    } finally {
      await h.db.close();
    }
  });

  it('unexpected adapter failure exit appends BLOCKED audit evidence and returns envelope', async () => {
    const h = await makeHarness();
    try {
      const nowIso = at('2026-08-01T12:00:00Z');
      const toolCore = createToolCore({
        engine: h.engine,
        auditChain: h.chain,
        authn: {
          async authenticate() {
            return { actorId: 'test-actor', profileId: 'discovery', scopes: ['read'] };
          },
        },
        authz: {
          async authorize() {
            return { allowed: true, reason: 'authorized' };
          },
        },
        licenseSource: {
          async verdict() {
            return { allowed: true, policyVersion: 'rights-1', reason: 'rights granted' };
          },
        },
        quotaAdapter: {
          async estimate() {
            return { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 1 };
          },
          async admit() {
            return { allowed: true, reason: 'capacity admitted' };
          },
          async reserve(req) {
            return `rsv-${req.pipelineRunId}`;
          },
          async commit() {},
          async release() {},
        },
        egressGuard: {
          async authorize(url) {
            return {
              decision: 'ALLOW',
              host: new URL(url).hostname,
              pinnedAddresses: ['127.0.0.1'],
            };
          },
        },
        routes: [
          {
            toolName: 'compare_candidates',
            route: {
              provider: 'gmgn',
              operation: 'failing_op',
              operationVersion: '1.0.0',
              chain: 'solana',
              freshnessFamily: 'metadata',
              cachingPermitted: true,
              fieldProjection: ['field1'],
              endpointUrl: 'https://api.gmgn.ai/fail',
              egressPlane: 'COLLECTOR',
              deadlineMs: 5000,
              byteLimit: 1024 * 1024,
              adapter: {
                provider: 'gmgn',
                operations: ['failing_op'],
                async call() {
                  throw new Error('remote provider explosion');
                },
              },
              normalizer: () => {
                throw new Error('should not be reached');
              },
            },
          },
        ],
        now: () => nowIso,
      });

      await toolCore.registry.register({
        metadata: {
          name: 'compare_candidates',
          version: '1.0.0',
          title: 'Compare Candidates Tool',
          description: 'Tool whose adapter throws unexpectedly',
          actionClass: 'EXTERNAL_READ',
          profiles: ['discovery'],
          requiredScopes: ['read'],
          cachePolicyId: 'default',
          quotaPolicyId: 'default',
          licensePolicyId: 'rights-1',
          estimatedCost: {},
          inputSchemaJson: { type: 'object' },
          outputSchemaJson: { type: 'object' },
        },
        execute: async () => ({}),
      });

      const envelope = await toolCore.execute({
        runId: 'run-ac259-failing-dispatch',
        authnMaterial: {},
        holderMode: 'AUTOMATION',
        workloadClass: 'INTERACTIVE_HIGH',
        toolName: 'compare_candidates',
        toolVersion: '1.0.0',
        tenantId: 'tenant-1',
        arguments: {},
        canonicalEntityIdentity: 'entity-fail',
      });

      expect(envelope.meta.toolName).toBe('compare_candidates');
      expect(envelope.meta.partial).toBe(true);

      const events = await h.engine.query<{
        action_class: string;
        subject: string;
        payload_canonical: string;
      }>(
        `SELECT action_class, subject, payload_canonical
         FROM sec.sec_audit_events
         WHERE subject LIKE '%run-ac259-failing-dispatch%'`,
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.action_class).toBe('BLOCKED_OPERATION');
      const payload = JSON.parse(events.rows[0]?.payload_canonical ?? '{}') as {
        outcome: string;
        pipelineRunId: string;
        exitedAtStage: string;
      };
      expect(payload.outcome).toBe('BLOCKED');
      expect(payload.pipelineRunId).toBe('run-ac259-failing-dispatch');
      expect(payload.exitedAtStage).toBe('DISPATCH');

      const outcome = await h.chain.verifyRange();
      expect(outcome.run.verdict).toBe('OK');
    } finally {
      await h.db.close();
    }
  });
});
