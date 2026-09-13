/**
 * §26.4 fingerprint, material-change, and cooldown fixtures (T027,
 * FR-ALERT-001/004, AC-141; PRD §26.4).
 *
 * The matrix rows carry BOTH the prior/next states and the expected
 * component flags, so a threshold change in the domain registry fails the
 * fixture-driven assertion rather than silently reinterpreting it. Inert data
 * only: no hashing, no I/O, no clock.
 */
import {
  AlertClass,
  FingerprintOutcome,
  type AlertFingerprintInput,
  type AlertMaterialState,
} from '@foresift/domain';
import type { AlertFingerprintLedgerInput } from '@foresift/alerts';
import {
  ALERT_FIXTURE_COOLDOWN_UNTIL,
  ALERT_FIXTURE_T0,
  ALERT_FIXTURE_VALID_UNTIL,
  ALERT_HASH_A,
  ALERT_HASH_B,
  ALERT_HASH_C,
  cloneFixture,
  deepFreeze,
} from './common.ts';

/** A fresh §26.4 fingerprint input. */
export function fingerprintInputFixture(
  overrides: Partial<AlertFingerprintInput> = {},
): AlertFingerprintInput {
  return {
    assetId: 'asset-1',
    profileId: 'profile-1',
    alertType: AlertClass.CONFIRMED_OPPORTUNITY,
    lifecycleState: 'CONFIRMED',
    riskState: 'LOW',
    thesisVersion: 1,
    executionScenarioId: 'scenario-1',
    validUntilGeneration: 1,
    materialEvidenceFingerprint: ALERT_HASH_B,
    ...overrides,
  };
}

/** A fresh material state under one class. */
export function materialStateFixture(
  alertClass: AlertClass,
  overrides: Partial<AlertMaterialState> = {},
): AlertMaterialState {
  return {
    alertClass,
    severity: 0.9,
    thesisVersion: 1,
    materialEvidenceFingerprint: ALERT_HASH_B,
    ...overrides,
  };
}

/** One material-change row: the states plus the exact expected verdict flags. */
export interface MaterialChangeCase {
  readonly label: string;
  readonly alertClass: AlertClass;
  readonly prior: AlertMaterialState;
  readonly next: AlertMaterialState;
  readonly expectedChanged: boolean;
  readonly expectedClassChanged: boolean;
  readonly expectedSeverityChanged: boolean;
  readonly expectedThesisChanged: boolean;
  readonly expectedMaterialEvidenceChanged: boolean;
}

function changeCase(
  label: string,
  alertClass: AlertClass,
  next: Partial<AlertMaterialState>,
  expected: Omit<MaterialChangeCase, 'label' | 'alertClass' | 'prior' | 'next'>,
  priorOverrides: Partial<AlertMaterialState> = {},
): MaterialChangeCase {
  return deepFreeze({
    label,
    alertClass,
    prior: materialStateFixture(alertClass, priorOverrides),
    next: materialStateFixture(alertClass, next),
    ...expected,
  });
}

const NO_CHANGE = {
  expectedChanged: false,
  expectedClassChanged: false,
  expectedSeverityChanged: false,
  expectedThesisChanged: false,
  expectedMaterialEvidenceChanged: false,
} as const;

/**
 * The class-material-change matrix. `materialEvidenceChangeIsMaterial` is false
 * only for OPPORTUNITY_EXPIRED (§26.4/domain registry), so an evidence-only
 * change is material for every other class and immaterial for that one.
 */
export const MATERIAL_CHANGE_MATRIX: readonly MaterialChangeCase[] = deepFreeze([
  changeCase('identical state is immaterial', AlertClass.EARLY_WATCH, {}, NO_CHANGE),
  changeCase(
    'a tiny severity delta stays under the EARLY_WATCH threshold',
    AlertClass.EARLY_WATCH,
    { severity: 0.89 },
    NO_CHANGE,
  ),
  changeCase(
    'a large severity drop is material',
    AlertClass.EARLY_WATCH,
    { severity: 0.4 },
    { ...NO_CHANGE, expectedChanged: true, expectedSeverityChanged: true },
  ),
  changeCase(
    'a thesis-version bump is material',
    AlertClass.CONFIRMED_OPPORTUNITY,
    { thesisVersion: 2 },
    { ...NO_CHANGE, expectedChanged: true, expectedThesisChanged: true },
  ),
  changeCase(
    'a material-evidence change is material for the confirmed class',
    AlertClass.CONFIRMED_OPPORTUNITY,
    { materialEvidenceFingerprint: ALERT_HASH_C },
    { ...NO_CHANGE, expectedChanged: true, expectedMaterialEvidenceChanged: true },
  ),
  changeCase(
    'a material-evidence change alone is NOT material for OPPORTUNITY_EXPIRED',
    AlertClass.OPPORTUNITY_EXPIRED,
    { materialEvidenceFingerprint: ALERT_HASH_C },
    NO_CHANGE,
  ),
  changeCase(
    'a severity delta inside the confirmed threshold is immaterial',
    AlertClass.CONFIRMED_OPPORTUNITY,
    { severity: 0.87 },
    NO_CHANGE,
  ),
  changeCase(
    'a class change is always material',
    AlertClass.THESIS_WEAKENING,
    { alertClass: AlertClass.RISK_ALERT },
    {
      expectedChanged: true,
      expectedClassChanged: true,
      expectedSeverityChanged: false,
      expectedThesisChanged: false,
      expectedMaterialEvidenceChanged: false,
    },
  ),
]);

