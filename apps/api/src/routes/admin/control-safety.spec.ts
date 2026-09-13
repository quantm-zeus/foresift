/**
 * High-impact admin control guard tests on PGlite
 * (T013, T011, FR-ADM-003/007, §28.3/§28.4/§35.1; AC-014, AC-063, AC-262).
 *
 * Proves the §35.1 guard delegates authorization to `@foresift/security`'s
 * ActionGate, refuses typed, audits every decision, enforces immutable
 * configuration versions and the governed §28.3 lifecycle, and validates the
 * §28.4 resolved-configuration precedence chain.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { DatabaseEngine } from '@foresift/persistence';
import type { CsrfEvaluationInput } from '@foresift/security';
import type { ConfigVersionRow, StepUpPolicy, StepUpProof } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../../../tests/acceptance/helpers.ts';
import {
  AdminControlError,
  assertConfigVersionMutationAllowed,
  assertResolvedPrecedenceOrdered,
  createAdminControlGuard,
  type AdminControlActionInput,
  type AdminControlGuard,
} from './control-safety.ts';

const NOW_MS = Date.parse('2026-09-01T12:00:00Z');
const ACTOR = 'admin@example.com';
const TOKEN = 'c'.repeat(32);
const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const AT = '2026-09-01T12:00:00Z';
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

let sequence = 0;
function nextKey(): string {
  sequence += 1;
  return `cs-idem-${sequence}`;
}

function proof(overrides: Partial<StepUpProof> = {}): StepUpProof {
  sequence += 1;
  return {
    proofId: `cs-proof-${sequence}`,
    actor: ACTOR,
    authenticatorClass: 'PASSKEY_PLATFORM',
    completedAt: '2026-09-01T11:58:00Z',
    userPresence: true,
    userVerification: true,
    challengeRef: 'challenge://admin',
    ...overrides,
  };
}

const configDraft: ConfigVersionRow = {
  configVersionId: 'cfg-draft-1',
  configKind: 'SCHEDULE',
  configId: 'schedule-1',
  version: 1,
  ownerVersionRef: null,
  configHash: HASH,
  lifecycleState: 'DRAFT',
  resolvedConfig: { cron: '0 * * * *' },
  resolvedConfigHash: HASH_B,
  supersededBy: null,
  rolledBackFrom: null,
  approvedByRef: null,
  createdAt: AT,
};

let tdb: TestDatabase;
let engine: DatabaseEngine;
let guard: AdminControlGuard;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  engine = tdb.engine;
  guard = createAdminControlGuard({ engine, clock: () => NOW_MS });
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function refusalCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof AdminControlError ? error.code : undefined;
  }
  return undefined;
}

async function auditCount(outcome: 'ALLOWED' | 'REFUSED', refusalCode?: string): Promise<number> {
  const rows = await engine.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM adm.admin_action_audit
      WHERE outcome = $1 AND ($2::text IS NULL OR refusal_code = $2)`,
    [outcome, refusalCode ?? null],
  );
  return rows.rows[0]?.count ?? 0;
}

function actionInput(overrides: Record<string, unknown> = {}): AdminControlActionInput {
  return {
    actionKind: 'SCHEDULE_ENABLE',
    targetRef: 'schedule-1',
    targetVersionRef: 'wf-version-3',
    actorRef: ACTOR,
    reason: 'enabling a reviewed schedule',
    idempotencyKey: nextKey(),
    stepUpProof: proof(),
    csrf: CSRF,
    authorizedScopes: ['admin:high:configuration-activate'],
    policy: POLICY,
    ...overrides,
  } as AdminControlActionInput;
}

describe('§35.1 authorization guard', () => {
  it('allows a fully-dimensioned action and audits the ALLOWED decision', async () => {
    const input = actionInput();
    const allowedBefore = await auditCount('ALLOWED');
    const authorized = await guard.authorize(input);
    expect(authorized.request.idempotencyKey.length).toBeGreaterThan(0);
    expect(authorized.decision.action).toBe('admin:high:configuration-activate');
    await guard.recordAllowed(engine, authorized, {
      beforeHash: HASH,
      afterHash: HASH_B,
      auditRef: 'audit:schedule-enable',
    });
    expect(await auditCount('ALLOWED')).toBe(allowedBefore + 1);
    const row = await engine.query<{
      outcome: string;
      before_hash: string;
      after_hash: string;
      step_up_ref: string;
      csrf_ref: string;
    }>(
      `SELECT outcome, before_hash, after_hash, step_up_ref, csrf_ref
         FROM adm.admin_action_audit WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    expect(row.rows[0]?.outcome).toBe('ALLOWED');
    expect(row.rows[0]?.before_hash).toBe(HASH);
    expect(row.rows[0]?.after_hash).toBe(HASH_B);
    expect(row.rows[0]?.step_up_ref).toBe(authorized.decision.stepUpProofId);
    // The CSRF evidence is recorded as a non-secret digest, never a raw token.
    expect(row.rows[0]?.csrf_ref?.startsWith('sha256:')).toBe(true);
    expect(row.rows[0]?.csrf_ref).not.toContain(TOKEN);
  }, 120_000);

  it('records exactly one ALLOWED row through the delegated run wrapper', async () => {
    const input = actionInput();
    const allowedBefore = await auditCount('ALLOWED');
    const result = await guard.run(input, async (authorized, recordAllowed) => {
      await recordAllowed({ afterHash: HASH });
      return authorized.request.actionKind;
    });
    expect(result).toBe('SCHEDULE_ENABLE');
    expect(await auditCount('ALLOWED')).toBe(allowedBefore + 1);
    const rows = await engine.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM adm.admin_action_audit WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    expect(rows.rows[0]?.count).toBe(1);
  }, 120_000);

  it('refuses an unknown control action typed and audited', async () => {
    const before = await auditCount('REFUSED', 'ADMIN_CONTROL_ACTION_UNKNOWN');
    const code = await refusalCode(() => guard.authorize(actionInput({ actionKind: 'NUKE' })));
    expect(code).toBe('ADMIN_CONTROL_ACTION_UNKNOWN');
    expect(await auditCount('REFUSED', 'ADMIN_CONTROL_ACTION_UNKNOWN')).toBe(before + 1);
  }, 120_000);

  it('refuses a mismatched authorization scope and an empty reason', async () => {
    const scopeCode = await refusalCode(() =>
      guard.authorize(actionInput({ authorizedScopes: ['admin:high:kill-switch'] })),
    );
    expect(scopeCode).toBe('ADMIN_ACTION_SCOPE_MISMATCH');
    const reasonCode = await refusalCode(() => guard.authorize(actionInput({ reason: '' })));
    expect(reasonCode).toBe('ADMIN_REASON_MISSING');
  }, 120_000);

  it('exposes a stable code and correlation id on every refusal', async () => {
    let caught: unknown;
    try {
      await guard.authorize(actionInput({ actionKind: 'NUKE' }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdminControlError);
    const controlError = caught as AdminControlError;
    expect(controlError.code).toBe('ADMIN_CONTROL_ACTION_UNKNOWN');
    expect(controlError.correlationId.length).toBeGreaterThan(0);
    expect(controlError.name).toBe('AdminControlError');
  }, 120_000);
});

describe('§28.3 immutable-version enforcement', () => {
  it('refuses an in-place content mutation (an edit creates a new version)', () => {
    let caught: unknown;
    try {
      assertConfigVersionMutationAllowed(configDraft, { configHash: HASH_B });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdminControlError);
    expect((caught as AdminControlError).code).toBe('ADMIN_CONFIG_VERSION_IMMUTABLE');
  });

  it('refuses an illegal lifecycle jump and allows the governed one', () => {
    const jump = refusalCodeSync(() =>
      assertConfigVersionMutationAllowed(configDraft, { lifecycleState: 'ACTIVE' }),
    );
    expect(jump).toBe('ADMIN_CONFIG_LIFECYCLE_TRANSITION_INVALID');
    expect(() =>
      assertConfigVersionMutationAllowed(configDraft, { lifecycleState: 'VALIDATED' }),
    ).not.toThrow();
  });

  it('allows superseding exactly once and refuses a second supersede', () => {
    expect(() =>
      assertConfigVersionMutationAllowed(configDraft, {
        supersededBy: 'cfg-draft-2',
      }),
    ).not.toThrow();
    const superseded: ConfigVersionRow = {
      ...configDraft,
      supersededBy: 'cfg-draft-2',
    };
    const code = refusalCodeSync(() =>
      assertConfigVersionMutationAllowed(superseded, { supersededBy: 'cfg-draft-3' }),
    );
    expect(code).toBe('ADMIN_CONFIG_VERSION_IMMUTABLE');
  });
});

describe('§28.4 resolved-configuration precedence', () => {
  it('accepts the canonical chain and refuses a reordered one', () => {
    expect(() =>
      assertResolvedPrecedenceOrdered(['SYSTEM_DEFAULTS', 'WORKFLOW_VERSION', 'SCHEDULE_VERSION']),
    ).not.toThrow();
    let caught: unknown;
    try {
      assertResolvedPrecedenceOrdered(['SCHEDULE_VERSION', 'WORKFLOW_VERSION']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AdminControlError);
    expect((caught as AdminControlError).code).toBe('ADMIN_RESOLVED_PREVIEW_PRECEDENCE_INVALID');
  });
});

function refusalCodeSync(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof AdminControlError ? error.code : undefined;
  }
  return undefined;
}
