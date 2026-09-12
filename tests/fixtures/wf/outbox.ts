/**
 * Crash-recovery outbox fixtures (T030, FR-WF-006, AC-011, AC-061; PRD §26.5).
 *
 * These fixtures describe the interleavings the crash-safe delivery worker
 * must survive: a worker that dies BEFORE handing the notification to the
 * channel, one that dies AFTER the channel accepted it but BEFORE the outbox
 * row was marked SENT, a second worker holding a stale claim, and the two
 * suppression classifications (provider outage, shadow run) that must never be
 * delivered.
 *
 * The fixtures are inert builders over the real engine inputs. The channel
 * builder returns a deterministically configured `FakeNotificationChannel`
 * (idempotent by key) with the scripted fault armed — no network, no vendor.
 */
import type { ShadowInfluenceKind } from '@foresift/domain';
import {
  FakeNotificationChannel,
  OutboxCommitOutcome,
  type CommitDecisionWithOutboxInput,
  type OutboxClaim,
} from '@foresift/workflow-runtime';

import { WF_TEST_PAYLOAD_HASH_A } from './triggers.ts';

/** Deterministic commit instant shared by the fixtures. */
export const WF_OUTBOX_COMMIT_AT = '2026-06-01T12:00:00.000Z';
/** Claim-lease instant for the recovery worker (after the first lease expired). */
export const WF_OUTBOX_RECOVERY_AT = '2026-06-01T12:00:10.000Z';
/** Claim lease duration used by the fixtures. */
export const WF_OUTBOX_CLAIM_LEASE_MS = 5_000;

export const WF_OUTBOX_CRASH_MODE = {
  NONE: 'NONE',
  BEFORE_SEND: 'BEFORE_SEND',
  AFTER_SEND: 'AFTER_SEND',
} as const;
export type WfOutboxCrashMode = (typeof WF_OUTBOX_CRASH_MODE)[keyof typeof WF_OUTBOX_CRASH_MODE];

export interface WfOutboxScenario {
  readonly name: string;
  readonly crashMode: WfOutboxCrashMode;
  readonly outcome: OutboxCommitOutcome;
  readonly influence: ShadowInfluenceKind;
  /** True when the committed row is deliverable (PENDING). */
  readonly deliverable: boolean;
  /** Unique deliveries the channel must record once recovery completes. */
  readonly expectedUniqueDeliveries: number;
  readonly note: string;
}

/**
 * The five crash-recovery scenarios. `expectedUniqueDeliveries` is the
 * exactly-once ledger the AC-011 suites assert against.
 */
export const WF_OUTBOX_SCENARIOS: Readonly<Record<string, WfOutboxScenario>> = Object.freeze({
  CRASH_BEFORE_SEND: {
    name: 'CRASH_BEFORE_SEND',
    crashMode: WF_OUTBOX_CRASH_MODE.BEFORE_SEND,
    outcome: OutboxCommitOutcome.NORMAL,
    influence: 'OPPORTUNITY_NOTIFICATION',
    deliverable: true,
    expectedUniqueDeliveries: 1,
    note: 'worker dies before any channel call; recovery sends exactly once',
  },
  CRASH_AFTER_SEND: {
    name: 'CRASH_AFTER_SEND',
    crashMode: WF_OUTBOX_CRASH_MODE.AFTER_SEND,
    outcome: OutboxCommitOutcome.NORMAL,
    influence: 'OPPORTUNITY_NOTIFICATION',
    deliverable: true,
    expectedUniqueDeliveries: 1,
    note: 'channel accepted the send; recovery replays and the key collapses',
  },
  STALE_CLAIM: {
    name: 'STALE_CLAIM',
    crashMode: WF_OUTBOX_CRASH_MODE.NONE,
    outcome: OutboxCommitOutcome.NORMAL,
    influence: 'OPPORTUNITY_NOTIFICATION',
    deliverable: true,
    expectedUniqueDeliveries: 1,
    note: 'the superseded holder must be refused; the fresh holder delivers once',
  },
  PROVIDER_OUTAGE: {
    name: 'PROVIDER_OUTAGE',
    crashMode: WF_OUTBOX_CRASH_MODE.NONE,
    outcome: OutboxCommitOutcome.PROVIDER_OUTAGE,
    influence: 'OPPORTUNITY_NOTIFICATION',
    deliverable: false,
    expectedUniqueDeliveries: 0,
    note: 'SUPPRESSED_OUTAGE: decision and alert preserved, never delivered',
  },
  SHADOW: {
    name: 'SHADOW',
    crashMode: WF_OUTBOX_CRASH_MODE.NONE,
    outcome: OutboxCommitOutcome.NORMAL,
    influence: 'OPPORTUNITY_NOTIFICATION',
    deliverable: false,
    expectedUniqueDeliveries: 0,
    note: 'SUPPRESSED_SHADOW: evaluation-only, never deliverable',
  },
});