/** A directional-deterioration case: a severity INCREASE is an improvement. */
export interface DeteriorationCase {
  readonly label: string;
  readonly prior: AlertMaterialState;
  readonly next: AlertMaterialState;
  readonly expectedDeterioration: boolean;
}

export const DETERIORATION_MATRIX: readonly DeteriorationCase[] = deepFreeze([
  {
    label: 'a severity increase is not a deterioration',
    prior: materialStateFixture(AlertClass.THESIS_WEAKENING, { severity: 0.4 }),
    next: materialStateFixture(AlertClass.THESIS_WEAKENING, {
      severity: 0.9,
      materialEvidenceFingerprint: ALERT_HASH_B,
    }),
    expectedDeterioration: false,
  },
  {
    label: 'a severity drop beyond threshold is a deterioration',
    prior: materialStateFixture(AlertClass.THESIS_WEAKENING, { severity: 0.9 }),
    next: materialStateFixture(AlertClass.THESIS_WEAKENING, { severity: 0.4 }),
    expectedDeterioration: true,
  },
  {
    label: 'a below-threshold severity drop is not a deterioration',
    prior: materialStateFixture(AlertClass.THESIS_WEAKENING, { severity: 0.9 }),
    next: materialStateFixture(AlertClass.THESIS_WEAKENING, { severity: 0.89 }),
    expectedDeterioration: false,
  },
]);

/** One repeat-suppression row with its expected fixed-precedence outcome. */
export interface RepeatSuppressionCase {
  readonly label: string;
  readonly policyClass: AlertClass;
  readonly prior: AlertMaterialState | null;
  readonly next: AlertMaterialState;
  readonly cooldownUntil: string | null;
  readonly now: string;
  readonly duplicateFingerprint: boolean;
  readonly expectedOutcome: FingerprintOutcome;
}

const materialNext = materialStateFixture(AlertClass.CONFIRMED_OPPORTUNITY, {
  severity: 0.4,
  thesisVersion: 2,
  materialEvidenceFingerprint: ALERT_HASH_C,
});
const materialPrior = materialStateFixture(AlertClass.CONFIRMED_OPPORTUNITY);

export const REPEAT_SUPPRESSION_MATRIX: readonly RepeatSuppressionCase[] = deepFreeze([
  {
    label: 'a duplicate fingerprint wins over every other state',
    policyClass: AlertClass.CONFIRMED_OPPORTUNITY,
    prior: materialPrior,
    next: materialNext,
    cooldownUntil: ALERT_FIXTURE_VALID_UNTIL,
    now: ALERT_FIXTURE_T0,
    duplicateFingerprint: true,
    expectedOutcome: FingerprintOutcome.SUPPRESS_DUPLICATE,
  },
  {
    label: 'a live cooldown suppresses the repeat',
    policyClass: AlertClass.CONFIRMED_OPPORTUNITY,
    prior: materialPrior,
    next: materialNext,
    cooldownUntil: ALERT_FIXTURE_COOLDOWN_UNTIL,
    now: ALERT_FIXTURE_T0,
    duplicateFingerprint: false,
    expectedOutcome: FingerprintOutcome.SUPPRESS_COOLDOWN,
  },
  {
    label: 'an elapsed cooldown permits a material repeat',
    policyClass: AlertClass.CONFIRMED_OPPORTUNITY,
    prior: materialPrior,
    next: materialNext,
    cooldownUntil: ALERT_FIXTURE_T0,
    now: ALERT_FIXTURE_COOLDOWN_UNTIL,
    duplicateFingerprint: false,
    expectedOutcome: FingerprintOutcome.ALLOW,
  },
  {
    label: 'a below-threshold repeat is immaterial',
    policyClass: AlertClass.CONFIRMED_OPPORTUNITY,
    prior: materialPrior,
    next: materialStateFixture(AlertClass.CONFIRMED_OPPORTUNITY, { severity: 0.89 }),
    cooldownUntil: null,
    now: ALERT_FIXTURE_T0,
    duplicateFingerprint: false,
    expectedOutcome: FingerprintOutcome.SUPPRESS_IMMATERIAL,
  },
  {
    label: 'a first-ever delivery with no prior is allowed',
    policyClass: AlertClass.CONFIRMED_OPPORTUNITY,
    prior: null,
    next: materialNext,
    cooldownUntil: null,
    now: ALERT_FIXTURE_T0,
    duplicateFingerprint: false,
    expectedOutcome: FingerprintOutcome.ALLOW,
  },
]);

/** A fresh fingerprint-ledger advance for `upsertAlertFingerprint`. */
export function fingerprintLedgerFixture(
  overrides: Partial<AlertFingerprintLedgerInput> = {},
): AlertFingerprintLedgerInput {
  return {
    fingerprint: ALERT_HASH_A,
    alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
    lastAlertId: 'aalt-ledger-1',
    lastSeverity: 0.9,
    lastThesisVersion: 1,
    lastMaterialEvidenceFingerprint: ALERT_HASH_B,
    lastDeliveredAt: ALERT_FIXTURE_T0,
    cooldownUntil: ALERT_FIXTURE_COOLDOWN_UNTIL,
    updatedAt: ALERT_FIXTURE_T0,
    ...overrides,
  };
}

/** The stale ledger write a regression guard must refuse. */
export function staleLedgerWriteFixture(): AlertFingerprintLedgerInput {
  return cloneFixture(
    fingerprintLedgerFixture({
      fingerprint: ALERT_HASH_A,
      updatedAt: '2026-06-01T11:00:00.000Z',
      lastAlertId: 'aalt-ledger-stale',
    }),
  );
}
