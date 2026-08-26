/**
 * Normative provider-platform alphabets (§15.2/§15.4/§15.6/§15.8; FR-PROV-*).
 *
 * These are the SINGLE TS SOURCE for every CHECK-pinned value alphabet in
 * `migrations/g0_prov_*.sql` and for the local Zod schemas. The parity suites
 * assert SQL CHECK constraints, these constants, and the schemas agree
 * EXACTLY — adding a value anywhere requires touching all three together.
 */

// --- §15.2 capability classes --------------------------------------------------

/** Prohibited capability classes: NEVER representable in storage, registry, or adapters. */
export const PROHIBITED_CAPABILITY_CLASSES = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
] as const;

export type ProhibitedCapabilityClass = (typeof PROHIBITED_CAPABILITY_CLASSES)[number];

/** Permitted capability classes (the §15.2 alphabet minus the prohibited tail). */
export const ALLOWED_CAPABILITY_CLASSES = [
  'READ_MARKET',
  'READ_SECURITY',
  'READ_IDENTITY',
  'READ_TRANSACTION_RAW',
  'READ_TRANSACTION_HISTORY',
  'READ_ACCOUNT_STATE',
  'READ_SOCIAL_AGGREGATE',
  'STREAM_PROGRAM_EVENT',
  'QUOTE_READ_ONLY',
] as const;

export type AllowedCapabilityClass = (typeof ALLOWED_CAPABILITY_CLASSES)[number];

/** Any §15.2 capability class value, permitted or prohibited. */
export type CapabilityClass = AllowedCapabilityClass | ProhibitedCapabilityClass;

export function isProhibitedCapabilityClass(
  value: string,
): value is ProhibitedCapabilityClass {
  return (PROHIBITED_CAPABILITY_CLASSES as readonly string[]).includes(value);
}

// --- §15.2 cost classes ----------------------------------------------------------

export const COST_CLASSES = [
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
] as const;

export type CostClass = (typeof COST_CLASSES)[number];

// --- §15.4 health statuses ---------------------------------------------------------

export const HEALTH_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'SCHEMA_DRIFT',
  'PLAN_UNVERIFIED',
  'RIGHTS_UNVERIFIED',
  'DEPRECATED',
  'SUNSET_PENDING',
  'QUOTA_LOW',
  'QUOTA_EXHAUSTED',
  'AUTH_FAILED',
  'UNSUPPORTED',
  'DISABLED',
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

// --- §15.3 verification kinds & sources (FR-PROV-002) ------------------------------

export const VERIFICATION_KINDS = [
  'DOCUMENTATION',
  'PRICING_PLAN',
  'QUOTA',
  'RIGHTS',
  'SCHEMA',
  'ENDPOINT',
  'AUTHENTICATION',
  'DEPRECATION',
  'LIVE_PROBE',
] as const;

export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_SOURCES = ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const;

export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

/**
 * §15.4 rule 3: expiry of a verification kind transitions the operation out
 * of ACTIVE decision use into the mapped health outcome. Total over the nine
 * kinds — an unmapped kind would be a silent gap.
 */
export const EXPIRY_HEALTH_OUTCOMES: Readonly<
  Record<VerificationKind, Extract<HealthStatus, 'PLAN_UNVERIFIED' | 'RIGHTS_UNVERIFIED' | 'DEGRADED' | 'AUTH_FAILED'>>
> = {
  DOCUMENTATION: 'DEGRADED',
  PRICING_PLAN: 'PLAN_UNVERIFIED',
  QUOTA: 'PLAN_UNVERIFIED',
  RIGHTS: 'RIGHTS_UNVERIFIED',
  SCHEMA: 'DEGRADED',
  ENDPOINT: 'DEGRADED',
  AUTHENTICATION: 'AUTH_FAILED',
  DEPRECATION: 'DEGRADED',
  LIVE_PROBE: 'DEGRADED',
};

/** Kinds whose freshness gates ACTIVE decision-critical use (AC-270 set). */
export const DECISION_CRITICAL_VERIFICATION_KINDS: readonly VerificationKind[] = [
  'DOCUMENTATION',
  'PRICING_PLAN',
  'QUOTA',
  'RIGHTS',
  'SCHEMA',
  'ENDPOINT',
  'AUTHENTICATION',
  'DEPRECATION',
];

// --- dependency consumers (affected features) ---------------------------------------

export const CONSUMER_KINDS = ['FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE'] as const;

export type ConsumerKind = (typeof CONSUMER_KINDS)[number];

// --- FR-PROV-008 malicious-response classes -------------------------------------------

export const QUARANTINE_CLASSES = [
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'WRITE_CAPABILITY',
] as const;

export type QuarantineClass = (typeof QUARANTINE_CLASSES)[number];

// --- §15.6 use paths (rights enforcement surface) ---------------------------------------

export const RIGHTS_USE_PATHS = [
  'CACHE',
  'RAW_RETENTION',
  'EXPORT',
  'REDISTRIBUTION',
  'MODEL_USE',
  'STORAGE',
  'DERIVED_FEATURES',
] as const;

export type RightsUsePath = (typeof RIGHTS_USE_PATHS)[number];

// --- FR-PROV-010 fingerprint kinds --------------------------------------------------------

export const FINGERPRINT_KINDS = [
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
] as const;

export type FingerprintKind = (typeof FINGERPRINT_KINDS)[number];
