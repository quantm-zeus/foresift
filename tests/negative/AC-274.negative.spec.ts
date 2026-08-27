// AC-274 (negative): a high-impact admin request missing ANY single required
// dimension is refused with the matching typed reason — step-up absent,
// stale, or class-insufficient; CSRF pair broken; idempotency key missing;
// reason missing; scope mismatch; audit health blocked.
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
import { Incidents } from '../../packages/security/src/incidents.ts';
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
let incidents: Incidents;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  incidents = new Incidents(engine);
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

function freshProof(overrides: Partial<StepUpProof> = {}): StepUpProof {
  return {
    proofId: 'proof-neg',
    actor: 'admin@example.com',
    authenticatorClass: 'PASSKEY_PLATFORM',
    completedAt: at('2026-07-31T23:58:00Z'),
    userPresence: true,
    userVerification: true,
    challengeRef: 'challenge://neg',
    ...overrides,
  };
}

function completeRequest(stepUpProof: StepUpProof = freshProof()) {
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
    idempotencyKey: 'idem-neg',
    reasonEntry: 'activating reviewed configuration v7',
  };
}

function makeGate() {
  return new ActionGate({
    auditChain: new AuditChain({ engine, objectStore: new MemoryObjectStore() }),
    // Production wiring: the §35.9 block rule consults the incident store.
    auditHealthBlocked: () => incidents.isOpenAuditChainFailure(),
    clock: () => NOW_MS,
  });
}

async function refusalReasons(request: Parameters<ActionGate['evaluateHighImpactAction']>[0]) {
  const decision = await makeGate().evaluateHighImpactAction(request);
  if (decision.outcome !== 'REFUSE') {
    throw new Error(`expected REFUSE, got ${decision.outcome}`);
  }
  return decision.reasons;
}

describe('AC-274 negatives: every missing dimension refuses with its typed reason', () => {
  it('refuses STEP_UP_MISSING when no proof is presented', async () => {
    const request = completeRequest();
    expect(await refusalReasons({ ...request, stepUpProof: undefined })).toContain(
      'STEP_UP_MISSING',
    );
  });

  it('refuses STEP_UP_STALE when the proof predates the freshness window', async () => {
    const stale = freshProof({
      proofId: 'proof-stale',
      completedAt: at('2026-07-31T20:00:00Z'), // ~4h old vs 300s window
    });
    expect(await refusalReasons(completeRequest(stale))).toContain('STEP_UP_STALE');
  });

  it('refuses AUTHENTICATOR_CLASS_INSUFFICIENT for TOTP-only recovery proofs', async () => {
    const weak = freshProof({
      proofId: 'proof-totp',
      authenticatorClass: 'RECOVERY_TOTP',
      userVerification: false,
    });
    expect(await refusalReasons(completeRequest(weak))).toContain(
      'AUTHENTICATOR_CLASS_INSUFFICIENT',
    );
  });

  it('refuses CSRF_INVALID when submitted and session tokens disagree', async () => {
    const request = completeRequest();
    expect(
      await refusalReasons({
        ...request,
        csrf: { ...request.csrf, submittedToken: 'd'.repeat(32) },
      }),
    ).toContain('CSRF_INVALID');
  });

  it('refuses IDEMPOTENCY_KEY_MISSING for an empty idempotency key', async () => {
    expect(await refusalReasons({ ...completeRequest(), idempotencyKey: '' })).toContain(
      'IDEMPOTENCY_KEY_MISSING',
    );
  });

  it('refuses REASON_MISSING when no durable reason entry is supplied', async () => {
    expect(await refusalReasons({ ...completeRequest(), reasonEntry: '' })).toContain(
      'REASON_MISSING',
    );
  });

  it('refuses SCOPE_MISMATCH when the action exceeds authorized scopes', async () => {
    expect(
      await refusalReasons({ ...completeRequest(), authorizedScopes: ['admin:low:read'] }),
    ).toContain('SCOPE_MISMATCH');
  });

  it('refuses AUDIT_HEALTH_BLOCKED while an open SEV1 audit-chain failure exists', async () => {
    await incidents.open({
      incidentId: 'inc-ac274-audit-health',
      kind: 'AUDIT_CHAIN_FAILURE',
      severity: 'SEV1',
      owner: 'oncall-security',
      openedAt: at('2026-07-31T12:00:00Z'),
      evidenceRefs: ['evidence://audit/break'],
    });
    expect(await incidents.isOpenAuditChainFailure()).toBe(true);
    const decision = await makeGate().evaluateHighImpactAction(completeRequest());
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') {
      expect(decision.reasons).toContain('AUDIT_HEALTH_BLOCKED');
    }
  });
});
