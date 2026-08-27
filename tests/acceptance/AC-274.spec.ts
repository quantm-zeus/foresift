// AC-274 (acceptance): a high-impact admin action carrying EVERY required
// dimension — fresh phishing-resistant step-up, exact scope, CSRF pair,
// idempotency key, reason — is ADMITTED and the decision lands in the audit
// chain. Admin-UI wiring is a non-goal owned elsewhere.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import type { ObjectStoreAdapter, PutObjectRequest, StoredObject } from '@foresift/object-store';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionGate } from '../../packages/security/src/action-gate.ts';
import { AuditChain } from '../../packages/security/src/audit-chain.ts';
import type { StepUpPolicy, StepUpProof } from '@foresift/shared-schemas';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const NOW_MS = Date.parse('2026-08-01T00:00:00Z');
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

class MemoryObjectStore implements ObjectStoreAdapter {
  async put(request: PutObjectRequest): Promise<StoredObject> {
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

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

const POLICY: StepUpPolicy = {
  freshnessWindowSeconds: 300,
  minimumAuthenticatorClass: 'HARDWARE_SECURITY_KEY',
  requireUserPresence: true,
  requireUserVerification: true,
};

const TOKEN = 'c'.repeat(32);

function completeRequest() {
  const stepUpProof: StepUpProof = {
    proofId: 'proof-ac274',
    actor: 'admin@example.com',
    authenticatorClass: 'PASSKEY_PLATFORM',
    completedAt: at('2026-07-31T23:58:00Z'), // fresh against the injected clock
    userPresence: true,
    userVerification: true,
    challengeRef: 'challenge://ac274',
  };
  return {
    action: 'admin:high:configuration-activate' as const,
    actor: 'admin@example.com',
    authorizedScopes: ['admin:high:configuration-activate'],
    policy: POLICY,
    stepUpProof,
    csrf: {
      submittedToken: TOKEN,
      sessionToken: TOKEN,
      tokenBoundOrigin: 'https://mcp.example.com',
      requestOrigin: 'https://mcp.example.com',
    },
    idempotencyKey: 'idem-ac274',
    reasonEntry: 'activating reviewed configuration v7',
  };
}

describe('AC-274: complete high-impact requests admit with full audit', () => {
  it('admits a fully-dimensioned request', async () => {
    const gate = new ActionGate({
      auditChain: new AuditChain({ engine, objectStore: new MemoryObjectStore() }),
      clock: () => NOW_MS,
    });
    const decision = await gate.evaluateHighImpactAction(completeRequest());
    expect(decision.outcome).toBe('ALLOW');
    if (decision.outcome === 'ALLOW') {
      expect(decision.stepUpProofId).toBe('proof-ac274');
      expect(decision.idempotencyKey).toBe('idem-ac274');
    }
  });

  it('audits the ALLOW decision into the hash-chained store', async () => {
    const gate = new ActionGate({
      auditChain: new AuditChain({ engine, objectStore: new MemoryObjectStore() }),
      clock: () => NOW_MS,
    });
    await gate.evaluateHighImpactAction(completeRequest());
    const rows = await engine.query<{ action_class: string; subject: string }>(
      "SELECT action_class, subject FROM sec.sec_audit_events WHERE subject = 'admin:high:configuration-activate'",
    );
    expect(rows.rows.some((r) => r.action_class === 'APPROVAL_STEP_UP')).toBe(true);
  });

  it('admits hardware-security-key proofs at the policy floor', async () => {
    const gate = new ActionGate({
      auditChain: new AuditChain({ engine, objectStore: new MemoryObjectStore() }),
      clock: () => NOW_MS,
    });
    const request = {
      ...completeRequest(),
      stepUpProof: {
        ...completeRequest().stepUpProof,
        authenticatorClass: 'HARDWARE_SECURITY_KEY' as const,
        proofId: 'proof-ac274-hsk',
      },
    };
    const decision = await gate.evaluateHighImpactAction(request);
    expect(decision.outcome).toBe('ALLOW');
  });
});
