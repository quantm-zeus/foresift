/**
 * Alert policy-row fixtures (T027, FR-ALERT-001/002, AC-140/143; PRD §26.1).
 *
 * A schema-shaped `alert.alert_policies` row builder (the T012 policy-version
 * authority) plus the class→template map. Inert data only: callers seed the row
 * themselves.
 */
import { AlertClass } from '@foresift/domain';
import type { AlertClassPolicyRow } from '@foresift/shared-schemas';
import { ALERT_FIXTURE_T0, ALERT_HASH_A, deepFreeze } from './common.ts';

/** The closed class → content-template map (§26.2). */
export const POLICY_TEMPLATE_BY_CLASS: Readonly<Record<AlertClass, string>> = deepFreeze({
  EARLY_WATCH: 'EARLY_WATCH',
  CONFIRMED_OPPORTUNITY: 'OPPORTUNITY',
  THESIS_STRENGTHENING: 'THESIS_UPDATE',
  THESIS_WEAKENING: 'THESIS_UPDATE',
  OPPORTUNITY_EXPIRED: 'EXPIRY',
  RISK_ALERT: 'RISK',
});

/** A fresh policy-version row; every field overridable. */
export function policyRowFixture(
  overrides: Partial<AlertClassPolicyRow> = {},
): AlertClassPolicyRow {
  const alertClass = (overrides.alertClass ?? AlertClass.EARLY_WATCH) as AlertClass;
  return {
    policyId: `policy-${alertClass}-${overrides.version ?? 1}`,
    alertClass,
    version: 1,
    configHash: ALERT_HASH_A,
    config: { contentPolicyVersion: 1, template: POLICY_TEMPLATE_BY_CLASS[alertClass] },
    ttlSeconds: alertClass === AlertClass.EARLY_WATCH ? 900 : 3600,
    cooldownSeconds: 60,
    highConvictionAllowed: alertClass === AlertClass.CONFIRMED_OPPORTUNITY,
    confirmedDenominatorMember: alertClass === AlertClass.CONFIRMED_OPPORTUNITY,
    thresholds: {},
    supersededBy: null,
    createdAt: ALERT_FIXTURE_T0,
    ...overrides,
  } as AlertClassPolicyRow;
}

/**
 * The exact key surface of a resolved `AlertPolicy`. A configuration payload
 * can never widen this surface (AC-143): there is no adapter/capability field.
 */
export const ALERT_POLICY_KEY_SURFACE: readonly string[] = deepFreeze([
  'alertClass',
  'cooldownSeconds',
  'confirmedDenominatorMember',
  'content',
  'policyId',
  'source',
  'thresholds',
  'ttlSeconds',
  'version',
]);
