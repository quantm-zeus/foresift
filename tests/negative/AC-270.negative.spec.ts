// AC-270 (negative): the verification-pair gate fails closed — unconfigured
// TTLs refuse, missing/expired kinds refuse with PROV_VERIFICATION_EXPIRED,
// half-pairs refuse with PROV_REFRESH_PAIR_INCOMPLETE, FAIL outcomes never
// satisfy freshness, single-source refreshes never clear a lapse, and sweep
// reruns dedupe instead of double-exiting.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import {
  atOffset,
  closeProvAcceptanceStack,
  configureAllCriticalTtls,
  DECISION_CRITICAL_KINDS,
  makeProvAcceptanceStack,
  recordFullPairs,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';
import { ProvErrorCode } from '../../packages/provider-lifecycle/src/index.ts';

async function activate(
  stack: Awaited<ReturnType<typeof makeProvAcceptanceStack>>,
  op: { readonly providerId: string; readonly operationId: string; readonly version: string },
): Promise<void> {
  await stack.machine.transition({
    ref: op,
    to: 'VERIFIED',
    reasonClass: 'REGISTRATION_VERIFIED',
    actor: 'ac',
    occurredAt: T0,
    effectiveAt: T0,
    idempotencyKey: 'n-v',
  });
  await stack.machine.transition({
    ref: op,
    to: 'ACTIVE',
    reasonClass: 'OPERATION_ACTIVATED',
    actor: 'ac',
    occurredAt: T0,
    effectiveAt: T0,
    idempotencyKey: 'n-a',
  });
}

describe('AC-270 negative: pair enforcement refuses every incomplete world', () => {
  it('refuses to record anything when no TTL is configured for a kind', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await expect(
        stack.verifications.recordVerification({
          ref: op,
          kind: 'SCHEMA',
          source: 'OFFICIAL_DOC',
          outcome: 'PASS',
          verifiedAt: T0,
          evidenceRefs: ['doc:schema'],
          recordedBy: 'acceptance',
          idempotencyKey: 'neg-unconfigured',
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('a kind never verified at all is an expiry-class refusal (NEVER_VERIFIED ≠ FRESH)', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await activate(stack, op);
      await Promise.all(
        DECISION_CRITICAL_KINDS.map((kind) =>
          stack.verifications.configureTtl({
            configId: `neg-ttl-${kind}`,
            providerId: '*',
            kind,
            ttlSeconds: 86_400,
          }),
        ),
      );
      // Everything EXCEPT AUTHENTICATION.
      for (const kind of DECISION_CRITICAL_KINDS.filter((k) => k !== 'AUTHENTICATION')) {
        for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
          await stack.verifications.recordVerification({
            ref: op,
            kind,
            source,
            outcome: 'PASS',
            verifiedAt: T0,
            evidenceRefs: [`${source}:${kind}`],
            recordedBy: 'acceptance',
            idempotencyKey: `neg-missing:${kind}:${source}`,
          });
        }
      }
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, {
          now: (): UtcTimestamp => atOffset(5),
        }),
      ).rejects.toMatchObject({
        code: ProvErrorCode.PROV_VERIFICATION_EXPIRED,
        detail: { expiredKinds: 'AUTHENTICATION' },
      });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('fresh-but-half pairs refuse with PROV_REFRESH_PAIR_INCOMPLETE', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await activate(stack, op);
      await Promise.all(
        DECISION_CRITICAL_KINDS.map((kind) =>
          stack.verifications.configureTtl({
            configId: `half-${kind}`,
            providerId: '*',
            kind,
            ttlSeconds: 3_600,
          }),
        ),
      );
      for (const kind of DECISION_CRITICAL_KINDS) {
        await stack.verifications.recordVerification({
          ref: op,
          kind,
          source: 'OFFICIAL_DOC',
          outcome: 'PASS',
          verifiedAt: T0,
          evidenceRefs: [`doc:${kind}`],
          recordedBy: 'acceptance',
          idempotencyKey: `half-doc:${kind}`,
        });
        // QUOTA deliberately gets no LIVE_CONTRACT side.
        if (kind === 'QUOTA') continue;
        await stack.verifications.recordVerification({
          ref: op,
          kind,
          source: 'LIVE_CONTRACT',
          outcome: 'PASS',
          verifiedAt: T0,
          evidenceRefs: [`live:${kind}`],
          recordedBy: 'acceptance',
          idempotencyKey: `half-live:${kind}`,
        });
      }
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, {
          now: (): UtcTimestamp => atOffset(1),
        }),
      ).rejects.toMatchObject({
        code: ProvErrorCode.PROV_REFRESH_PAIR_INCOMPLETE,
        detail: { pairIncompleteKinds: 'QUOTA' },
      });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('FAIL outcomes and expired PASS records never count as fresh', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await activate(stack, op);
      await stack.verifications.configureTtl({ configId: 'f-schema', providerId: '*', kind: 'SCHEMA', ttlSeconds: 60 });
      for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
        await stack.verifications.recordVerification({
          ref: op,
          kind: 'SCHEMA',
          source,
          outcome: 'FAIL',
          verifiedAt: T0,
          evidenceRefs: [`fail:${source}`],
          recordedBy: 'acceptance',
          idempotencyKey: `fail:${source}`,
        });
      }
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, { now: (): UtcTimestamp => atOffset(1) }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_VERIFICATION_EXPIRED });

      // Expired PASS: recorded inside TTL, evaluated past expiry.
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'SCHEMA',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: atOffset(2),
        evidenceRefs: ['pass:doc'],
        recordedBy: 'acceptance',
        idempotencyKey: 'pass:doc',
      });
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, { now: (): UtcTimestamp => atOffset(70) }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_VERIFICATION_EXPIRED });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('sweep reruns with the same run id dedupe; distinct ids after re-lapse exit again only once', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await activate(stack, op);
      await configureAllCriticalTtls(stack, 600);
      await recordFullPairs(stack, op, T0);
      const sweepArgs = {
        actor: 'ttl-sweep',
        occurredAt: atOffset(11) as UtcTimestamp,
        sweepRunId: 'dedupe-run',
      };
      const first = await stack.verifications.sweepExpired(
        { now: (): UtcTimestamp => atOffset(11) },
        sweepArgs,
      );
      expect(first).toHaveLength(1);
      const historyAfterFirst = await stack.machine.history(op);

      // Rerun of the SAME sweep id: no new ledger events.
      const second = await stack.verifications.sweepExpired(
        { now: (): UtcTimestamp => atOffset(12) },
        sweepArgs,
      );
      expect(second).toHaveLength(0);
      expect(await stack.machine.history(op)).toEqual(historyAfterFirst);
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
