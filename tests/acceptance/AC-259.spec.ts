// AC-259 (acceptance): append → checkpoint → INDEPENDENT verification runs
// green end-to-end on PGlite + an object-store adapter: entries chain by
// hash, checkpoints mirror OUTSIDE SQL truth, and continuous verification
// records durable OK verdicts.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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

describe('AC-259 acceptance (tool-core substrate): every pipeline exit appends audit evidence to the AuditChain', () => {
  it('every successful tool execution appends an audit event to the AuditChain', async () => {
    const nowIso = at('2026-08-01T12:00:00Z');
    const nowFn = () => nowIso;

    const toolCore = createToolCore({
      engine,
      auditChain: chain,
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
          return { decision: 'ALLOW', host: new URL(url).hostname, pinnedAddresses: ['127.0.0.1'] };
        },
      },
      routes: [
        {
          toolName: 'get_asset_identity',
          route: {
            provider: 'gmgn',
            operation: 'token_summary',
            operationVersion: '1.0.0',
            chain: 'solana',
            freshnessFamily: 'metadata',
            cachingPermitted: true,
            fieldProjection: ['symbol', 'name'],
            endpointUrl: 'https://api.gmgn.ai/token_summary',
            egressPlane: 'COLLECTOR',
            deadlineMs: 5000,
            byteLimit: 1024 * 1024,
            adapter: {
              provider: 'gmgn',
              operations: ['token_summary'],
              async call() {
                return {
                  contentType: 'application/json',
                  bodyText: JSON.stringify({ symbol: 'SOL', name: 'Solana' }),
                };
              },
            },
            normalizer: (_raw, normCtx) => ({
              observations: [
                {
                  evidenceId: 'obs-summary-1',
                  provider: normCtx.provider,
                  observedAt: normCtx.fetchedAt,
                  availableAt: normCtx.fetchedAt,
                  fetchedAt: normCtx.fetchedAt,
                  fields: { symbol: 'SOL', name: 'Solana' },
                  qualityCodes: ['QUALITY_HIGH'],
                },
              ],
              conflicts: [],
              partial: false,
              missingCapabilities: [],
            }),
          },
        },
      ],
      now: nowFn,
    });

    await toolCore.registry.register({
      metadata: {
        name: 'get_asset_identity',
        version: '1.0.0',
        title: 'Get Asset Identity',
        description: 'Read-only token summary query',
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
      execute: async () => ({ ok: true }),
    });

    const envelope = await toolCore.execute({
      runId: 'run-ac259-success-1',
      authnMaterial: {},
      holderMode: 'AUTOMATION',
      workloadClass: 'INTERACTIVE_HIGH',
      toolName: 'get_asset_identity',
      toolVersion: '1.0.0',
      tenantId: 'tenant-1',
      arguments: {},
      canonicalEntityIdentity: 'solana:token',
    });

    expect(envelope.meta.toolName).toBe('get_asset_identity');

    const events = await engine.query<{
      seq: number;
      action_class: string;
      subject: string;
      payload_canonical: string;
    }>(
      `SELECT seq, action_class, subject, payload_canonical
       FROM sec.sec_audit_events
       WHERE subject LIKE '%get_asset_identity%run-ac259-success-1%'`,
    );
    expect(events.rows).toHaveLength(1);
    const event = events.rows[0]!;
    expect(event.action_class).toBe('PROVIDER_COLLECTOR_ACCESS');
    const parsedPayload = JSON.parse(event.payload_canonical) as {
      outcome: string;
      toolName: string;
      pipelineRunId: string;
      exitedAtStage: string;
    };
    expect(parsedPayload.outcome).toBe('SUCCESS');
    expect(parsedPayload.toolName).toBe('get_asset_identity');
    expect(parsedPayload.pipelineRunId).toBe('run-ac259-success-1');
    expect(parsedPayload.exitedAtStage).toBe('RETURN_STRUCTURED_RESULT');

    const verifyOutcome = await chain.verifyRange();
    expect(verifyOutcome.run.verdict).toBe('OK');
  });
});
