// High-impact action gate (T112 + T114): fresh phishing-resistant step-up
// (TOTP never sufficient), exact Appendix B scope match, CSRF validity,
// idempotency + reason duties, typed refusal dimensions, audited decisions,
// and the §35.9 audit-health block.
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
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: undefined,
    });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toContain('STEP_UP_MISSING');
  });

  it('refuses with CSRF_INVALID when the csrf field is ABSENT — missing protection never passes', async () => {
    const { gate } = makeGate();
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      csrf: undefined,
    });
    // Every other dimension of baseRequest passes; the gate must still refuse
    // because high-impact actions FAIL without CSRF protection (AC-274).
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toEqual(['CSRF_INVALID']);
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

describe('proof ownership, skew tolerance, and audit-append coupling (M19/M11a)', () => {
  it('refuses a proof belonging to ANOTHER principal as STEP_UP_MISSING', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    const decision = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: goodProof({ actor: 'someone-else@example.com' }),
    });
    // A valid-looking proof for a different actor is NO proof for this one.
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') expect(decision.reasons).toEqual(['STEP_UP_MISSING']);
  });

  it('applies PROOF_CLOCK_SKEW_TOLERANCE to future-dated completions', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    const iso = (ms: number) =>
      new Date(ms).toISOString().replace('.000Z', 'Z') as import('@foresift/domain').UtcTimestamp;
    // 30s in the future — inside the tolerance, still admissible.
    const nearFuture = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: goodProof({ completedAt: iso(NOW_MS + 30_000) }),
    });
    expect(nearFuture.outcome).toBe('ALLOW');
    // 61s in the future — beyond tolerance: STALE, never "infinitely fresh".
    const farFuture = await gate.evaluateHighImpactAction({
      ...baseRequest,
      stepUpProof: goodProof({ completedAt: iso(NOW_MS + 61_000) }),
    });
    expect(farFuture.outcome).toBe('REFUSE');
    if (farFuture.outcome === 'REFUSE') expect(farFuture.reasons).toContain('STEP_UP_STALE');
  });

  it('wraps audit-chain append failures instead of dropping the decision', async () => {
    // §35.9: an unrecorded decision is a silent bypass. A chain that fails
    // to append must fail the GATE loudly, never swallow into a return.
    const failingChain = {
      append: async () => {
        throw new Error('storage unavailable');
      },
    } as unknown as AuditChain;
    const gate = new ActionGate({ auditChain: failingChain, clock: () => NOW_MS });
    await expect(gate.evaluateHighImpactAction(baseRequest)).rejects.toThrow(
      /failed to append gate decision to the audit chain/,
    );
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

  it('treats below-floor tokens as MISSING even when both sides MATCH (M18)', async () => {
    const { evaluateCsrf, MIN_CSRF_TOKEN_LENGTH } = await import('../src/csrf.ts');
    // A sub-floor token pair carries no forgery resistance — matching does
    // not rescue it; it is missing protection, exactly like absence.
    expect(
      evaluateCsrf({
        submittedToken: 'x'.repeat(MIN_CSRF_TOKEN_LENGTH - 1),
        sessionToken: 'x'.repeat(MIN_CSRF_TOKEN_LENGTH - 1),
      }),
    ).toEqual({ valid: false, reason: 'MISSING' });
    expect(MIN_CSRF_TOKEN_LENGTH).toBe(32);
  });

  it('refuses mismatched and cross-origin tokens with distinct reasons', async () => {
    const { evaluateCsrf } = await import('../src/csrf.ts');
    expect(evaluateCsrf({})).toEqual({ valid: false, reason: 'MISSING' });
    expect(evaluateCsrf({ submittedToken: 'x'.repeat(32), sessionToken: 'y'.repeat(32) })).toEqual({
      valid: false,
      reason: 'MISMATCH',
    });
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

// --- Shadow-safe authority (D018): numeric-index decision walks --------------

/**
 * `Array.prototype.includes` shadowed to a constant would flip BOTH the
 * phishing-resistant-class check and the exact-scope check pre-fix. The
 * numeric-index guards must ignore the shadow entirely.
 */
describe('action-gate decision gates resist Array.prototype.includes shadowing (D018)', () => {
  const proto = Array.prototype as unknown as Record<string, unknown>;

  async function withIncludes<T>(replacement: () => boolean, run: () => Promise<T>): Promise<T> {
    const original = proto.includes;
    proto.includes = replacement;
    try {
      return await run();
    } finally {
      proto.includes = original;
    }
  }

  it('still REFUSES a TOTP proof and a scope mismatch with includes shadowed to true', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    const decision = await withIncludes(
      () => true,
      () =>
        gate.evaluateHighImpactAction({
          ...baseRequest,
          authorizedScopes: ['some:other:scope'],
          stepUpProof: goodProof({ authenticatorClass: 'RECOVERY_TOTP' }),
        }),
    );
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome === 'REFUSE') {
      expect(decision.reasons).toContain('SCOPE_MISMATCH');
      expect(decision.reasons).toContain('AUTHENTICATOR_CLASS_INSUFFICIENT');
    }
  });
});

// --- V7 accessor class: every caller field is bound by a SINGLE read ----------
//
// The reproduced CRITICAL (eighth-round review, `evaluateHighImpactAction`):
// the gate read `request.action` once for the exact-scope CHECK and AGAIN for
// the decision/audit, so a plain object carrying an accessor presented
// `configuration-activate` (a scope the actor held) to the check and
// `kill-switch` to the recorded ALLOW. The same divergence on `request.actor`
// made the step-up proof OWNERSHIP check pass for `admin@example.com` while the
// audit attributed the ALLOW to `attacker@example.com`. `snapshotCallerInput`
// materializes the whole request once before any check, so both are refused.
describe('action-gate binds caller fields exactly once (V7 accessor class)', () => {
  it('does not let an `action` accessor pass the scope check and record a different action', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    let actionReads = 0;
    const request = {
      ...baseRequest,
      get action(): 'admin:high:configuration-activate' | 'admin:high:kill-switch' {
        actionReads += 1;
        return actionReads === 1 ? 'admin:high:configuration-activate' : 'admin:high:kill-switch';
      },
    };
    const decision = await gate.evaluateHighImpactAction(request);
    expect(decision.outcome).toBe('ALLOW');
    // The decision AND its audit subject must name the exact action the scope
    // check authorized. Pre-fix the second read renamed the recorded ALLOW.
    expect(decision.action).toBe('admin:high:configuration-activate');
    const rows = await engine.query<{ subject: string }>(
      "SELECT subject FROM sec.sec_audit_events WHERE action_class = 'APPROVAL_STEP_UP' AND subject = 'admin:high:kill-switch'",
    );
    expect(rows.rows.length).toBe(0);
  });

  it('does not let an `actor` accessor pass proof ownership and attribute the ALLOW elsewhere', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    let actorReads = 0;
    const request = {
      ...baseRequest,
      get actor(): string {
        actorReads += 1;
        return actorReads === 1 ? 'admin@example.com' : 'attacker@example.com';
      },
    };
    const decision = await gate.evaluateHighImpactAction(request);
    expect(decision.outcome).toBe('ALLOW');
    // Pre-fix the proof-ownership check saw `admin@example.com` (matching the
    // proof) and the decision/audit recorded `attacker@example.com`.
    expect(decision.actor).toBe('admin@example.com');
    const rows = await engine.query<{ actor: string }>(
      "SELECT actor FROM sec.sec_audit_events WHERE subject = 'admin:high:configuration-activate' AND actor = 'attacker@example.com'",
    );
    expect(rows.rows.length).toBe(0);
  });

  it('refuses a non-plain (class-instance) request carrier instead of trusting live getters', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    class RequestCarrier {
      readonly action = 'admin:high:configuration-activate' as const;
      readonly actor = 'admin@example.com';
      readonly authorizedScopes = ['admin:high:configuration-activate'] as const;
      readonly policy = POLICY;
      readonly stepUpProof = goodProof();
      readonly csrf = baseRequest.csrf;
      readonly idempotencyKey = 'idem-1';
      readonly reasonEntry = 'activating reviewed configuration v7';
    }
    await expect(gate.evaluateHighImpactAction(new RequestCarrier())).rejects.toThrow(TypeError);
    // A Proxy whose prototype trap reports a class carrier is refused the same way.
    const disguised = new Proxy(
      { ...baseRequest },
      { getPrototypeOf: () => RequestCarrier.prototype },
    );
    await expect(gate.evaluateHighImpactAction(disguised)).rejects.toThrow(TypeError);
  });

  it('neutralizes a Proxy get trap by reading each field exactly once', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    let actionReads = 0;
    const proxy = new Proxy(
      { ...baseRequest },
      {
        get(target, property, receiver) {
          if (property === 'action') {
            actionReads += 1;
            return actionReads === 1
              ? 'admin:high:configuration-activate'
              : 'admin:high:kill-switch';
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const decision = await gate.evaluateHighImpactAction(proxy);
    expect(decision.outcome).toBe('ALLOW');
    expect(decision.action).toBe('admin:high:configuration-activate');
  });
});

// --- V7 security-review HIGH H2/H3: malformed gate requests never admit ------
//
// H2: an ALLOW whose `action` is not a real high-impact action and/or whose
// `actor` is empty was admitted — the gate trusted the caller's own naming of
// the subject it was authorizing. H3: an absent/NaN/Infinity
// `policy.freshnessWindowSeconds` made every freshness comparison false, so
// proof freshness was silently disabled. Both are refused with a typed code
// BEFORE any dimension evaluates.
describe('action-gate refuses malformed requests (V7 review H2/H3)', () => {
  it('REFUSES an action outside the Appendix B catalog instead of admitting it (H2)', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    // Everything else is perfectly dimensioned, so pre-fix this returned ALLOW.
    await expect(
      gate.evaluateHighImpactAction({
        ...baseRequest,
        action: 'not-a-real-action' as never,
        authorizedScopes: ['not-a-real-action'],
      }),
    ).rejects.toMatchObject({ code: 'SEC_ACTION_GATE_INVALID_ACTION' });
  });

  it('REFUSES an empty actor instead of attributing an ALLOW (H2)', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    await expect(
      gate.evaluateHighImpactAction({
        ...baseRequest,
        actor: '',
        stepUpProof: goodProof({ actor: '' }),
      }),
    ).rejects.toMatchObject({ code: 'SEC_ACTION_GATE_INVALID_ACTOR' });
  });

  it('REFUSES a non-catalog action even when the scope array names it exactly (H2)', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    for (const action of ['admin:high:', '', 'admin:high:*']) {
      await expect(
        gate.evaluateHighImpactAction({
          ...baseRequest,
          action: action as never,
          authorizedScopes: [action],
        }),
      ).rejects.toMatchObject({ code: 'SEC_ACTION_GATE_INVALID_ACTION' });
    }
  });

  it('REFUSES an absent/NaN/Infinity freshness window instead of skipping staleness (H3)', async () => {
    const gate = new ActionGate({ clock: () => NOW_MS });
    const ancient = goodProof({ completedAt: at('2020-01-01T00:00:00Z') });
    for (const freshnessWindowSeconds of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      1.5,
    ]) {
      await expect(
        gate.evaluateHighImpactAction({
          ...baseRequest,
          policy: { ...POLICY, freshnessWindowSeconds: freshnessWindowSeconds as number },
          stepUpProof: ancient,
        }),
      ).rejects.toMatchObject({ code: 'SEC_ACTION_GATE_INVALID_POLICY' });
    }
  });
});
