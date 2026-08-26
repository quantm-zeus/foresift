/**
 * Provider-lifecycle alphabets (FR-PROV-001…010; §15.2, §15.4, FR-PROV-008,
 * §15.6, §15.7). Single in-package source for every CHECK-pinned vocabulary
 * the SQL migrations and the engine modules share.
 *
 * MIRROR COMMITMENT: the authoritative Zod schemas for these contracts target
 * `packages/shared-schemas/src/prov.ts` (ADR-0013; manifest schemaRefs). That
 * module lands in a parallel shard of this wave; until the shards merge, this
 * package is self-contained and its alphabet VALUES here are pinned
 * value-for-value to the PRD vocabularies (§15.2 capability classes, §12.11
 * states, §15.4 health statuses, nine verification kinds, five quarantine
 * classes, seven rights use paths, six fingerprint kinds) so the merge cannot
 * diverge silently — the convergence sweep compares both enumerations.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from '@foresift/shared-schemas';
import { KeyedHashSchema } from '@foresift/shared-schemas';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const PROV_VOCABULARY_VERSION = 1;

// ---------------------------------------------------------------------------
// §15.2 cost classes
// ---------------------------------------------------------------------------

export const PROVIDER_COST_CLASSES = [
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
] as const;
export const ProviderCostClassSchema = z.enum(PROVIDER_COST_CLASSES);
export type ProviderCostClass = z.infer<typeof ProviderCostClassSchema>;

// ---------------------------------------------------------------------------
// §15.2 capability classes — prohibited values are named ONLY to be refused
// ---------------------------------------------------------------------------

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
export const ProviderAllowedCapabilityClassSchema = z.enum(ALLOWED_CAPABILITY_CLASSES);
export type ProviderAllowedCapabilityClass = z.infer<typeof ProviderAllowedCapabilityClassSchema>;

/**
 * The §15.2/§41.1 prohibited classes: trading, signing, submit, custody.
 * They are UNREPRESENTABLE in the registry (SQL CHECK omits them; registration
 * refuses them outright) — listed here solely as the refusal vocabulary the
 * negative-capability surfaces report.
 */
export const PROHIBITED_CAPABILITY_CLASSES = [
  'PROHIBITED_TRANSACTION_BUILD',
  'PROHIBITED_SIGN',
  'PROHIBITED_SUBMIT',
  'PROHIBITED_CUSTODY',
] as const;
export type ProhibitedCapabilityClass = (typeof PROHIBITED_CAPABILITY_CLASSES)[number];

export function isProhibitedCapabilityClass(capabilityClass: string): boolean {
  return (PROHIBITED_CAPABILITY_CLASSES as readonly string[]).includes(capabilityClass);
}

/** The negativeCapabilities metadata attached to EVERY registered operation. */
export const REQUIRED_NEGATIVE_CAPABILITIES = [...PROHIBITED_CAPABILITY_CLASSES] as const;

// ---------------------------------------------------------------------------
// §15.4 health statuses (twelve values)
// ---------------------------------------------------------------------------

