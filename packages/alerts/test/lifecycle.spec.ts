/**
 * Alert update/expiry lifecycle suite (T022, FR-ALERT-004/005, AC-141;
 * PRD §26.2/§26.4/§26.5/§33.9).
 *
 * Runs on a real SQL engine (PGlite) with the engine's deterministic
 * `FakeNotificationChannel`. Proven here:
 * - material deterioration, cancellation, expiry, and risk events each yield
 *   exactly one idempotent update committed through the engine boundary;
 * - a replayed update and a crashed delivery re-send exactly once;
 * - an immaterial change and a non-actionable prior yield no update;
 * - two updates to one prior inside its cooldown collapse to one;
 * - the expiry sweep marks a budget-exceeded alert expired with no delivery;
 * - the T019 material/fingerprint ledger laws hold directly.
 */
import { describe, expect, it } from 'bun:test';
import {
  AlertSuppressionReason,
  ErrorCode,
  FingerprintOutcome,
  type AlertClass,
} from '@foresift/domain';
import { sha256Text } from '@foresift/persistence';
import {
  FakeNotificationChannel,
  NotificationChannelCrashError,
  claimOutboxBatch,
  deliverClaimed,
} from '@foresift/workflow-runtime';
import {
  AlertPriorEvent,
  buildUpdateNotification,
  commitAlertUpdate,
  deriveAlertFingerprint,
  evaluatePriorAlertUpdate,
  loadAlertPolicies,
  readAlertFingerprint,
  readPriorAlertState,
  recordPriorAlert,
  repeatSuppressionDecision,
  sweepAlertLifecycle,
  upsertAlertFingerprint,
  type AlertReassessment,
  type AlertUpdateCandidate,
  type AlertUpdateNotificationContext,
  type PriorAlertState,
} from '../src/index.ts';
import {
  HASH_B,
  HASH_C,
  expectForesiftError,
  seedPolicyRow,
  seedRun,
  withTestDatabase,
  type TestDatabase,
} from './helpers.ts';

const T0 = '2026-06-01T12:00:00.000Z';
const T_EXPIRING = '2026-06-01T12:58:00.000Z';
const T_EXPIRED = '2026-06-01T13:30:00.000Z';
const T_VALID = '2026-06-01T13:00:00.000Z';
const STALE = '2026-06-01T11:59:00.000Z';
const TEST_TIMEOUT_MS = 120_000;

let sequence = 0;

// --- fixtures ---------------------------------------------------------------

async function seedPrior(
  engine: TestDatabase['engine'],
  overrides: Partial<Parameters<typeof recordPriorAlert>[1]> = {},
): Promise<PriorAlertState> {
  sequence += 1;
  const tag = sequence;
  const runRef = overrides.runRef ?? (await seedRun(engine));
  const fingerprint = overrides.fingerprint ?? sha256Text(`alert-prior-${tag}`);
  return recordPriorAlert(engine, {
    alertId: `alert-prior-${tag}`,
    decisionRef: `decision-prior-${tag}`,
    runRef,
    alertClass: 'CONFIRMED_OPPORTUNITY',
    fingerprint,
    thesisVersion: 1,
    lifecycleState: 'CONFIRMED',
    riskState: 'LOW',
    severity: 0.9,
    actionabilityState: 'ACTIONABLE',
    validUntil: T_VALID,
    assetId: 'asset-1',
    profileId: 'profile-1',
    executionScenarioId: 'scenario-1',
    validUntilGeneration: 1,
    materialEvidenceFingerprint: HASH_B,
    ...overrides,
  });
}

function reassessment(overrides: Partial<AlertReassessment> = {}): AlertReassessment {
  return {
    severity: 0.5,
    thesisVersion: 2,
    materialEvidenceFingerprint: HASH_C,
    lifecycleState: 'DECAYING',
    riskState: 'LOW',
    cancellationState: 'NONE',
    validUntil: T_VALID,
    ...overrides,
  };
}

