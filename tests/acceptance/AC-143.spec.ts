/**
 * AC-143 acceptance (positive + failure path).
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-SOC-001, FR-SOC-002, FR-SOC-003,
 * FR-SOC-004, AC-143.
 * AC text (manifest §39.13): "Unauthorized scraping/private endpoint adapters
 * cannot be enabled by configuration or model request."
 *
 * The alert-scoped slice (PRD §67.3) is proven against
 * `tests/fixtures/alerts/**`:
 * - every prohibited capability reference — canonical and case/separator
 *   obfuscated — is detected and refused typed, BEFORE any classification;
 * - an authorized official/aggregated/public/user-curated reference is admitted;
 * - an alert policy configuration payload that names a prohibited adapter is
 *   inert: the resolved policy surface has no adapter field and its template is
 *   unchanged, so configuration cannot enable the capability;
 * - a config that repurposes the template as a capability name is refused.
 */
import { describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  ALL_ALERT_PROHIBITED_CAPABILITY_MODES,
  AlertClassificationKind,
  AlertProhibitedCapabilityMode,
  assertNoProhibitedCapabilityRefs,
  buildAlertPolicyRegistry,
  classifyAlert,
  prohibitedCapabilityModeFor,
} from '@foresift/alerts';
import * as fx from '../fixtures/alerts/index.ts';
import { expectAlertCodeSync } from './alerts-helpers.ts';

describe('AC-143: unauthorized scraping/private-endpoint adapters cannot be enabled', () => {
  it('detects and refuses every prohibited capability reference, canonical and obfuscated', () => {
    const allRefs = [...fx.PROHIBITED_CAPABILITY_REFS, ...fx.OBFUSCATED_PROHIBITED_CAPABILITY_REFS];
    const detectedModes = new Set<string>();
    for (const ref of allRefs) {
      const mode = prohibitedCapabilityModeFor(ref);
      expect(mode).not.toBeNull();
      if (mode !== null) detectedModes.add(mode);
      expectAlertCodeSync(
        () => assertNoProhibitedCapabilityRefs([ref]),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    }
    // Every closed §67.3 mode is reachable from the fixture corpus.
    for (const mode of ALL_ALERT_PROHIBITED_CAPABILITY_MODES) {
      expect(detectedModes.has(mode)).toBe(true);
    }
    expect(detectedModes.size).toBe(ALL_ALERT_PROHIBITED_CAPABILITY_MODES.length);
  });

  it('admits only official, provider-authorized, public, and user-curated references', () => {
    for (const ref of fx.AUTHORIZED_CAPABILITY_REFS) {
      expect(prohibitedCapabilityModeFor(ref)).toBeNull();
    }
    expect(() => assertNoProhibitedCapabilityRefs(fx.AUTHORIZED_CAPABILITY_REFS)).not.toThrow();
    // No capability references at all is also permitted.
    expect(() => assertNoProhibitedCapabilityRefs(undefined)).not.toThrow();

    const admitted = classifyAlert(fx.authorizedCapabilityRequest());
    expect(admitted.kind).toBe(AlertClassificationKind.CLASSIFIED);
    expect(admitted.alertClass).toBe('EARLY_WATCH');
  });

  it('refuses a prohibited model request before any classification or gate evaluation', () => {
    // A plain watch request naming a scraping adapter is refused typed.
    expectAlertCodeSync(
      () => classifyAlert(fx.prohibitedCapabilityRequest()),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );

    // Even a request that would otherwise clear the whole §26.3 gate set is
    // refused: the prohibited reference is checked first.
    expectAlertCodeSync(
      () =>
        classifyAlert(
          fx.confirmedOpportunityClassificationRequest({
            requestedCapabilityRefs: [...fx.PROHIBITED_CAPABILITY_REFS],
          }),
        ),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('cannot enable an adapter through alert policy configuration', () => {
    const row = fx.policyRowFixture({ config: { ...fx.PROHIBITED_POLICY_CONFIG } });
    const registry = buildAlertPolicyRegistry([row]);
    const policy = registry.policyFor('EARLY_WATCH');

    // The resolved policy keeps exactly its declared surface: no adapter field.
    expect(Object.keys(policy).sort()).toEqual([...fx.ALERT_POLICY_KEY_SURFACE].sort());
    expect(policy.content.template).toBe('EARLY_WATCH');
    expect(policy.content).not.toHaveProperty('adapter');
    expect(policy.content).not.toHaveProperty('capabilityRefs');
    expect(policy).not.toHaveProperty('capabilityRefs');
    expect(policy).not.toHaveProperty('alertAdapter');
    expect(policy).not.toHaveProperty('template');

    // No prohibited marker survives anywhere in the resolved policy value.
    const serialized = JSON.stringify(policy).toLowerCase();
    for (const marker of [
      'scraping',
      'private-endpoint',
      'private-api',
      'undocumented',
      'reverse-engineer',
    ]) {
      expect(serialized).not.toContain(marker);
    }

    // Classification through that registry is unchanged: the config is inert.
    const outcome = classifyAlert(fx.earlyWatchClassificationRequest(), { registry });
    expect(outcome.kind).toBe(AlertClassificationKind.CLASSIFIED);
    expect(outcome.alertClass).toBe('EARLY_WATCH');

    // A configuration that repurposes the template as a capability name (or an
    // unmapped content version) is refused rather than enabled.
    expectAlertCodeSync(
      () =>
        buildAlertPolicyRegistry([
          fx.policyRowFixture({ config: { contentPolicyVersion: 1, template: 'SCRAPING' } }),
        ]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
    expectAlertCodeSync(
      () =>
        buildAlertPolicyRegistry([
          fx.policyRowFixture({
            config: {
              contentPolicyVersion: 1,
              template: AlertProhibitedCapabilityMode.PRIVATE_ENDPOINT,
            },
          }),
        ]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
  });
});
