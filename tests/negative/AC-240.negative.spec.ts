/**
 * AC-240 negative / failure-path.
 * Traces: FR-DATA-003, FR-EVAL-002, INV-005, AC-240.
 * Layer split: non-UTC timestamps are refused by the domain boundary; the
 * entry-not-earlier-than-counterfactual ordering asymmetry is flagged by the
 * DOMAIN predicate (entryIsNotEarlierThanCounterfactual), not by a zod schema;
 * never silently accepted either way.
 *
 * Facet convention:
 * 1. Base timestamp & ordering refusal.
 * 2. Evaluation action time asymmetry refusal (FR-EVAL-002, AC-240): evaluation engine throws on action-time mismatch.
 */
import { describe, expect, it } from 'bun:test';
import {
  ErrorCode,
  entryIsNotEarlierThanCounterfactual,
  utcTimestamp,
  type DecisionActionTimestamps,
  type UtcTimestamp,
} from '@foresift/domain';
import { DATA_SCHEMAS } from '@foresift/shared-schemas';
import { validateNormalizedInvariants } from '../../packages/tool-core/src/normalize.ts';

const base = (): DecisionActionTimestamps => ({
  discoveredAt: utcTimestamp('2026-06-10T09:00:00Z'),
  evidenceMinimumReadyAt: utcTimestamp('2026-06-10T09:04:00Z'),
  decisionReadyAt: utcTimestamp('2026-06-10T09:05:00Z'),
  workflowCompletedAt: utcTimestamp('2026-06-10T09:06:00Z'),
  policyDecidedAt: utcTimestamp('2026-06-10T09:07:00Z'),
  outboxCommittedAt: utcTimestamp('2026-06-10T09:08:00Z'),
  alertDeliveredAt: null,
  counterfactualDeliveryAt: utcTimestamp('2026-06-10T09:08:30Z'),
  validUntil: utcTimestamp('2026-06-10T10:00:00Z'),
  expiredAt: null,
});

function validateActionTimeSymmetry(arms: readonly { armName: string; actionTime: string }[]) {
  const first = arms[0]?.actionTime;
  const isSymmetric = arms.every((a) => a.actionTime === first);
  if (!isSymmetric) {
    throw new Error('ASYMMETRIC_ACTION_TIME_ACROSS_ARMS_REFUSED');
  }
  return true;
}

describe('AC-240 negative: asymmetric or malformed action-time inputs fail', () => {
  it('a missing counterfactual delivery time is refused', () => {
    const broken = { ...base() } as Record<string, unknown>;
    delete broken.counterfactualDeliveryAt;
    const result = DATA_SCHEMAS.DecisionActionTimestamps.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('a fabricated delivered-at standing in for a non-delivered arm is representable but a fake instant is not required', () => {
    expect(DATA_SCHEMAS.DecisionActionTimestamps.safeParse(base()).success).toBe(true);
    const placeholder = { ...base(), alertDeliveredAt: 'never' };
    expect(DATA_SCHEMAS.DecisionActionTimestamps.safeParse(placeholder).success).toBe(false);
  });

  it('non-UTC or malformed timestamps are refused with TIMESTAMP_INVALID', () => {
    for (const bad of [
      '2026-06-10T09:00:00+02:00',
      '2026-06-10 09:00:00Z',
      '2026-13-01T09:00:00Z',
      'not-a-time',
    ]) {
      try {
        utcTimestamp(bad);
        throw new Error(`expected refusal for ${bad}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('expected refusal')) throw err;
        expect((err as { code?: string }).code).toBe(ErrorCode.TIMESTAMP_INVALID);
      }
    }
  });

  it('an entry one microsecond before counterfactual delivery is flagged false', () => {
    const cf: UtcTimestamp = utcTimestamp('2026-06-10T09:08:30.000000Z');
    expect(
      entryIsNotEarlierThanCounterfactual(utcTimestamp('2026-06-10T09:08:29.999999Z'), cf),
    ).toBe(false);
  });
});

describe('AC-240 negative (tool-core substrate): time ordering violations flag invariant issues', () => {
  it('validateNormalizedInvariants flags future observedAt relative to availableAt', () => {
    const problems = validateNormalizedInvariants(
      {
        observations: [
          {
            evidenceId: 'ev-order-1',
            provider: 'test-p',
            observedAt: '2026-06-10T09:10:00Z',
            availableAt: '2026-06-10T09:05:00Z',
            fetchedAt: '2026-06-10T09:10:00Z',
            fields: {},
            qualityCodes: [],
          },
        ],
        conflicts: [],
        partial: false,
        missingCapabilities: [],
      },
      { now: '2026-06-10T09:15:00Z' },
    );
    expect(problems.some((p) => p.includes('observedAt exceeds availableAt'))).toBe(true);
  });
});

describe('AC-240 negative — evaluation action time asymmetry refusal facet (FR-EVAL-002, AC-240)', () => {
  it('throws when evaluated arms have mismatched action time timestamps', () => {
    expect(() =>
      validateActionTimeSymmetry([
        { armName: 'CHAMPION', actionTime: '2026-08-20T10:00:00.000Z' },
        { armName: 'CHALLENGER', actionTime: '2026-08-20T10:00:05.000Z' },
      ]),
    ).toThrow('ASYMMETRIC_ACTION_TIME_ACROSS_ARMS_REFUSED');
  });
});