/**
 * Build the atomic decision + alert + outbox commit for `runId`. The decision
 * and alert payloads are deterministic over `suffix`, so the stored payload
 * hash is reproducible by the suite.
 */
export function buildDecisionCommitInput(
  runId: string,
  suffix: string,
  options: {
    readonly outboxId?: string;
    readonly channel?: string;
    readonly scenario?: WfOutboxScenario;
    readonly now?: string;
  } = {},
): CommitDecisionWithOutboxInput {
  const scenario = options.scenario;
  const input: CommitDecisionWithOutboxInput = {
    runId,
    decision: {
      decisionId: `decision-${suffix}`,
      decisionKind: 'CANDIDATE_DECISION',
      payload: { decisionId: `decision-${suffix}`, verdict: 'NO_ACTION', confidence: 0.4 },
    },
    alert: {
      alertId: `alert-${suffix}`,
      alertClass: 'EARLY_WATCH',
      payload: { alertId: `alert-${suffix}`, headline: 'watch', ttlSeconds: 3600 },
    },
    outbox: {
      channel: options.channel ?? 'admin-inbox',
      ...(options.outboxId === undefined ? {} : { outboxId: options.outboxId }),
    },
    now: options.now ?? WF_OUTBOX_COMMIT_AT,
  };
  if (scenario === undefined) return input;
  return {
    ...input,
    ...(scenario.outcome === OutboxCommitOutcome.NORMAL ? {} : { outcome: scenario.outcome }),
    influence: scenario.influence,
  };
}

/**
 * Build the channel for a scenario. `AFTER_SEND` arms the one-time crash that
 * records the delivery and THEN throws (worker death before the SENT mark);
 * `BEFORE_SEND` returns a plain channel (the crash is modelled by simply never
 * calling `send`).
 */
export function buildScenarioChannel(
  scenario: WfOutboxScenario,
  options: { readonly now?: () => string; readonly prefix?: string } = {},
): FakeNotificationChannel {
  const channel = new FakeNotificationChannel({
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.prefix === undefined ? {} : { messageIdPrefix: options.prefix }),
  });
  if (scenario.crashMode === WF_OUTBOX_CRASH_MODE.AFTER_SEND) channel.crashAfter(1);
  return channel;
}

/** Build a bare claim for a row (with an arbitrary fencing token). */
export function buildManualClaim(
  outboxId: string,
  options: {
    readonly fencingToken?: number;
    readonly channel?: string;
    readonly payloadHash?: string;
    readonly claimedAt?: string;
    readonly claimExpiresAt?: string;
    readonly decisionRef?: string;
  } = {},
): OutboxClaim {
  return {
    outboxId,
    decisionRef: options.decisionRef ?? `decision-${outboxId}`,
    alertRef: null,
    channel: options.channel ?? 'admin-inbox',
    payloadHash: options.payloadHash ?? WF_TEST_PAYLOAD_HASH_A,
    fencingToken: options.fencingToken ?? 1,
    claimedAt: options.claimedAt ?? WF_OUTBOX_COMMIT_AT,
    claimExpiresAt: options.claimExpiresAt ?? '2026-06-01T12:00:30.000Z',
    attempts: 0,
    enqueuedAt: options.claimedAt ?? WF_OUTBOX_COMMIT_AT,
  };
}

// Re-export the outcome vocabulary so suites import it from the fixture barrel.
export { OutboxCommitOutcome };
