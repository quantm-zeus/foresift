/**
 * Fail-closed kill-switch tests on PGlite
 * (T013, FR-ADM-007, §28.13, §35.1; AC-014, AC-061, AC-262).
 *
 * Proves: all six switches default closed with no state row AND when the state
 * read fails; an ENGAGED switch refuses every gated kind; the emergency
 * read-only switch permits reads, refuses writes, and dominates every other
 * switch; every refusal is typed and audited; a stale step-up, missing CSRF,
 * missing idempotency key, missing reason, or TOTP-only proof is refused and
 * audited; a replayed engage collapses on the idempotency key and changes
 * nothing; and there is no automatic reactivation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  ALL_KILL_SWITCH_KINDS,
  type KillSwitchKind,
  type KillSwitchScope,
} from '@foresift/shared-schemas';
import type { CsrfEvaluationInput } from '@foresift/security';
import type { StepUpPolicy, StepUpProof } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../../../tests/acceptance/helpers.ts';
import { AdminControlError, createAdminControlGuard } from './control-safety.ts';
import { createKillSwitchResolver, type KillSwitchResolver } from './kill-switches.ts';

const NOW_MS = Date.parse('2026-09-01T12:00:00Z');
const ACTOR = 'admin@example.com';
const TOKEN = 'c'.repeat(32);
const POLICY: StepUpPolicy = {
  freshnessWindowSeconds: 300,
  minimumAuthenticatorClass: 'HARDWARE_SECURITY_KEY',
  requireUserPresence: true,
  requireUserVerification: true,
};
const CSRF: CsrfEvaluationInput = {
  submittedToken: TOKEN,
  sessionToken: TOKEN,
  tokenBoundOrigin: 'https://admin.example.com',
  requestOrigin: 'https://admin.example.com',
};

let transitionSequence = 0;

function proof(overrides: Partial<StepUpProof> = {}): StepUpProof {
  return {
    proofId: `proof-${(transitionSequence += 1)}`,
    actor: ACTOR,
    authenticatorClass: 'PASSKEY_PLATFORM',
    completedAt: '2026-09-01T11:58:00Z',
    userPresence: true,
    userVerification: true,
    challengeRef: 'challenge://admin',
    ...overrides,
  };
}

function scope(ref: string): KillSwitchScope {
  return { scopeKind: 'GLOBAL', scopeRef: ref };
}

let tdb: TestDatabase;
let resolver: KillSwitchResolver;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  resolver = createKillSwitchResolver({
    engine: tdb.engine,
    guard: createAdminControlGuard({ engine: tdb.engine, clock: () => NOW_MS }),
    clock: () => NOW_MS,
  });
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function engageInput(
  kind: KillSwitchKind,
  ref: string,
  overrides: Record<string, unknown> = {},
): Parameters<KillSwitchResolver['engage']>[0] {
  transitionSequence += 1;
  return {
    switchKind: kind,
    scope: scope(ref),
    actorRef: ACTOR,
    reason: `engaging ${kind}`,
    idempotencyKey: `idem-${transitionSequence}`,
    stepUpProof: proof(),
    csrf: CSRF,
    authorizedScopes: ['admin:high:kill-switch'],
    policy: POLICY,
    ...overrides,
  } as Parameters<KillSwitchResolver['engage']>[0];
}

async function refusalCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof AdminControlError ? error.code : undefined;
  }
  return undefined;
}

async function auditCount(outcome: 'ALLOWED' | 'REFUSED', refusalCode?: string): Promise<number> {
  const rows = await tdb.engine.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM adm.admin_action_audit
      WHERE outcome = $1 AND ($2::text IS NULL OR refusal_code = $2)`,
    [outcome, refusalCode ?? null],
  );
  return rows.rows[0]?.count ?? 0;
}

describe('fail-closed default resolution', () => {
  it('resolves every one of the six switches closed when no state row exists', async () => {
    for (const kind of ALL_KILL_SWITCH_KINDS) {
      const resolution = await resolver.resolve(kind, scope(`empty-${kind}`));
      expect(resolution.state).toBe('ENGAGED');
      expect(resolution.closed).toBe(true);
      expect(resolution.stateRowId).toBeNull();
    }
  }, 120_000);

  it('refuses gated calls for every kind while no state is recorded', async () => {
    for (const kind of ALL_KILL_SWITCH_KINDS) {
      if (kind === 'EMERGENCY_READ_ONLY_MODE') continue;
      const code = await refusalCode(() =>
        resolver.assertCallAllowed(kind, { access: 'WRITE', scope: scope(`empty-${kind}`) }),
      );
      expect(code).toBe('ADMIN_KILL_SWITCH_ENGAGED');
    }
  }, 120_000);

  it('resolves closed (degraded) when the state read fails', async () => {
    const brokenEngine: DatabaseEngine = {
      engineKind: 'pglite',
      async exec(): Promise<void> {},
      async query(): Promise<never> {
        throw new Error('kill-switch state store unavailable');
      },
      async transaction<T>(work: (engine: DatabaseEngine) => Promise<T>): Promise<T> {
        return work(brokenEngine);
      },
    };
    const brokenResolver = createKillSwitchResolver({ engine: brokenEngine, clock: () => NOW_MS });
    const resolution = await brokenResolver.resolve('DISABLE_ALL_AUTOMATION', scope('broken'));
    expect(resolution.state).toBe('ENGAGED');
    expect(resolution.degraded).toBe(true);
    const code = await refusalCode(() =>
      brokenResolver.assertCallAllowed('DISABLE_ALL_AUTOMATION', {
        access: 'WRITE',
        scope: scope('broken'),
      }),
    );
    expect(code).toBe('ADMIN_KILL_SWITCH_ENGAGED');
  }, 120_000);

  it('refuses an unknown switch kind typed instead of guessing', async () => {
    const code = await refusalCode(() => resolver.resolve('NUKE_EVERYTHING', scope('unknown')));
    expect(code).toBe('ADMIN_KILL_SWITCH_KIND_UNKNOWN');
    const callCode = await refusalCode(() =>
      resolver.assertCallAllowed('NUKE_EVERYTHING', { access: 'WRITE', scope: scope('unknown') }),
    );
    expect(callCode).toBe('ADMIN_KILL_SWITCH_KIND_UNKNOWN');
  }, 120_000);

  it('treats an expired DISENGAGED state as closed', async () => {
    const ref = 'expired';
    const scopeHash = sha256Text(canonicalJson(scope(ref)));
    await tdb.engine.query(
      `INSERT INTO adm.kill_switch_states
         (state_row_id, switch_kind, scope, scope_hash, state, reason, actor_ref,
          step_up_ref, audit_ref, expires_at, created_at)
       VALUES ('ks-expired', 'DISABLE_NOTIFICATIONS', $1::jsonb, $2, 'DISENGAGED',
               'temporary release', $3, 'proof-expired', 'audit-expired',
               '2026-09-01T11:00:00Z', '2026-09-01T10:00:00Z')`,
      [JSON.stringify(scope(ref)), scopeHash, ACTOR],
    );
    const resolution = await resolver.resolve('DISABLE_NOTIFICATIONS', scope(ref));
    expect(resolution.closed).toBe(true);
    expect(resolution.degraded).toBe(true);
  }, 120_000);
});

describe('engaged switches gate every gated kind', () => {
  it('refuses reads and writes for an engaged switch', async () => {
    await resolver.engage(engageInput('DISABLE_ALL_MODEL_CALLS', 'engaged-model'));
    await expect(
      resolver.assertCallAllowed('DISABLE_ALL_MODEL_CALLS', {
        access: 'WRITE',
        scope: scope('engaged-model'),
        callRef: 'model:route',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_KILL_SWITCH_ENGAGED' });
    await expect(
      resolver.assertCallAllowed('DISABLE_ALL_MODEL_CALLS', {
        access: 'READ',
        scope: scope('engaged-model'),
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_KILL_SWITCH_ENGAGED' });
  }, 120_000);

  it('lets EMERGENCY_READ_ONLY_MODE permit reads and refuse writes, dominating other switches', async () => {
    await resolver.engage(engageInput('EMERGENCY_READ_ONLY_MODE', 'emergency'));
    // Reads keep read-only intelligence working.
    await expect(
      resolver.assertCallAllowed('EMERGENCY_READ_ONLY_MODE', {
        access: 'READ',
        scope: scope('emergency'),
      }),
    ).resolves.toMatchObject({ closed: true });
    // Every write/automation path is refused.
    await expect(
      resolver.assertCallAllowed('EMERGENCY_READ_ONLY_MODE', {
        access: 'WRITE',
        scope: scope('emergency'),
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_KILL_SWITCH_ENGAGED' });
    // Dominance: an unrelated, DISENGAGED switch cannot authorize a write.
    await resolver.release(
      engageInput('DISABLE_NOTIFICATIONS', 'emergency', { reason: 'no notification outage' }),
    );
    const releaseCode = await refusalCode(() =>
      resolver.assertCallAllowed('DISABLE_NOTIFICATIONS', {
        access: 'WRITE',
        scope: scope('emergency'),
      }),
    );
    expect(releaseCode).toBe('ADMIN_KILL_SWITCH_ENGAGED');
  }, 120_000);
});

describe('every transition and refusal is audited', () => {
  it('records an ALLOWED audit row for a successful engage', async () => {
    const before = await auditCount('ALLOWED');
    const result = await resolver.engage(engageInput('DISABLE_NOTIFICATIONS', 'audit-engage'));
    expect(result.replayed).toBe(false);
    expect(await auditCount('ALLOWED')).toBe(before + 1);
  }, 120_000);

  it('refuses and audits a stale step-up, missing CSRF, missing idempotency, missing reason, and TOTP-only proof', async () => {
    const cases: readonly {
      ref: string;
      overrides: Record<string, unknown>;
      code: string;
      kind: KillSwitchKind;
    }[] = [
      {
        ref: 'refuse-stale',
        kind: 'DISABLE_ALL_AUTOMATION',
        overrides: { stepUpProof: proof({ completedAt: '2026-09-01T11:00:00Z' }) },
        code: 'ADMIN_STEP_UP_STALE',
      },
      {
        ref: 'refuse-csrf',
        kind: 'DISABLE_ALL_AUTOMATION',
        overrides: { csrf: undefined },
        code: 'ADMIN_CSRF_INVALID',
      },
      {
        ref: 'refuse-idempotency',
        kind: 'DISABLE_ALL_AUTOMATION',
        overrides: { idempotencyKey: undefined },
        code: 'ADMIN_IDEMPOTENCY_KEY_MISSING',
      },
      {
        ref: 'refuse-reason',
        kind: 'DISABLE_ALL_AUTOMATION',
        overrides: { reason: undefined },
        code: 'ADMIN_REASON_MISSING',
      },
      {
        ref: 'refuse-totp',
        kind: 'DISABLE_ALL_AUTOMATION',
        overrides: { stepUpProof: proof({ authenticatorClass: 'RECOVERY_TOTP' }) },
        code: 'ADMIN_AUTHENTICATOR_CLASS_INSUFFICIENT',
      },
    ];
    for (const testCase of cases) {
      const before = await auditCount('REFUSED', testCase.code);
      const code = await refusalCode(() =>
        resolver.engage(engageInput(testCase.kind, testCase.ref, testCase.overrides)),
      );
      expect(code).toBe(testCase.code);
      expect(await auditCount('REFUSED', testCase.code)).toBe(before + 1);
    }
  }, 120_000);
});

describe('replay collapse and no automatic reactivation', () => {
  it('collapses a replayed engage on the idempotency key and changes nothing', async () => {
    const input = engageInput('DISABLE_ALL_PROVIDER_CALLS', 'replay');
    const first = await resolver.engage(input);
    const eventsAfterFirst = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.kill_switch_events WHERE scope_hash = $1`,
      [sha256Text(canonicalJson(input.scope))],
    );
    const statesAfterFirst = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.kill_switch_states WHERE scope_hash = $1`,
      [sha256Text(canonicalJson(input.scope))],
    );
    const second = await resolver.engage(input);
    expect(second.replayed).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    const eventsAfterReplay = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.kill_switch_events WHERE scope_hash = $1`,
      [sha256Text(canonicalJson(input.scope))],
    );
    const statesAfterReplay = await tdb.engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.kill_switch_states WHERE scope_hash = $1`,
      [sha256Text(canonicalJson(input.scope))],
    );
    expect(eventsAfterReplay.rows[0]?.count).toBe(eventsAfterFirst.rows[0]?.count);
    expect(statesAfterReplay.rows[0]?.count).toBe(statesAfterFirst.rows[0]?.count);
  }, 120_000);

  it('refuses reusing one idempotency key for a different transition', async () => {
    const first = engageInput('DISABLE_ALL_AUTOMATION', 'reuse-key');
    await resolver.engage(first);
    const code = await refusalCode(() =>
      resolver.engage({ ...first, switchKind: 'REVOKE_ALL_MCP_CLIENTS' }),
    );
    expect(code).toBe('ADMIN_KILL_SWITCH_TRANSITION_INVALID');
  }, 120_000);

  it('keeps an engaged switch closed until an explicit release, then releases it', async () => {
    const input = engageInput('REVOKE_ALL_MCP_CLIENTS', 'no-reactivation');
    await resolver.engage(input);
    // Repeated resolution never reactivates on its own.
    expect(
      (await resolver.resolve('REVOKE_ALL_MCP_CLIENTS', scope('no-reactivation'))).closed,
    ).toBe(true);
    expect((await resolver.resolve('REVOKE_ALL_MCP_CLIENTS', scope('no-reactivation'))).state).toBe(
      'ENGAGED',
    );
    const open = await tdb.engine.query<{ superseded_by: string | null }>(
      `SELECT superseded_by FROM adm.kill_switch_states
        WHERE switch_kind = 'REVOKE_ALL_MCP_CLIENTS' AND superseded_by IS NULL`,
    );
    expect(open.rows).toHaveLength(1);
    expect(open.rows[0]?.superseded_by).toBeNull();

    // Only an explicit release (with its own fresh step-up) opens it.
    await resolver.release(engageInput('REVOKE_ALL_MCP_CLIENTS', 'no-reactivation'));
    const released = await resolver.resolve('REVOKE_ALL_MCP_CLIENTS', scope('no-reactivation'));
    expect(released.state).toBe('DISENGAGED');
    expect(released.closed).toBe(false);
    // A missing EMERGENCY state still resolves closed, so the write stays
    // refused until that switch is explicitly released for the same scope.
    await expect(
      resolver.assertCallAllowed('REVOKE_ALL_MCP_CLIENTS', {
        access: 'WRITE',
        scope: scope('no-reactivation'),
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_KILL_SWITCH_ENGAGED' });
    await resolver.release(
      engageInput('EMERGENCY_READ_ONLY_MODE', 'no-reactivation', {
        reason: 'read-only emergency cleared after review',
      }),
    );
    await expect(
      resolver.assertCallAllowed('REVOKE_ALL_MCP_CLIENTS', {
        access: 'WRITE',
        scope: scope('no-reactivation'),
      }),
    ).resolves.toMatchObject({ closed: false });
  }, 120_000);
});
