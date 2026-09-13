/**
 * AC-142 negative / failure-path.
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-SOC-001, FR-SOC-002, FR-SOC-003,
 * FR-SOC-004, AC-142.
 * AC text (manifest §39.13): "Missing X/paid social capability produces
 * `SOCIAL_UNAVAILABLE`, not a negative social feature."
 *
 * Failure paths that must stay fail-closed:
 * - an unknown social capability literal is refused typed, never coerced;
 * - only `SOCIAL_UNAVAILABLE` is unknown coverage — a partial, curated, or
 *   license-blocked state is never silently upgraded to "unavailable" and does
 *   not fabricate the `SOCIAL_UNAVAILABLE` missing-data marker;
 * - a suppressed organic-confirmation claim has no class and cannot be rendered
 *   or committed;
 * - the unavailable state never becomes a negative social feature, and a
 *   compliant watch under it carries no suppression reason at all.
 */
import { describe, expect, it } from 'bun:test';
import {
  ErrorCode,
  SocialCapabilityState,
  parseSocialCapabilityState,
  socialIsUnknownCoverage,
} from '@foresift/domain';
import {
  AlertClassificationKind,
  AlertContentRefusedError,
  classifyAlert,
  renderAlertContent,
  socialCoverageVerdict,
} from '@foresift/alerts';
import * as fx from '../fixtures/alerts/index.ts';

const NON_UNKNOWN_STATES = [
  SocialCapabilityState.SOCIAL_FULL,
  SocialCapabilityState.SOCIAL_AGGREGATED,
  SocialCapabilityState.SOCIAL_USER_CURATED,
  SocialCapabilityState.SOCIAL_PARTIAL,
  SocialCapabilityState.SOCIAL_LICENSE_BLOCKED,
] as const;

describe('AC-142 negative: unavailable social capability can never become evidence or confirmation', () => {
  it('refuses an unknown social capability literal typed and rejects it at the classification boundary', () => {
    try {
      parseSocialCapabilityState('SOCIAL_BOGUS');
      throw new Error('expected a typed refusal for an unknown social capability state');
    } catch (error) {
      const actual = error as { code?: string; message?: string };
      if (actual.code === undefined) throw error;
      expect(actual.code).toBe(ErrorCode.ALERT_SOCIAL_CAPABILITY_UNKNOWN);
    }

    try {
      socialCoverageVerdict('SOCIAL_BOGUS' as never);
      throw new Error('expected socialCoverageVerdict to refuse an unknown state');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ErrorCode.ALERT_SOCIAL_CAPABILITY_UNKNOWN);
    }

    expect(() =>
      classifyAlert(
        fx.earlyWatchClassificationRequest({
          socialCapabilityState: 'SOCIAL_BOGUS' as never,
        }),
      ),
    ).toThrow();
  });

  it('keeps non-unavailable states out of unknown coverage and never fabricates the marker', () => {
    for (const state of NON_UNKNOWN_STATES) {
      expect(socialIsUnknownCoverage(state)).toBe(false);
      const verdict = socialCoverageVerdict(state);
      expect(verdict.unknownCoverage).toBe(false);
      expect(verdict.negativeEvidence).toBe(false);
      expect(verdict.organicConfirmationAvailable).toBe(false);
      expect(verdict.scoreContribution).toBe(0);

      const outcome = classifyAlert(
        fx.earlyWatchClassificationRequest({ socialCapabilityState: state }),
      );
      expect(outcome.socialUnknownCoverage).toBe(false);
      const content = renderAlertContent(
        fx.earlyWatchRenderInput(outcome, { socialCapabilityState: state }),
      );
      expect(content.missingData).not.toContain(fx.SOCIAL_UNAVAILABLE_MISSING_DATA_ENTRY);
    }
  });

  it('suppresses the organic-confirmation claim and refuses to render it', () => {
    const outcome = classifyAlert(fx.socialUnavailableOrganicConfirmationRequest());
    expect(outcome.kind).toBe(AlertClassificationKind.SUPPRESSED);
    expect(outcome.alertClass).toBeNull();
    expect(outcome.organicConfirmationClaimed).toBe(false);

    try {
      renderAlertContent(fx.earlyWatchRenderInput(outcome));
      throw new Error('expected a suppressed classification to have no renderable content');
    } catch (error) {
      expect(error).toBeInstanceOf(AlertContentRefusedError);
      expect((error as AlertContentRefusedError).reason).toBe(
        'SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION',
      );
    }
  });

  it('does not turn an unavailable social state into a suppression reason for compliant content', () => {
    const outcome = classifyAlert(fx.socialUnavailableRequest());
    const input = fx.earlyWatchRenderInput(outcome, {
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
      // Force the caller-supplied missing data empty: the renderer must still
      // disclose the absent social capability itself.
      missingData: [],
    });
    const content = renderAlertContent(input);
    expect(content.suppressionReasons).toEqual([]);
    expect(content.headlineSuppressed).toBe(false);
    expect(content.missingData).toContain(fx.SOCIAL_UNAVAILABLE_MISSING_DATA_ENTRY);
    // The unavailable state is reported as missing data, never as a negative
    // social risk feature.
    expect(content.envelope.riskEvidence).toEqual([...input.narrative.riskEvidence]);
  });
});
