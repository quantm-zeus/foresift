// AC-270 (acceptance): verification refresh pairs gate ACTIVE decision use.
// Full OFFICIAL_DOC+LIVE_CONTRACT pairs inside TTL keep an operation usable
// and activation-ready; a lapsed critical kind exits via the sweep to its
// §15.4-mapped health status; resumption demands a COMPLETE fresh pair and
// restores ACTIVE with VERIFICATION_REFRESHED. The scenario timeline is
// driven by tests/fixtures/prov/scenarios/ttl-expiry.json.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import {
  atOffset,
  closeProvAcceptanceStack,
  configureAllCriticalTtls,
  makeProvAcceptanceStack,
  readProvFixture,
  recordFullPairs,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';
import { ProvErrorCode } from '../../packages/provider-lifecycle/src/index.ts';

interface TtlScenario {
  readonly provider: string;
  readonly operation: string;
  readonly version: string;
  readonly timeline: Array<
    | { event: 'CONFIGURE_TTLS'; kindsSeconds: Record<string, number> }
    | { event: 'RECORD_PAIRS'; pairs: string[] }
    | { event: 'EXPECT_FRESH'; detail: string }
    | {
        event: 'SWEEP_EXPECTS_EXIT';
        lapsedKind: string;
        expectedReasonClass: string;
        expectedHealthStatus: string;
      }
  >;
}