function notificationContext(
  deliveredAt: string,
  overrides: Partial<AlertUpdateNotificationContext> = {},
): AlertUpdateNotificationContext {
  return {
    chainId: 'solana',
    canonicalContract: 'contract-1',
    candidateStage: 'DECAYING',
    detectedAt: T0,
    deliveredAt,
    evidenceTimestamp: T0,
    frozenRunRef: 'run-frozen-1',
    frozenEvidenceRef: 'evidence-frozen-1',
    researchDisclaimer: 'Research only; not investment advice.',
    candidateHeadline: 'Prior alert state changed materially',
    whyEarly: 'the candidate state moved against the original thesis',
    counterThesis: 'the pattern may be a false positive',
    socialCapabilityState: 'SOCIAL_FULL',
    missingData: [],
    ...overrides,
  };
}

function candidateFor(
  prior: PriorAlertState,
  event: AlertPriorEvent,
  options: { readonly reassessment?: Partial<AlertReassessment>; readonly now?: string } = {},
): AlertUpdateCandidate {
  const evaluation = evaluatePriorAlertUpdate({
    prior,
    event,
    reassessment: reassessment(options.reassessment),
    now: options.now ?? T0,
  });
  if (evaluation.kind !== 'UPDATE') {
    throw new Error(`expected an update candidate, got NO_UPDATE ${evaluation.reason}`);
  }
  return evaluation;
}

async function commitCandidate(
  tdb: TestDatabase,
  candidate: AlertUpdateCandidate,
  options: {
    readonly now?: string;
    readonly decisionReadyAt?: string;
    readonly deliveredAt?: string;
    readonly budgetMs?: number;
    readonly notification?: Partial<AlertUpdateNotificationContext>;
  } = {},
): Promise<Awaited<ReturnType<typeof commitAlertUpdate>>> {
  const now = options.now ?? T0;
  const notification = buildUpdateNotification(
    candidate,
    notificationContext(options.deliveredAt ?? now, options.notification ?? {}),
  );
  return commitAlertUpdate(tdb.engine, {
    candidate,
    classification: notification.classification,
    content: notification.content,
    decisionReadyAt: options.decisionReadyAt ?? now,
    now,
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
  });
}

