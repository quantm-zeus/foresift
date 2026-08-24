// High-impact action gate (T112 + T114): fresh phishing-resistant step-up
// (TOTP never sufficient), exact Appendix B scope match, CSRF validity,
// idempotency + reason duties, typed refusal dimensions, audited decisions,
// and the §35.9 audit-health block.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { ActionGate } from '../src/action-gate.ts';
import { AuditChain } from '../src/audit-chain.ts';
import type { StepUpPolicy, StepUpProof } from '@foresift/shared-schemas';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
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
  async get(): Promise<null> { return null; }
  async verify(): Promise<{ outcome: 'MISSING' }> { return { outcome: 'MISSING' }; }
  async versions(): Promise<readonly StoredObject[]> { return []; }
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

function goodProof(overrides: Partial<StepUpProof> = {}): StepUpProof {
  return {
    proofId: 'proof-1',
    actor: 'admin@example.com',
    authenticatorClass: 'PASSKEY_PLATFORM',
    completedAt: at('2026-07-31T23:58:00Z'), // 2 min old, inside the window
    userPresence: true,
    userVerification: true,
    challengeRef: 'challenge://1',
    ...overrides,
  };
}

function makeGate(extra: ConstructorParameters<typeof ActionGate>[0] = {}) {
  const chain = new AuditChain({ engine, objectStore: new MemoryObjectStore() });
  const gate = new ActionGate({
    auditChain: chain,
    clock: () => NOW_MS,
    ...extra,
  });
  return { gate, chain };
}

const baseRequest = {
  action: 'admin:high:configuration-activate' as const,
  actor: 'admin@example.com',
  authorizedScopes: ['admin:high:configuration-activate'],
  policy: POLICY,
  stepUpProof: goodProof(),
  csrf: {
    submittedToken: TOKEN,
    sessionToken: TOKEN,
    tokenBoundOrigin: 'https://mcp.example.com',
    requestOrigin: 'https://mcp.example.com',
  },
  idempotencyKey: 'idem-1',
  reasonEntry: 'activating reviewed configuration v7',
};

describe('high-impact action gate (AC-274)', () => {
  it('allows a fully-dimensioned request and audits the ALLOW decision', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction(baseRequest);
    expect(decision.outcome).toBe('ALLOW');
    if (decision.outcome === 'ALLOW') {
      expect(decision.stepUpProofId).toBe('proof-1');
      expect(decision.idempotencyKey).toBe('idem-1');
    }
    const rows = await engine.query<{ action_class: string; subject: string }>(
      "SELECT action_class, subject FROM sec.sec_audit_events WHERE subject = 'admin:high:configuration-activate'",
    );
    expect(rows.rows.some((r) => r.action_class === 'APPROVAL_STEP_UP')).toBe(true);
  });

  it('refuses with STEP_UP_MISSING when no proof is presented', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({ ...baseRequest, stepUpProof: undefined });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toContain('STEP_UP_MISSING');
  });

  it('refuses STALE proofs against the INJECTED clock', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: goodProof({ completedAt: at('2026-07-31T23:50:00Z') }), // > 5 min old
    });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toContain('STEP_UP_STALE');
  });

  it('NEVER accepts TOTP as the sole production factor', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: goodProof({ authenticatorClass: 'RECOVERY_TOTP' }),
    });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') {
      expect(decision.reasons).toContain('AUTHENTICATOR_CLASS_INSUFFICIENT');
    }
  });

  it('refuses proofs that skip user presence/verification when required', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: goodProof({ userVerification: false }),
    });
    if (decision.outcome === 'REFUSE') {
      expect(decision.reasons).toContain('AUTHENTICATOR_CLASS_INSUFFICIENT');
    } else {
      expect.unreachable('a UV-less proof must not clear the bar');
    }
  });

  it('requires an EXACT scope match, refusing lookalike scopes', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      authorizedScopes: ['admin:high:*'], // wildcard is NOT an exact match
    });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toContain('SCOPE_MISMATCH');
  });

  it('collects EVERY missing dimension into one typed refusal', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({
      action: 'admin:high:kill-switch',
      actor: 'admin@example.com',
      authorizedScopes: ['admin:high:kill-switch'],
      policy: POLICY,
      csrf: { submittedToken: undefined, sessionToken: undefined },
      idempotencyKey: undefined,
      reasonEntry: undefined,
    });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') {
      expect(new Set(decision.reasons)).toEqual(
        new Set(['CSRF_INVALID', 'IDEMPOTENCY_KEY_MISSING', 'REASON_MISSING', 'STEP_UP_MISSING']),
      );
    }
    // Refusals are audited too.
    const rows = await engine.query<{ action_class: string; subject: string }>(
      "SELECT action_class, subject FROM sec.sec_audit_events WHERE subject = 'admin:high:kill-switch'",
    );
    expect(rows.rows.some((r) => r.action_class === 'BLOCKED_OPERATION')).toBe(true);
  });

  it('blocks ALL high-impact activation while a critical audit incident is open (T114, §35.9)', async () => {
    const { gate } = makeGate({ auditHealthBlocked: () => true });
    const decision = await gate.evaluateHighImpactAction(baseRequest);
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toEqual(['AUDIT_HEALTH_BLOCKED']);
  });
});

describe('csrf double-submit + origin binding', () => {
  it('accepts matching tokens bound to the request origin', async () => {
    const { evaluateCsrf } = await import('../src/csrf.ts');
    expect(
      evaluateCsrf({
        submittedToken: TOKEN,
        sessionToken: TOKEN,
        tokenBoundOrigin: 'https://mcp.example.com',
        requestOrigin: 'https://mcp.example.com',
      }),
    ).toEqual({ valid: true });
  });

  it('refuses short, mismatched, and cross-origin tokens with distinct reasons', async () => {
    const { evaluateCsrf } = await import('../src/csrf.ts');
    expect(evaluateCsrf({})).toEqual({ valid: false, reason: 'MISSING' });
    expect(
      evaluateCsrf({ submittedToken: 'x'.repeat(32), sessionToken: 'y'.repeat(32) }),
    ).toEqual({ valid: false, reason: 'MISMATCH' });
    expect(
      evaluateCsrf({
        submittedToken: TOKEN,
        sessionToken: TOKEN,
        tokenBoundOrigin: 'https://good.example.com',
        requestOrigin: 'https://evil.example.com',
      }),
    ).toEqual({ valid: false, reason: 'ORIGIN_BOUNDARY' });
  });
});
