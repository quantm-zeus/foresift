/**
 * Versioned Zod schemas mirroring the DR contracts — the manifest schemaRefs
 * for FR-DR-001 (tiered recovery objectives) and FR-DR-002 (durable backup,
 * restore drills, key separation).
 *
 * Mirrors are by construction: ceilings, classes, and health-state rules come
 * from `@foresift/domain`. Key separation is enforced structurally: a backup
 * policy stores a `keyReference` matching an opaque-reference pattern — never
 * key material.
 */
import { z } from 'zod';
import {
  RecoveryDataClass,
  RecoveryHealthStateKind,
  TIER_RPO_CEILING_MINUTES,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const DR_SCHEMA_REGISTRY_VERSION = 1;

const dataClassValues = Object.values(RecoveryDataClass) as [
  (typeof RecoveryDataClass)[keyof typeof RecoveryDataClass],
  ...(typeof RecoveryDataClass)[keyof typeof RecoveryDataClass][],
];

/** A configured tier; RPO MUST be within the §34.4 ceiling for its class. */
export const RecoveryTierSchema = z
  .object({
    id: z.string().min(1),
    dataClass: z.enum(dataClassValues),
    rpoTargetMinutes: z.number().positive(),
    rtoTargetMinutes: z.number().positive(),
  })
  .strict()
  .refine((v) => v.rpoTargetMinutes <= TIER_RPO_CEILING_MINUTES[v.dataClass], {
    message: 'RPO target exceeds the class ceiling',
  });

export const TierMeasurementOutcomeSchema = z.enum([
  'WITHIN_TIER',
  'MISSED_RPO',
  'MISSED_RTO',
  'MISSED_BOTH',
]);

export const TierMeasurementSchema = z
  .object({
    tierId: z.string().min(1),
    achievedRpoMinutes: z.number().min(0),
    achievedRtoMinutes: z.number().min(0),
    outcome: TierMeasurementOutcomeSchema,
  })
  .strict();

/** Maps one protected table/store onto the tier covering it (FR-DR-001). */
export const ProtectedAssetSchema = z
  .object({
    assetKey: z.string().min(1),
    dataClass: z.enum(dataClassValues),
    tierId: z.string().min(1),
  })
  .strict();

/**
 * Backup governance record. `keyReference` is an opaque reference into a
 * separately protected keystore — the pattern refuses anything that looks like
 * embedded material, and rights/legal-hold fields gate deletion upstream.
 */
export const BackupPolicySchema = z
  .object({
    policyId: z.string().min(1),
    retentionDays: z.number().int().min(1),
    encryptionStatus: z.string().regex(/^[A-Z0-9_]+$/, 'expected UPPER_SNAKE encryption status'),
    locationRef: z.string().min(1),
    /** Reference to the verified rights basis permitting this copy. */
    rightsRef: z.string().min(1),
    legalHold: z.boolean(),
    deletionPolicy: z.string().min(1),
    keyReference: z
      .string()
      .regex(/^keyref:[A-Za-z0-9._/-]+$/, 'expected opaque keyref: reference'),
  })
  .strict();

export const BackupRunStatusSchema = z.enum(['RUNNING', 'SUCCEEDED', 'FAILED']);

export const BackupRunSchema = z
  .object({
    runId: z.string().min(1),
    policyId: z.string().min(1),
    startedAt: UtcTimestampSchema,
    finishedAt: UtcTimestampSchema.nullable(),
    status: BackupRunStatusSchema,
    artifactRefs: z.array(z.string().min(1)),
    failureReason: z.string().min(1).nullable(),
  })
  .strict()
  .refine((v) => v.status !== 'SUCCEEDED' || (v.finishedAt !== null && v.artifactRefs.length > 0), {
    message: 'successful runs finish with at least one artifact reference',
  })
  .refine((v) => v.status !== 'FAILED' || v.failureReason !== null, {
    message: 'failed runs record a reason',
  });

export const RestoreCheckSchema = z
  .object({
    checkId: z.string().min(1),
    name: z.string().min(1),
    passed: z.boolean(),
    detail: z.string(),
  })
  .strict();

export const RestoreDrillOutcomeSchema = z.enum(['PASSED', 'FAILED', 'BLOCKED']);

/**
 * One restore drill. A PASSED outcome structurally requires the separately
 * provided credential provider and every check green — fail-closed.
 */
export const RestoreDrillSchema = z
  .object({
    drillId: z.string().min(1),
    startedAt: UtcTimestampSchema,
    finishedAt: UtcTimestampSchema.nullable(),
    outcome: RestoreDrillOutcomeSchema,
    checks: z.array(RestoreCheckSchema),
    credentialProviderPresent: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.outcome !== 'PASSED' ||
      (v.credentialProviderPresent && v.finishedAt !== null && v.checks.every((c) => c.passed)),
    { message: 'PASSED requires credential provider, completion, and all checks green' },
  );

const healthKindValues = Object.values(RecoveryHealthStateKind) as [
  (typeof RecoveryHealthStateKind)[keyof typeof RecoveryHealthStateKind],
  ...(typeof RecoveryHealthStateKind)[keyof typeof RecoveryHealthStateKind][],
];

/**
 * Machine-readable recovery health (AC-260/262): degraded states block
 * confirmed-opportunity influence while preserving deterministic risk
 * monitoring; healthy states carry no incident.
 */
export const RecoveryHealthStateSchema = z
  .object({
    capability: z.string().min(1),
    kind: z.enum(healthKindValues),
    confirmedOpportunityInfluenceBlocked: z.boolean(),
    deterministicRiskMonitoringAllowed: z.boolean(),
    incidentId: z.string().min(1).nullable(),
    evaluatedAt: UtcTimestampSchema,
    reason: z.string().min(1),
  })
  .strict()
  .refine(
    (v) =>
      v.kind !== 'DEGRADED' || (v.incidentId !== null && v.confirmedOpportunityInfluenceBlocked),
    {
      message: 'degraded states require an incident and blocked opportunity influence',
    },
  )
  .refine((v) => v.kind !== 'HEALTHY' || v.incidentId === null, {
    message: 'healthy states carry no incident',
  })
  .refine((v) => v.deterministicRiskMonitoringAllowed, {
    message: 'risk monitoring is never suppressed alongside opportunity influence',
  });

// ---------------------------------------------------------------------------
// Versioned registry
// ---------------------------------------------------------------------------

export const DR_SCHEMAS = {
  RecoveryTier: RecoveryTierSchema,
  TierMeasurement: TierMeasurementSchema,
  ProtectedAsset: ProtectedAssetSchema,
  BackupPolicy: BackupPolicySchema,
  BackupRun: BackupRunSchema,
  RestoreDrill: RestoreDrillSchema,
  RecoveryHealthState: RecoveryHealthStateSchema,
} as const;

export type DrSchemaName = keyof typeof DR_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseDrSchema<T extends DrSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof DR_SCHEMAS)[T]> {
  return DR_SCHEMAS[name].parse(payload) as z.infer<(typeof DR_SCHEMAS)[T]>;
}