async function countRows(
  tdb: TestDatabase,
  sql: string,
  params: readonly unknown[] = [],
): Promise<number> {
  const result = await tdb.engine.query<{ count: number }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

async function firstAlertId(tdb: TestDatabase): Promise<string | null> {
  const result = await tdb.engine.query<{ alert_id: string }>(
    `SELECT alert_id FROM alert.alert_records ORDER BY alert_id LIMIT 1`,
  );
  return result.rows[0]?.alert_id ?? null;
}

// --- T019 laws --------------------------------------------------------------

describe('T019 material, fingerprint, and cooldown ledger laws', () => {
  it('derives a stable §26.4 content address and refuses below-threshold repeats', () => {
    const fingerprint = deriveAlertFingerprint({
      assetId: 'asset-1',
      profileId: 'profile-1',
      alertType: 'CONFIRMED_OPPORTUNITY',
      lifecycleState: 'CONFIRMED',
      riskState: 'LOW',
      thesisVersion: 1,
      executionScenarioId: 'scenario-1',
      validUntilGeneration: 1,
      materialEvidenceFingerprint: HASH_B,
    });
    expect(fingerprint.fingerprintHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const prior = {
      alertClass: 'CONFIRMED_OPPORTUNITY' as AlertClass,
      severity: 0.9,
      thesisVersion: 1,
      materialEvidenceFingerprint: HASH_B,
    };
    const immaterial = { ...prior, severity: 0.89 };
    const material = { ...prior, severity: 0.5 };

    expect(
      repeatSuppressionDecision({
        prior,
        next: immaterial,
        cooldownUntil: null,
        now: T0,
        duplicateFingerprint: false,
      }),
    ).toBe(FingerprintOutcome.SUPPRESS_IMMATERIAL);

    expect(
      repeatSuppressionDecision({
        prior,
        next: material,
        cooldownUntil: null,
        now: T0,
        duplicateFingerprint: false,
      }),
    ).toBe(FingerprintOutcome.ALLOW);

    expect(
      repeatSuppressionDecision({
        prior,
        next: material,
        cooldownUntil: T_VALID,
        now: T0,
        duplicateFingerprint: false,
      }),
    ).toBe(FingerprintOutcome.SUPPRESS_COOLDOWN);

    expect(
      repeatSuppressionDecision({
        prior: null,
        next: material,
        cooldownUntil: null,
        now: T0,
        duplicateFingerprint: true,
      }),
    ).toBe(FingerprintOutcome.SUPPRESS_DUPLICATE);
  });

  it(
    'reads and advances the fingerprint/cooldown ledger, refusing a stale write',
    async () => {
      await withTestDatabase(async (tdb) => {
        const fingerprint = sha256Text('ledger-round-trip');
        expect(await readAlertFingerprint(tdb.engine, fingerprint)).toBeNull();

        const written = await upsertAlertFingerprint(tdb.engine, {
          fingerprint,
          alertClass: 'CONFIRMED_OPPORTUNITY',
          lastAlertId: 'alert-ledger-1',
          lastSeverity: 0.9,
          lastThesisVersion: 1,
          lastMaterialEvidenceFingerprint: HASH_B,
          lastDeliveredAt: T0,
          cooldownUntil: T_VALID,
          updatedAt: T0,
        });
        expect(written.fingerprint).toBe(fingerprint);
        expect(Date.parse(written.cooldownUntil)).toBe(Date.parse(T_VALID));

        const read = await readAlertFingerprint(tdb.engine, fingerprint);
        expect(read?.lastSeverity).toBe(0.9);

        const advanced = await upsertAlertFingerprint(tdb.engine, {
          fingerprint,
          alertClass: 'CONFIRMED_OPPORTUNITY',
          lastAlertId: 'alert-ledger-2',
          lastSeverity: 0.5,
          lastThesisVersion: 2,
          lastMaterialEvidenceFingerprint: HASH_C,
          lastDeliveredAt: T0,
          cooldownUntil: T_VALID,
          updatedAt: '2026-06-01T12:05:00.000Z',
        });
        expect(advanced.lastThesisVersion).toBe(2);

        await expectForesiftError(
          upsertAlertFingerprint(tdb.engine, {
            fingerprint,
            alertClass: 'CONFIRMED_OPPORTUNITY',
            lastAlertId: 'alert-ledger-3',
            lastSeverity: 0.1,
            lastThesisVersion: 1,
            lastMaterialEvidenceFingerprint: HASH_B,
            lastDeliveredAt: T0,
            cooldownUntil: T_VALID,
            updatedAt: '2026-06-01T11:00:00.000Z',
          }),
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        );
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses an update for a non-actionable prior and an immaterial change',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const expired = evaluatePriorAlertUpdate({
          prior,
          event: AlertPriorEvent.DETERIORATION,
          reassessment: reassessment(),
          now: T_EXPIRED,
        });
        expect(expired.kind).toBe('NO_UPDATE');
        if (expired.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
        expect(expired.reason).toBe('NOT_ACTIONABLE_EXPIRED');

        // A same-class prior with a below-threshold change is immaterial.
        const weakeningPrior = await seedPrior(tdb.engine, {
          alertClass: 'THESIS_WEAKENING',
        });
        const immaterial = evaluatePriorAlertUpdate({
          prior: weakeningPrior,
          event: AlertPriorEvent.DETERIORATION,
          reassessment: reassessment({
            severity: 0.89,
            thesisVersion: 1,
            materialEvidenceFingerprint: HASH_B,
          }),
          now: T0,
        });
        expect(immaterial.kind).toBe('NO_UPDATE');
        if (immaterial.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
        expect(immaterial.reason).toBe('IMMATERIAL_CHANGE');
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe('T020 update/cancellation lifecycle (AC-141)', () => {
  it(
    'material deterioration yields exactly one update and collapses a replay',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const candidate = candidateFor(prior, AlertPriorEvent.DETERIORATION);

        const first = await commitCandidate(tdb, candidate);
        expect(first.kind).toBe('COMMITTED');
        if (first.kind !== 'COMMITTED') throw new Error('expected COMMITTED');
        expect(first.updateId).toMatch(/^aupd_[0-9a-f]{64}$/);
        expect(first.engine.engine.outboxId).toBe(first.outboxId);

        const replay = await commitCandidate(tdb, candidate);
        expect(replay.kind).toBe('DEDUPLICATED');

        expect(
          await countRows(
            tdb,
            `SELECT count(*)::int AS count FROM alert.alert_updates WHERE prior_alert_ref = $1`,
            [prior.alertRef],
          ),
        ).toBe(1);
        expect(
          await countRows(
            tdb,
            `SELECT count(*)::int AS count FROM wf.notification_outbox WHERE outbox_id = $1`,
            [first.outboxId],
          ),
        ).toBe(1);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cancellation, expiry, and risk events each yield one update',
    async () => {
      await withTestDatabase(async (tdb) => {
        const cancellationPrior = await seedPrior(tdb.engine);
        const cancellation = candidateFor(cancellationPrior, AlertPriorEvent.CANCELLATION, {
          reassessment: { cancellationState: 'CANCELLED', lifecycleState: 'DECAYING' },
        });
        const cancellationResult = await commitCandidate(tdb, cancellation);
        expect(cancellationResult.kind).toBe('COMMITTED');
        if (cancellationResult.kind !== 'COMMITTED') throw new Error('expected COMMITTED');
        expect(cancellation.updateKind).toBe('CANCELLATION');

        const expiryPrior = await seedPrior(tdb.engine);
        const expiry = candidateFor(expiryPrior, AlertPriorEvent.EXPIRY, {
          now: T_EXPIRING,
        });
        const expiryResult = await commitCandidate(tdb, expiry, { now: T_EXPIRING });
        expect(expiryResult.kind).toBe('COMMITTED');
        if (expiryResult.kind !== 'COMMITTED') throw new Error('expected COMMITTED');
        expect(expiry.updateKind).toBe('EXPIRY');

        const riskPrior = await seedPrior(tdb.engine);
        const risk = candidateFor(riskPrior, AlertPriorEvent.RISK, {
          reassessment: {
            riskState: 'HIGH',
            lifecycleState: 'CONFIRMED',
            severity: 0.9,
            thesisVersion: 1,
            materialEvidenceFingerprint: HASH_B,
          },
        });
        const riskResult = await commitCandidate(tdb, risk);
        expect(riskResult.kind).toBe('COMMITTED');
        if (riskResult.kind !== 'COMMITTED') throw new Error('expected COMMITTED');
        expect(risk.updateKind).toBe('RISK');

        expect(await countRows(tdb, `SELECT count(*)::int AS count FROM alert.alert_updates`)).toBe(
          3,
        );
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    're-sends a crashed delivery exactly once through the engine',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const candidate = candidateFor(prior, AlertPriorEvent.DETERIORATION);
        const committed = await commitCandidate(tdb, candidate);
        expect(committed.kind).toBe('COMMITTED');
        if (committed.kind !== 'COMMITTED') throw new Error('expected COMMITTED');
        const outboxId = committed.outboxId;

        const channel = new FakeNotificationChannel();
        const firstClaim = (
          await claimOutboxBatch(tdb.engine, {
            workerId: 'worker-crash',
            now: T0,
            leaseMs: 5_000,
            limit: 50,
          })
        ).filter((claim) => claim.outboxId === outboxId);
        expect(firstClaim).toHaveLength(1);

        channel.crashAfter(1);
        await expect(
          deliverClaimed(tdb.engine, channel, {
            workerId: 'worker-crash',
            now: T0,
            claims: firstClaim,
          }),
        ).rejects.toBeInstanceOf(NotificationChannelCrashError);
        expect(channel.deliveryCount).toBe(1);

        // The row stays CLAIMED until its lease expires; a recovery worker
        // re-claims it and the channel collapses the replay by idempotency key.
        const retryAt = '2026-06-01T12:00:10.000Z';
        const secondClaim = (
          await claimOutboxBatch(tdb.engine, {
            workerId: 'worker-recovery',
            now: retryAt,
            leaseMs: 5_000,
            limit: 50,
          })
        ).filter((claim) => claim.outboxId === outboxId);
        expect(secondClaim).toHaveLength(1);

        const recovered = await deliverClaimed(tdb.engine, channel, {
          workerId: 'worker-recovery',
          now: retryAt,
          claims: secondClaim,
        });
        expect(recovered.sent).toEqual([outboxId]);
        expect(channel.deliveryCount).toBe(1);
        expect(channel.deduplicatedCount).toBe(1);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'collapses two updates to one prior inside its cooldown',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const first = candidateFor(prior, AlertPriorEvent.DETERIORATION);
        const committed = await commitCandidate(tdb, first);
        expect(committed.kind).toBe('COMMITTED');

        const risk = candidateFor(prior, AlertPriorEvent.RISK, {
          reassessment: {
            riskState: 'HIGH',
            lifecycleState: 'CONFIRMED',
            severity: 0.9,
            thesisVersion: 1,
            materialEvidenceFingerprint: HASH_B,
          },
        });
        expect(risk.idempotencyKey).not.toBe(first.idempotencyKey);
        const suppressed = await commitCandidate(tdb, risk);
        expect(suppressed.kind).toBe('SUPPRESSED');
        if (suppressed.kind !== 'SUPPRESSED') throw new Error('expected SUPPRESSED');
        expect(suppressed.reason).toBe(AlertSuppressionReason.WITHIN_COOLDOWN);

        expect(
          await countRows(
            tdb,
            `SELECT count(*)::int AS count FROM alert.alert_updates WHERE prior_alert_ref = $1`,
            [prior.alertRef],
          ),
        ).toBe(1);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'suppresses a budget-exceeded update instead of delivering it late',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const candidate = candidateFor(prior, AlertPriorEvent.DETERIORATION);
        const result = await commitCandidate(tdb, candidate, {
          now: '2026-06-01T12:05:00.000Z',
          decisionReadyAt: T0,
          budgetMs: 1_000,
        });
        expect(result.kind).toBe('SUPPRESSED');
        if (result.kind !== 'SUPPRESSED') throw new Error('expected SUPPRESSED');
        expect(result.reason).toBe(AlertSuppressionReason.EXPIRED_ACTIONABILITY);
        expect(result.latencyOutcome).toBe('BUDGET_EXCEEDED_SUPPRESSED');

        expect(
          await countRows(
            tdb,
            `SELECT count(*)::int AS count FROM alert.alert_updates WHERE prior_alert_ref = $1`,
            [prior.alertRef],
          ),
        ).toBe(0);
        expect(
          await countRows(tdb, `SELECT count(*)::int AS count FROM wf.notification_outbox`),
        ).toBe(0);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rolls back the update row and ledger advance when the engine commit fails (F5)',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const candidate = candidateFor(prior, AlertPriorEvent.DETERIORATION);
        const notification = buildUpdateNotification(candidate, notificationContext(T0));

        // Inject a failure INSIDE the engine commit: the enclosing transaction
        // opens, the alert-owned update row is inserted, then the engine refuses
        // the unknown run. The whole unit must roll back.
        await expectForesiftError(
          commitAlertUpdate(tdb.engine, {
            candidate,
            classification: notification.classification,
            content: notification.content,
            decisionReadyAt: T0,
            now: T0,
            runId: 'run-missing-atomicity',
          }),
          ErrorCode.WF_RUN_NOT_FOUND,
        );

        expect(
          await countRows(
            tdb,
            `SELECT count(*)::int AS count FROM alert.alert_updates WHERE idempotency_key = $1`,
            [candidate.idempotencyKey],
          ),
        ).toBe(0);
        expect(
          await countRows(
            tdb,
            `SELECT count(*)::int AS count FROM alert.alert_fingerprints WHERE fingerprint = $1`,
            [candidate.ledgerFingerprint],
          ),
        ).toBe(0);
        // The engine commit wrote nothing either.
        expect(
          await countRows(tdb, `SELECT count(*)::int AS count FROM wf.notification_outbox`),
        ).toBe(0);
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe('T021 expiry/deterioration sweep (AC-141)', () => {
  it(
    'marks a budget-exceeded alert expired without any delivery',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const report = await sweepAlertLifecycle(tdb.engine, { now: T_EXPIRED, limit: 10 });
        expect(report.examined).toBe(1);
        expect(report.outcomes[0]?.outcome).toBe('EXPIRED_SUPPRESSED');
        expect(report.countsByClass.CONFIRMED_OPPORTUNITY).toBe(1);

        const reread = await readPriorAlertState(tdb.engine, prior.alertRef);
        expect(reread?.actionabilityState).toBe('EXPIRED');
        expect(
          await countRows(tdb, `SELECT count(*)::int AS count FROM wf.notification_outbox`),
        ).toBe(0);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'applies the reassessment source and records a committed update per class',
    async () => {
      await withTestDatabase(async (tdb) => {
        const confirmedPrior = await seedPrior(tdb.engine);
        const thesisPrior = await seedPrior(tdb.engine, { alertClass: 'THESIS_STRENGTHENING' });

        const report = await sweepAlertLifecycle(tdb.engine, {
          now: T0,
          limit: 10,
          source: (prior) =>
            prior.alertRef === confirmedPrior.alertRef || prior.alertRef === thesisPrior.alertRef
              ? {
                  event: AlertPriorEvent.DETERIORATION,
                  reassessment: reassessment(),
                  notification: notificationContext(T0),
                  decisionReadyAt: T0,
                }
              : null,
        });

        expect(report.examined).toBe(2);
        expect(report.countsByOutcome.UPDATE_COMMITTED).toBe(2);
        expect(report.countsByClass.CONFIRMED_OPPORTUNITY).toBe(1);
        expect(report.countsByClass.THESIS_STRENGTHENING).toBe(1);
        expect(await countRows(tdb, `SELECT count(*)::int AS count FROM alert.alert_updates`)).toBe(
          2,
        );
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'expires a candidate whose decision-ready budget already elapsed',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const report = await sweepAlertLifecycle(tdb.engine, {
          now: T0,
          limit: 10,
          budgetMs: 1_000,
          source: () => ({
            event: AlertPriorEvent.DETERIORATION,
            reassessment: reassessment(),
            notification: notificationContext(T0),
            decisionReadyAt: STALE,
          }),
        });
        expect(report.outcomes[0]?.outcome).toBe('EXPIRED_SUPPRESSED');
        const reread = await readPriorAlertState(tdb.engine, prior.alertRef);
        expect(reread?.actionabilityState).toBe('EXPIRED');
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves a prior skipped when the source reports no reassessment',
    async () => {
      await withTestDatabase(async (tdb) => {
        await seedPrior(tdb.engine);
        const report = await sweepAlertLifecycle(tdb.engine, {
          now: T0,
          limit: 10,
          source: () => null,
        });
        expect(report.outcomes[0]?.outcome).toBe('SKIPPED');
        const alertId = await firstAlertId(tdb);
        const reread = alertId === null ? null : await readPriorAlertState(tdb.engine, alertId);
        expect(reread?.actionabilityState).toBe('ACTIONABLE');
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'commits a cancellation through the sweep with its update kind recorded',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine);
        const report = await sweepAlertLifecycle(tdb.engine, {
          now: T0,
          limit: 1,
          source: () => ({
            event: AlertPriorEvent.CANCELLATION,
            reassessment: reassessment({ cancellationState: 'CANCELLED' }),
            notification: notificationContext(T0),
            decisionReadyAt: T0,
          }),
        });
        expect(report.outcomes[0]?.updateKind).toBe('CANCELLATION');
        expect(prior.alertClass).toBe('CONFIRMED_OPPORTUNITY');
      });
    },
    TEST_TIMEOUT_MS,
  );

  const deteriorationSource = () =>
    ({
      event: AlertPriorEvent.DETERIORATION,
      reassessment: reassessment(),
      notification: notificationContext(T0),
      decisionReadyAt: T0,
    }) as const;

  it(
    'applies the persisted per-class thresholds to the sweep (F6)',
    async () => {
      // Control: with no persisted row the in-code default threshold (0.05)
      // makes the deterioration material, so the update commits.
      await withTestDatabase(async (tdb) => {
        await seedPrior(tdb.engine, { alertClass: 'THESIS_WEAKENING' });
        const report = await sweepAlertLifecycle(tdb.engine, {
          now: T0,
          limit: 10,
          source: deteriorationSource,
        });
        expect(report.countsByOutcome.UPDATE_COMMITTED).toBe(1);
      });

      // Persisted non-default thresholds govern: the same change is immaterial.
      await withTestDatabase(async (tdb) => {
        await seedPrior(tdb.engine, { alertClass: 'THESIS_WEAKENING' });
        await seedPolicyRow(tdb.engine, {
          policyId: 'persisted-thresholds',
          alertClass: 'THESIS_WEAKENING',
          version: 1,
          ttlSeconds: 7200,
          cooldownSeconds: 60,
          config: { contentPolicyVersion: 1, template: 'THESIS_UPDATE' },
          thresholds: {
            severityDelta: 0.99,
            thesisVersionDelta: 99,
            materialEvidenceChangeIsMaterial: false,
          },
        });
        const report = await sweepAlertLifecycle(tdb.engine, {
          now: T0,
          limit: 10,
          source: deteriorationSource,
        });
        expect(report.countsByOutcome.NO_UPDATE).toBe(1);
        expect(report.outcomes[0]?.reason).toBe('IMMATERIAL_CHANGE');
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'derives the update valid_until from the class TTL (F7c)',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine, { alertClass: 'THESIS_WEAKENING' });
        const candidate = candidateFor(prior, AlertPriorEvent.DETERIORATION);
        const notification = buildUpdateNotification(candidate, notificationContext(T0));
        // THESIS_WEAKENING ttlSeconds is 1800: T0 + 30 minutes.
        expect(notification.content.envelope.validUntil).toBe('2026-06-01T12:30:00.000Z');
        expect(notification.content.envelope.validUntil).not.toBe(
          candidate.reassessment.validUntil,
        );
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'derives valid_until from a persisted TTL override (F6/F7c)',
    async () => {
      await withTestDatabase(async (tdb) => {
        const prior = await seedPrior(tdb.engine, { alertClass: 'THESIS_WEAKENING' });
        await seedPolicyRow(tdb.engine, {
          policyId: 'persisted-ttl',
          alertClass: 'THESIS_WEAKENING',
          version: 1,
          ttlSeconds: 7200,
          cooldownSeconds: 60,
          config: { contentPolicyVersion: 1, template: 'THESIS_UPDATE' },
          thresholds: {
            severityDelta: 0.05,
            thesisVersionDelta: 1,
            materialEvidenceChangeIsMaterial: true,
          },
        });
        const registry = await loadAlertPolicies(tdb.engine);
        const evaluation = evaluatePriorAlertUpdate({
          prior,
          event: AlertPriorEvent.DETERIORATION,
          reassessment: reassessment(),
          now: T0,
          registry,
        });
        if (evaluation.kind !== 'UPDATE') throw new Error('expected an update candidate');
        expect(evaluation.policy.ttlSeconds).toBe(7200);
        const notification = buildUpdateNotification(evaluation, notificationContext(T0));
        // Persisted 7200s TTL: T0 + 2 hours.
        expect(notification.content.envelope.validUntil).toBe('2026-06-01T14:00:00.000Z');
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses a sweep with no reassessment source instead of reporting SKIPPED (F7d)',
    async () => {
      await withTestDatabase(async (tdb) => {
        await seedPrior(tdb.engine);
        await expectForesiftError(
          sweepAlertLifecycle(tdb.engine, { now: T0, limit: 10 }),
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        );
      });
    },
    TEST_TIMEOUT_MS,
  );
});