describe('AC-270: verification refresh pairs, sweep exit, and paired resume', () => {
  it('full pairs inside TTL keep active-decision use and readiness open', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'ac',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'ac270-v',
      });
      await stack.machine.transition({
        ref: op,
        to: 'ACTIVE',
        reasonClass: 'OPERATION_ACTIVATED',
        actor: 'ac',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'ac270-a',
      });
      await configureAllCriticalTtls(stack, 3_600);
      await recordFullPairs(stack, op, T0);
      // Rights must also be current for readiness; declare v1 well into the future.
      await stack.rights.declare(acRights(op, 'ac-terms-v1', T0));
      const clock30 = { now: (): UtcTimestamp => atOffset(30) };
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, clock30),
      ).resolves.toBeUndefined();
      const evaluation = await stack.readiness.evaluate(op, clock30);
      expect(evaluation.status).toBe('ELIGIBLE');
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('follows the fixture timeline: PRICING_PLAN lapse sweeps to PLAN_UNVERIFIED, records untouched', async () => {
    const scenario = readProvFixture('scenarios/ttl-expiry.json') as unknown as TtlScenario;
    expect(scenario.timeline.map((step) => step.event)).toEqual([
      'CONFIGURE_TTLS',
      'RECORD_PAIRS',
      'EXPECT_FRESH',
      'SWEEP_EXPECTS_EXIT',
    ]);
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack, {
        ref: {
          providerId: scenario.provider,
          operationId: scenario.operation,
          version: scenario.version,
        },
      });
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'ac',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'tl-v',
      });
      await stack.machine.transition({
        ref: op,
        to: 'ACTIVE',
        reasonClass: 'OPERATION_ACTIVATED',
        actor: 'ac',
        occurredAt: T0,
        effectiveAt: T0,
        idempotencyKey: 'tl-a',
      });

      const configure = scenario.timeline[0] as Extract<
        TtlScenario['timeline'][number],
        { event: 'CONFIGURE_TTLS' }
      >;
      // Baseline for every critical kind (so full pairs can be recorded);
      // the fixture's own values then override the kinds it names.
      await configureAllCriticalTtls(stack, 86_400);
      for (const [kind, seconds] of Object.entries(configure.kindsSeconds)) {
        await stack.verifications.configureTtl({
          configId: `scenario-${kind}`,
          providerId: '*',
          kind: kind as never,
          ttlSeconds: seconds,
        });
      }
      const recordStep = scenario.timeline[1];
      if (recordStep?.event !== 'RECORD_PAIRS') throw new Error('fixture drift');
      await recordFullPairs(stack, op, T0);

      // EXPECT_FRESH at +30 min: everything still inside its TTL window.
      const clockFresh = { now: (): UtcTimestamp => atOffset(30) };
      await expect(
        stack.verifications.assertUsableForActiveDecisions(op, clockFresh),
      ).resolves.toBeUndefined();

      const beforeRecords = await stack.engine.query(
        `SELECT * FROM prov.prov_verification_records ORDER BY record_id`,
      );
      const beforeHistory = await stack.machine.history(op);

      const sweepStep = scenario.timeline[3];
      if (sweepStep?.event !== 'SWEEP_EXPECTS_EXIT') throw new Error('fixture drift');
      const swept = await stack.verifications.sweepExpired(
        { now: (): UtcTimestamp => atOffset(120) },
        { actor: 'ttl-sweep', occurredAt: atOffset(120), sweepRunId: 'ac270-run-1' },
      );
      expect(swept).toHaveLength(1);
      expect(swept[0]).toMatchObject({
        ref: {
          providerId: scenario.provider,
          operationId: scenario.operation,
          version: scenario.version,
        },
        kind: sweepStep.lapsedKind,
        healthOutcome: sweepStep.expectedHealthStatus,
      });
      expect(await stack.machine.currentState(op)).toBe('DEGRADED');
      expect(await stack.machine.currentHealthStatus(op)).toBe(sweepStep.expectedHealthStatus);
      const events = await stack.engine.query<{ reason_class: string }>(
        `SELECT reason_class FROM prov.prov_lifecycle_events WHERE seq > ${String(beforeHistory.length)}`,
      );
      expect(events.rows.some((row) => row.reason_class === sweepStep.expectedReasonClass)).toBe(true);

      // Historical verification evidence is byte-identical after the sweep.
      const afterRecords = await stack.engine.query(
        `SELECT * FROM prov.prov_verification_records ORDER BY record_id`,
      );
      expect(afterRecords.rows).toEqual(beforeRecords.rows);
      const afterHistory = await stack.machine.history(op);
      expect(afterHistory.slice(0, beforeHistory.length)).toEqual(beforeHistory);
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('resume requires the FULL pair; completing it returns the operation to ACTIVE/HEALTHY', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await toActive(stack, op);
      // All critical kinds get a one-hour TTL; an EXACT provider row shortens
      // only PRICING_PLAN so exactly one kind lapses for the resume story.
      await configureAllCriticalTtls(stack, 3_600);
      await stack.verifications.configureTtl({
        configId: 'ac270-short-plan',
        providerId: op.providerId,
        kind: 'PRICING_PLAN',
        ttlSeconds: 600,
      });
      await recordFullPairs(stack, op, T0);
      const swept = await stack.verifications.sweepExpired(
        { now: (): UtcTimestamp => atOffset(11) },
        { actor: 'ttl-sweep', occurredAt: atOffset(11), sweepRunId: 'ac270-resume-run' },
      );
      expect(swept).toHaveLength(1);

      // Half a pair is not a refresh: active use stays suspended. All refresh
      // activity happens INSIDE every TTL window (minutes 11–16 of an hour).
      await stack.verifications.recordVerification({
        ref: op,
        kind: 'PRICING_PLAN',
        source: 'OFFICIAL_DOC',
        outcome: 'PASS',
        verifiedAt: atOffset(12),
        evidenceRefs: ['doc:refresh-half'],
        recordedBy: 'acceptance',
        idempotencyKey: 'ac270-refresh-doc-only',
      });
      await expect(
        stack.verifications.resumeAfterRefresh(op, { now: (): UtcTimestamp => atOffset(13) }, {
          actor: 'operator',
          occurredAt: atOffset(13),
          idempotencyKey: 'ac270-resume-half',
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_REFRESH_PAIR_INCOMPLETE });

      await stack.verifications.recordVerification({
        ref: op,
        kind: 'PRICING_PLAN',
        source: 'LIVE_CONTRACT',
        outcome: 'PASS',
        verifiedAt: atOffset(14),
        evidenceRefs: ['live:refresh-complete'],
        recordedBy: 'acceptance',
        idempotencyKey: 'ac270-refresh-live',
      });
      await expect(
        stack.verifications.resumeAfterRefresh(op, { now: (): UtcTimestamp => atOffset(15) }, {
          actor: 'operator',
          occurredAt: atOffset(15),
          idempotencyKey: 'ac270-resume-full',
        }),
      ).resolves.toEqual({ resumed: true });
      expect(await stack.machine.currentState(op)).toBe('ACTIVE');
      expect(await stack.machine.currentHealthStatus(op)).toBe('HEALTHY');
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});

async function toActive(
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
    idempotencyKey: 'r-v',
  });
  await stack.machine.transition({
    ref: op,
    to: 'ACTIVE',
    reasonClass: 'OPERATION_ACTIVATED',
    actor: 'ac',
    occurredAt: T0,
    effectiveAt: T0,
    idempotencyKey: 'r-a',
  });
}

function acRights(
  op: { readonly providerId: string; readonly operationId: string; readonly version: string },
  rightsVersion: string,
  verifiedAt: UtcTimestamp,
) {
  return {
    ref: op,
    rightsVersion,
    commercialUseAllowed: true,
    personalResearchAllowed: true,
    cacheAllowed: true,
    maximumCacheDuration: 'PT5M',
    rawRetentionAllowed: true,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: false,
    redistributionAllowed: false,
    publicAlertDerivativeAllowed: true,
    attributionRequired: true,
    userByokRequired: false,
    rawExportAllowed: false,
    jurisdictionRestrictions: [],
    termsVersion: rightsVersion,
    verifiedAt,
    verificationExpiresAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  };
}
