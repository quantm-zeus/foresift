// Verification TTLs (FR-PROV-002; AC-270): fail-closed TTL configuration,
// injected-clock freshness, the OFFICIAL_DOC+LIVE_CONTRACT refresh-pair rule,
// expiry sweeps mapping kinds to §15.4 health outcomes, and resume-after-
// refresh that refuses anything less than complete pairs.
import { describe, expect, it } from 'vitest';
import { fixedClock } from '@foresift/domain';
import type { UtcTimestamp } from '@foresift/domain';
import { DECISION_CRITICAL_VERIFICATION_KINDS } from '../src/vocabularies.ts';
import type { OperationRef } from '../src/index.ts';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const at = (iso: string) => iso as UtcTimestamp;

/** Drive an operation DISCOVERED→VERIFIED→ACTIVE. */
async function activate(stack: Awaited<ReturnType<typeof makeProvStack>>) {
  const op = await seedOperation(stack);
  await stack.machine.transition({
    ref: op,
    to: 'VERIFIED',
    reasonClass: 'REGISTRATION_VERIFIED',
    actor: 'test',
    occurredAt: T0,
    effectiveAt: T0,
    idempotencyKey: 'act-1',
  });
  await stack.machine.transition({
    ref: op,
    to: 'ACTIVE',
    reasonClass: 'OPERATION_ACTIVATED',
    actor: 'test',
    occurredAt: T0,
    effectiveAt: T0,
    idempotencyKey: 'act-2',
  });
  return op;
}

function configureAllCriticalTtls(
  stack: Awaited<ReturnType<typeof makeProvStack>>,
  ttlSeconds: number,
) {
  return Promise.all(
    DECISION_CRITICAL_VERIFICATION_KINDS.map((kind) =>
      stack.verifications.configureTtl({ configId: `ttl-${kind}`, kind, ttlSeconds }),
    ),
  );
}

async function recordFullPairs(
  stack: Awaited<ReturnType<typeof makeProvStack>>,
  ref: OperationRef,
  verifiedAt: UtcTimestamp,
) {
  for (const kind of DECISION_CRITICAL_VERIFICATION_KINDS) {
    await stack.verifications.recordVerification({
      ref,
      kind,
      source: 'OFFICIAL_DOC',
      outcome: 'PASS',
      verifiedAt,
      evidenceRefs: [`doc:${kind}`],
      recordedBy: 'test',
      idempotencyKey: `${kind}:doc:${verifiedAt}`,
    });
    await stack.verifications.recordVerification({
      ref,
      kind,
      source: 'LIVE_CONTRACT',
      outcome: 'PASS',
      verifiedAt,
      evidenceRefs: [`live:${kind}`],
      recordedBy: 'test',
      idempotencyKey: `${kind}:live:${verifiedAt}`,
    });
  }
}

