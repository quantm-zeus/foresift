/**
 * AC-142 acceptance (positive + failure path).
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-SOC-001, FR-SOC-002, FR-SOC-003,
 * FR-SOC-004, AC-142.
 * AC text (manifest §39.13): "Missing X/paid social capability produces
 * `SOCIAL_UNAVAILABLE`, not a negative social feature."
 *
 * The alert-scoped slice of AC-142 (the G5 social package owns its own suite
 * when it lands) is proven against `tests/fixtures/alerts/**`:
 * - `SOCIAL_UNAVAILABLE` is unknown coverage: zero score contribution, never
 *   negative evidence, and never an organic-confirmation claim;
 * - a watch/opportunity renders it as EXPLICIT MISSING DATA
 *   (`social_capability:SOCIAL_UNAVAILABLE`) with no synthetic negative social
 *   risk entry;
 * - unavailable coverage alone does not block a fully gated confirmation
 *   (never a block without an explicit, named approved fallback);
 * - failure path: claiming organic confirmation while coverage is unavailable
 *   is SUPPRESSED (`SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION`) and cannot be
 *   rendered.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_SOCIAL_CAPABILITY_STATES,
  AlertSuppressionReason,
  SocialCapabilityState,
  socialIsUnknownCoverage,
} from '@foresift/domain';
import {
  AlertClassificationKind,
  AlertContentRefusedError,
  classifyAlert,
  evaluateConfirmedOpportunityGates,
  renderAlertContent,
  socialCoverageVerdict,
} from '@foresift/alerts';
import * as fx from '../fixtures/alerts/index.ts';

/** Assert the renderer refuses with the closed reason. */
function expectContentRefusal(fn: () => unknown, reason: AlertSuppressionReason): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof AlertContentRefusedError)) {
      throw new Error(`expected AlertContentRefusedError, got ${(error as Error).name}`);
    }
    if (error.reason !== reason) {
      throw new Error(`expected content refusal ${reason}, got ${error.reason}`);
    }
    return;
  }
  throw new Error(`expected a content refusal with ${reason}`);
}