export const PROVIDER_HEALTH_STATUSES = [
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
export const ProviderHealthStatusSchema = z.enum(PROVIDER_HEALTH_STATUSES);
export type ProviderHealthStatus = z.infer<typeof ProviderHealthStatusSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-002 verification kinds (eight named by the requirement + live probe),
// sources, outcomes
// ---------------------------------------------------------------------------

export const PROVIDER_VERIFICATION_KINDS = [
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
export const ProviderVerificationKindSchema = z.enum(PROVIDER_VERIFICATION_KINDS);
export type ProviderVerificationKind = z.infer<typeof ProviderVerificationKindSchema>;

export const VERIFICATION_SOURCES = ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const;
export const VerificationSourceSchema = z.enum(VERIFICATION_SOURCES);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const VERIFICATION_OUTCOMES = ['PASSED', 'FAILED', 'INCONCLUSIVE'] as const;
export const VerificationOutcomeSchema = z.enum(VERIFICATION_OUTCOMES);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

// ---------------------------------------------------------------------------
// Affected-feature dependency consumers (§15.4 "affected features")
// ---------------------------------------------------------------------------

export const DEPENDENCY_CONSUMER_KINDS = ['FEATURE', 'TOOL', 'EXPORT', 'ALERT_DERIVATIVE'] as const;
export const DependencyConsumerKindSchema = z.enum(DEPENDENCY_CONSUMER_KINDS);
export type DependencyConsumerKind = z.infer<typeof DependencyConsumerKindSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-008 quarantine classes (the five malicious-response classes)
// ---------------------------------------------------------------------------

export const QUARANTINE_CLASSES = [
  'TRANSACTION_PAYLOAD',
  'SIGNING_REQUEST',
  'EXECUTABLE_INSTRUCTION',
  'PRIVATE_KEY_FIELD',
  'UNEXPECTED_WRITE_CAPABILITY',
] as const;
export const QuarantineClassSchema = z.enum(QUARANTINE_CLASSES);
export type QuarantineClass = z.infer<typeof QuarantineClassSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-009 / §15.6 rights use paths, artifact states, action kinds
// ---------------------------------------------------------------------------

export const RIGHTS_USE_PATHS = [
  'STORAGE',
  'DERIVED_USE',
  'REDISTRIBUTION',
  'CACHING',
  'EXPORT',
  'MODEL_TRAINING',
  'PUBLIC_ALERT',
] as const;
export const RightsUsePathSchema = z.enum(RIGHTS_USE_PATHS);
export type RightsUsePath = z.infer<typeof RightsUsePathSchema>;

export const PROVIDER_ARTIFACT_STATES = ['ACTIVE', 'QUARANTINED', 'RETIRED'] as const;
export const ProviderArtifactStateSchema = z.enum(PROVIDER_ARTIFACT_STATES);
export type ProviderArtifactState = z.infer<typeof ProviderArtifactStateSchema>;

export const RIGHTS_ACTION_KINDS = ['QUARANTINE', 'RETIRE'] as const;
export const RightsActionKindSchema = z.enum(RIGHTS_ACTION_KINDS);
export type RightsActionKind = z.infer<typeof RightsActionKindSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-010 fingerprint kinds (six)
// ---------------------------------------------------------------------------

export const PROVIDER_FINGERPRINT_KINDS = [
  'UPSTREAM_LINEAGE',
  'VALUE_CORRELATION',
  'TIMING_BEHAVIOR',
  'OUTAGE_CORRELATION',
  'SCHEMA_CHARACTERISTICS',
  'FIRST_SEEN_BEHAVIOR',
] as const;
export const ProviderFingerprintKindSchema = z.enum(PROVIDER_FINGERPRINT_KINDS);
export type ProviderFingerprintKind = z.infer<typeof ProviderFingerprintKindSchema>;

// ---------------------------------------------------------------------------
// FR-PROV-003 replacement-plan statuses
// ---------------------------------------------------------------------------

export const REPLACEMENT_PLAN_STATUSES = [
  'DRAFT',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABANDONED',
] as const;
export const ReplacementPlanStatusSchema = z.enum(REPLACEMENT_PLAN_STATUSES);
export type ReplacementPlanStatus = z.infer<typeof ReplacementPlanStatusSchema>;

/** Approved replacement plan bound to every migration exception. */
export const ReplacementPlanSchema = z
  .object({
    planId: z.string().min(1),
    targetProviderId: z.string().min(1),
    targetOperationId: z.string().min(1),
    targetVersion: z.string().min(1),
    plannedMigrationDeadline: UtcTimestampSchema,
    milestones: z.array(z.string().min(1)).min(1),
    status: ReplacementPlanStatusSchema,
  })
  .strict();
export type ReplacementPlan = z.infer<typeof ReplacementPlanSchema>;

/** Shared `sha256:<hex>` hash shape (same keyed-hash contract as sec). */
export const ProvKeyedHashSchema = KeyedHashSchema;