describe('verification TTL engine', () => {
  it('refuses freshness when NO ttl is configured anywhere (fail-closed default)', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await expect(stack.verifications.ttlSecondsFor(op.providerId, 'DOCUMENTATION')).rejects.toMatchObject({
        code: 'PROV_VERIFICATION_TTL_UNCONFIGURED',
      });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('resolves provider-specific rows ahead of the wildcard', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.verifications.configureTtl({ configId: 'c1', kind: 'DOCUMENTATION', ttlSeconds: 86_400 });
      await stack.verifications.configureTtl({
        configId: 'c2',
        providerId: op.providerId,
        kind: 'DOCUMENTATION',
        ttlSeconds: 60,
      });
      expect(await stack.verifications.ttlSecondsFor(op.providerId, 'DOCUMENTATION')).toBe(60);
      expect(await stack.verifications.ttlSecondsFor('other-provider', 'DOCUMENTATION')).toBe(86_400);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('computes expires_at = verified_at + ttl and is idempotent on caller keys', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.verifications.configureTtl({ configId: 'c1', kind: 'SCHEMA', ttlSeconds: 3_600 });
      const record = await stack.verifications.recordVerification({
        ref: op,
        kind: 'SCHEMA',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: at('2026-08-01T00:00:00Z'),
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'schema-doc-1',
      });
      expect(record.expiresAt).toBe('2026-08-01T01:00:00Z');
      const replay = await stack.verifications.recordVerification({
        ref: op,
        kind: 'SCHEMA',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: at('2026-08-01T00:00:00Z'),
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'schema-doc-1',
      });
      expect(replay.recordId).toBe(record.recordId);
      const all = await stack.engine.query('SELECT * FROM prov.prov_verification_records');
      expect(all.rows).toHaveLength(1);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('AC-270: active use requires EVERY critical kind fresh via BOTH sources', async () => {
    const stack = await makeProvStack();
    try {
      const op = await activate(stack);
      await configureAllCriticalTtls(stack, 3_600);
      // Nothing recorded yet → expired refusal.
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, fixedClock(T0)),
      ).rejects.toMatchObject({ code: 'PROV_VERIFICATION_EXPIRED' });

      // Full pairs → usable.
      await recordFullPairs(stack, op, T0);
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, fixedClock(T0)),
      ).resolves.toBeUndefined();

      // Two hours later everything lapsed → refused again.
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, fixedClock(at('2026-08-01T02:00:00Z'))),
      ).rejects.toMatchObject({ code: 'PROV_VERIFICATION_EXPIRED' });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('AC-270 negative: a single-source history can NEVER satisfy a lapsed kind', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await stack.verifications.configureTtl({ configId: 'ttl-schema', kind: 'SCHEMA', ttlSeconds: 3_600 });
      // Only OFFICIAL_DOC half of the pair.
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'SCHEMA',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: T0,
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'only-doc',
      });
      await expect(
        stack.verifications.resumeAfterRefresh(op, fixedClock(at('2026-08-01T00:30:00Z')), {
          actor: 'test',
          occurredAt: at('2026-08-01T00:30:00Z'),
          idempotencyKey: 'resume-1',
          kinds: ['SCHEMA'],
        }),
      ).rejects.toMatchObject({ code: 'PROV_REFRESH_PAIR_INCOMPLETE' });
      // Adding the LIVE_CONTRACT half within TTL completes the pair.
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'SCHEMA',
        source: 'LIVE_CONTRACT',
        outcome: 'PASS',
        verifiedAt: at('2026-08-01T00:10:00Z'),
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'live-half',
      });
      await expect(
        stack.verifications.resumeAfterRefresh(op, fixedClock(at('2026-08-01T00:30:00Z')), {
          actor: 'test',
          occurredAt: at('2026-08-01T00:30:00Z'),
          idempotencyKey: 'resume-2',
          kinds: ['SCHEMA'],
        }),
      ).resolves.toEqual({ resumed: true });
    } finally {
      await closeProvStack(stack);
    }
  });

  it('sweeps exactly the lapsed kind into its mapped health outcome without mutating history', async () => {
    const stack = await makeProvStack();
    try {
      const op = await activate(stack);
      // Everything long-fresh EXCEPT PRICING_PLAN, whose short TTL lapses.
      await configureAllCriticalTtls(stack, 86_400);
      await stack.verifications.configureTtl({ configId: 'ttl-short', kind: 'PRICING_PLAN', ttlSeconds: 600 });
      await recordFullPairs(stack, op, T0);
      const recordsBefore = JSON.stringify(
        (await stack.engine.query('SELECT * FROM prov.prov_verification_records ORDER BY record_id')).rows,
      );

      const swept = await stack.verifications.sweepExpired(fixedClock(at('2026-08-01T00:11:00Z')), {
        actor: 'ttl-sweep',
        occurredAt: at('2026-08-01T00:11:00Z'),
        sweepRunId: 'sweep-run-9',
      });
      expect(swept).toHaveLength(1);
      expect(swept[0]?.kind).toBe('PRICING_PLAN');
      expect(swept[0]?.healthOutcome).toBe('PLAN_UNVERIFIED');
      expect(await stack.machine.currentState(op)).toBe('DEGRADED');
      expect(await stack.machine.currentHealthStatus(op)).toBe('PLAN_UNVERIFIED');

      // Historical verification records untouched by the sweep.
      expect(
        JSON.stringify(
          (await stack.engine.query('SELECT * FROM prov.prov_verification_records ORDER BY record_id')).rows,
        ),
      ).toBe(recordsBefore);

      // Re-running the SAME sweep id appends nothing new.
      await stack.verifications.sweepExpired(fixedClock(at('2026-08-01T00:11:00Z')), {
        actor: 'ttl-sweep',
        occurredAt: at('2026-08-01T00:11:00Z'),
        sweepRunId: 'sweep-run-9',
      });
      const expiryEvents = await stack.engine.query<{ reason_class: string }>(
        "SELECT reason_class FROM prov.prov_lifecycle_events WHERE reason_class LIKE 'VERIFICATION_EXPIRED_%'",
      );
      expect(expiryEvents.rows).toHaveLength(1);
    } finally {
      await closeProvStack(stack);
    }
  });

  it('resume after refresh transitions DEGRADED back to ACTIVE only on complete pairs', async () => {
    const stack = await makeProvStack();
    try {
      const op = await activate(stack);
      await configureAllCriticalTtls(stack, 86_400);
      await stack.verifications.configureTtl({ configId: 'ttl-endpoint', kind: 'ENDPOINT', ttlSeconds: 600 });
      await recordFullPairs(stack, op, T0);
      await stack.verifications.sweepExpired(fixedClock(at('2026-08-01T00:11:00Z')), {
        actor: 'ttl-sweep',
        occurredAt: at('2026-08-01T00:11:00Z'),
        sweepRunId: 'sweep-a',
      });
      expect(await stack.machine.currentState(op)).toBe('DEGRADED');

      // Half a pair is not enough.
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'ENDPOINT',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: at('2026-08-01T00:25:00Z'),
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'ep-doc',
      });
      await expect(
        stack.verifications.resumeAfterRefresh(op, fixedClock(at('2026-08-01T00:26:00Z')), {
          actor: 'test',
          occurredAt: at('2026-08-01T00:26:00Z'),
          idempotencyKey: 'resume-half',
          kinds: ['ENDPOINT'],
        }),
      ).rejects.toMatchObject({ code: 'PROV_REFRESH_PAIR_INCOMPLETE' });
      expect(await stack.machine.currentState(op)).toBe('DEGRADED');

      // Completing the pair resumes active service.
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'ENDPOINT',
        source: 'LIVE_CONTRACT',
        outcome: 'PASS',
        verifiedAt: at('2026-08-01T00:25:00Z'),
        evidenceRefs: ['e'],
        recordedBy: 'test',
        idempotencyKey: 'ep-live',
      });
      await expect(
        stack.verifications.resumeAfterRefresh(op, fixedClock(at('2026-08-01T00:26:00Z')), {
          actor: 'test',
          occurredAt: at('2026-08-01T00:26:00Z'),
          idempotencyKey: 'resume-full',
          kinds: ['ENDPOINT'],
        }),
      ).resolves.toEqual({ resumed: true });
      expect(await stack.machine.currentState(op)).toBe('ACTIVE');
      expect(await stack.machine.currentHealthStatus(op)).toBe('HEALTHY');
    } finally {
      await closeProvStack(stack);
    }
  });
});