describe('AC-142: unavailable social capability is explicit missing data, never a negative feature', () => {
  it('treats every capability state as non-negative and SOCIAL_UNAVAILABLE as unknown coverage', () => {
    for (const state of ALL_SOCIAL_CAPABILITY_STATES) {
      const verdict = socialCoverageVerdict(state);
      // §67.4: absent/partial coverage is never negative and never scores.
      expect(verdict.negativeEvidence).toBe(false);
      expect(verdict.organicConfirmationAvailable).toBe(false);
      expect(verdict.scoreContribution).toBe(0);
      expect(verdict.unknownCoverage).toBe(state === SocialCapabilityState.SOCIAL_UNAVAILABLE);
      expect(socialIsUnknownCoverage(state)).toBe(
        state === SocialCapabilityState.SOCIAL_UNAVAILABLE,
      );
    }
  });

  it('renders SOCIAL_UNAVAILABLE as explicit missing data with no synthetic negative social entry', () => {
    const outcome = classifyAlert(fx.socialUnavailableRequest());
    expect(outcome.kind).toBe(AlertClassificationKind.CLASSIFIED);
    // The class is not lowered by the absent capability.
    expect(outcome.alertClass).toBe('EARLY_WATCH');
    expect(outcome.socialUnknownCoverage).toBe(true);
    expect(outcome.organicConfirmationClaimed).toBe(false);

    const input = fx.earlyWatchRenderInput(outcome, {
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    });
    const content = renderAlertContent(input);
    expect(content.envelope.socialCapabilityState).toBe('SOCIAL_UNAVAILABLE');
    expect(content.missingData).toContain(fx.SOCIAL_UNAVAILABLE_MISSING_DATA_ENTRY);
    // No negative social feature is invented: the risk-evidence list is exactly
    // what the caller supplied, byte-for-byte.
    expect(content.envelope.riskEvidence).toEqual([...input.narrative.riskEvidence]);
    expect(content.envelope.riskEvidence).not.toContain(fx.SOCIAL_UNAVAILABLE_MISSING_DATA_ENTRY);
    expect(content.headlineSuppressed).toBe(false);
    expect(content.headline).not.toBeNull();

    // The unavailable state never masquerades as a full coverage state.
    expect(content.envelope.socialCapabilityState).not.toBe(SocialCapabilityState.SOCIAL_FULL);
  });

  it('does not block a fully gated confirmation on unavailable coverage alone', () => {
    const outcome = classifyAlert(fx.socialUnavailableConfirmedRequest());
    expect(outcome.kind).toBe(AlertClassificationKind.CLASSIFIED);
    expect(outcome.alertClass).toBe('CONFIRMED_OPPORTUNITY');
    expect(outcome.gateSetComplete).toBe(true);
    expect(outcome.socialUnknownCoverage).toBe(true);
    // The §26.3 gate set carries no social input: absence of social capability
    // is not one of the fourteen gates and cannot refuse the alert.
    const gates = evaluateConfirmedOpportunityGates(fx.PASSING_GATE_INPUT);
    expect(gates.every((gate) => gate.passed)).toBe(true);

    const content = renderAlertContent(
      fx.confirmedOpportunityRenderInput(outcome, {
        socialCapabilityState: 'SOCIAL_UNAVAILABLE',
      }),
    );
    expect(content.envelope.alertClass).toBe('CONFIRMED_OPPORTUNITY');
    expect(content.envelope.socialCapabilityState).toBe('SOCIAL_UNAVAILABLE');
    expect(content.missingData).toContain(fx.SOCIAL_UNAVAILABLE_MISSING_DATA_ENTRY);
  });

  it('suppresses an organic-confirmation claim made while coverage is unavailable (failure path)', () => {
    const outcome = classifyAlert(fx.socialUnavailableOrganicConfirmationRequest());
    expect(outcome.kind).toBe(AlertClassificationKind.SUPPRESSED);
    expect(outcome.alertClass).toBeNull();
    expect(outcome.contentTemplate).toBeNull();
    expect(outcome.suppressionReason).toBe(
      AlertSuppressionReason.SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION,
    );
    expect(outcome.socialUnknownCoverage).toBe(true);
    expect(outcome.organicConfirmationClaimed).toBe(false);

    // A suppressed classification has no renderable notification at all.
    expectContentRefusal(
      () => renderAlertContent(fx.earlyWatchRenderInput(outcome)),
      AlertSuppressionReason.SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION,
    );

    // The same claim under full coverage is admitted, so the suppression is
    // caused by the unavailable coverage and not by the claim itself.
    const covered = classifyAlert(
      fx.earlyWatchClassificationRequest({
        socialCapabilityState: 'SOCIAL_FULL',
        organicConfirmationClaimed: true,
      }),
    );
    expect(covered.kind).toBe(AlertClassificationKind.CLASSIFIED);
    expect(covered.organicConfirmationClaimed).toBe(true);
  });

  it('requires an explicit NAMED approved fallback before a capability check can pass', () => {
    // The alert gate set's approved-fallback law: a bare `true` without a named
    // profile fallback is NOT an approved fallback and cannot pass the check.
    const unnamed = evaluateConfirmedOpportunityGates(
      fx.passingGateInput({
        solanaSecurity: {
          deterministicChecksPassed: false,
          approvedProfileFallback: true,
          fallbackProfileId: null,
        },
      }),
    ).find((gate) => gate.gate === 'SOLANA_SECURITY_CHECKS');
    expect(unnamed?.passed).toBe(false);

    const named = evaluateConfirmedOpportunityGates(
      fx.passingGateInput({
        solanaSecurity: {
          deterministicChecksPassed: false,
          approvedProfileFallback: true,
          fallbackProfileId: 'approved-fallback-profile-1',
        },
      }),
    ).find((gate) => gate.gate === 'SOLANA_SECURITY_CHECKS');
    expect(named?.passed).toBe(true);
  });
});
