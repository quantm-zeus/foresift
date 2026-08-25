/**
 * Versioned Zod schemas mirroring the Shared Tool Core boundary contracts —
 * the manifest schemaRefs for FR-CORE-001…008
 * (`packages/shared-schemas/src/core.ts`).
 *
 * Mirrors are by construction: every enum is built FROM the `@foresift/domain`
 * §16 vocabulary constants, so the TS contracts and their authoritative Zod
 * forms cannot drift. Structural rules are encoded as refines; BEHAVIORAL
 * enforcement (pipeline order, fencing checks, reservation transitions,
 * license verdicts) lives in `@foresift/tool-core`, not here. No field
 * accepts secret material.
 */
import { z } from 'zod';
import {
  ALL_ACTION_CLASSES,
  ALL_BACKPRESSURE_ACTIONS,
  ALL_CACHE_OUTCOMES,
  ALL_HOLDER_MODES,
  ALL_PIPELINE_STAGES,
  ALL_QUOTA_MODELS,
  ALL_RESERVATION_STATES,
  ALL_TOOL_PROFILE_IDS,
  ALL_WORKLOAD_CLASSES,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

/** Registry version — bumped only on breaking shape changes, never silently. */
export const CORE_SCHEMA_REGISTRY_VERSION = 1;

const asEnum = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]);

// --- §16 vocabularies (mirrored from domain by construction) -----------------

export const ActionClassSchema = asEnum(ALL_ACTION_CLASSES);
export type CoreActionClass = z.infer<typeof ActionClassSchema>;

export const WorkloadClassSchema = asEnum(ALL_WORKLOAD_CLASSES);
export type WorkloadClass = z.infer<typeof WorkloadClassSchema>;

export const CacheOutcomeSchema = asEnum(ALL_CACHE_OUTCOMES);
export type CacheOutcome = z.infer<typeof CacheOutcomeSchema>;

export const QuotaModelSchema = asEnum(ALL_QUOTA_MODELS);
export type QuotaModel = z.infer<typeof QuotaModelSchema>;

export const ReservationStateSchema = asEnum(ALL_RESERVATION_STATES);
export type ReservationState = z.infer<typeof ReservationStateSchema>;

export const BackpressureActionSchema = asEnum(ALL_BACKPRESSURE_ACTIONS);
export type BackpressureAction = z.infer<typeof BackpressureActionSchema>;

export const HolderModeSchema = asEnum(ALL_HOLDER_MODES);
export type HolderMode = z.infer<typeof HolderModeSchema>;

export const ToolProfileIdSchema = asEnum(ALL_TOOL_PROFILE_IDS);
export type ToolProfileId = z.infer<typeof ToolProfileIdSchema>;

export const PipelineStageSchema = asEnum(ALL_PIPELINE_STAGES);
export type PipelineStageId = z.infer<typeof PipelineStageSchema>;

// --- FR-CORE-001: tool definition metadata -------------------------------------

/**
 * Registration-relevant metadata of a §16.1 ToolDefinition. The `execute`
 * function itself is deliberately NOT part of this boundary record —
 * definition hashes pin metadata only. `estimatedCost` is opaque passthrough
 * DATA: cost semantics belong to g0-cost-capacity behind the quota seam and
 * are never interpreted here.
 */
export const ToolDefinitionMetadataSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9_]*$/, { message: 'tool names are snake_case identifiers' }),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, {
      message: 'tool versions are semver strings',
    }),
    title: z.string().min(1),
    description: z.string().min(1),
    actionClass: ActionClassSchema.refine((value) => value !== 'PROHIBITED_FINANCIAL', {
      message: 'PROHIBITED_FINANCIAL definitions are never registrable',
    }),
    profiles: z.array(ToolProfileIdSchema).min(1),
    requiredScopes: z.array(z.string().min(1)),
    cachePolicyId: z.string().min(1),
    quotaPolicyId: z.string().min(1),
    licensePolicyId: z.string().min(1),
    estimatedCost: z.record(z.string(), z.unknown()),
    /** Input/output JSON-Schema shapes for MCP-style surface generation. */
    inputSchemaJson: z.record(z.string(), z.unknown()),
    outputSchemaJson: z.record(z.string(), z.unknown()),
    /**
     * Provider-specific atomic tools (§16.9) are visible only to
     * adapter-test / admin-diagnostic / expert-scoped profiles; domain tools
     * omit the flag entirely.
     */
    atomic: z.boolean().optional(),
  })
  .strict();
export type ToolDefinitionMetadata = z.infer<typeof ToolDefinitionMetadataSchema>;

/** One immutable registry entry (name, version) with its pinned hash. */
export const ToolRegistryEntrySchema = z
  .object({
    toolName: z.string().min(1),
    toolVersion: z.string().min(1),
    definitionHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    actionClass: ActionClassSchema,
    profiles: z.array(ToolProfileIdSchema).min(1),
    requiredScopes: z.array(z.string().min(1)),
    cachePolicyId: z.string().min(1),
    quotaPolicyId: z.string().min(1),
    licensePolicyId: z.string().min(1),
    registeredAt: UtcTimestampSchema,
    retiredAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type ToolRegistryEntry = z.infer<typeof ToolRegistryEntrySchema>;

// --- FR-CORE-003: result envelope --------------------------------------------------

/** Reference to one provider disagreement preserved in `conflicts[]`. */
export const ProviderConflictRefSchema = z
  .object({
    conflictId: z.string().min(1),
    providers: z.array(z.string().min(1)).min(2),
    fieldPath: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ProviderConflictRef = z.infer<typeof ProviderConflictRefSchema>;

/** Structured quota summary carried in every envelope meta (never secrets). */
export const QuotaUsageSummarySchema = z
  .object({
    quotaModel: QuotaModelSchema,
    reservationState: ReservationStateSchema,
    estimatedUnits: z.number().nonnegative().nullable(),
    actualUnits: z.number().nonnegative().nullable(),
  })
  .strict();
export type QuotaUsageSummary = z.infer<typeof QuotaUsageSummarySchema>;

/** THE §16.3 ToolResult envelope meta — field list verbatim. */
export const ToolResultMetaSchema = z
  .object({
    toolName: z.string().min(1),
    toolVersion: z.string().min(1),
    provider: z.string().min(1).optional(),
    operation: z.string().min(1).optional(),
    evidenceIds: z.array(z.string().min(1)),
    observedAt: UtcTimestampSchema.optional(),
    availableAt: UtcTimestampSchema.optional(),
    fetchedAt: UtcTimestampSchema,
    cache: CacheOutcomeSchema,
    freshnessSeconds: z.number().nonnegative().optional(),
    qualityCodes: z.array(z.string().min(1)),
    conflicts: z.array(ProviderConflictRefSchema),
    quota: QuotaUsageSummarySchema,
    partial: z.boolean(),
    nextCursor: z.string().min(1).optional(),
    resourceUris: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ToolResultMeta = z.infer<typeof ToolResultMetaSchema>;

export const ToolResultEnvelopeSchema = z
  .object({
    data: z.unknown(),
    meta: ToolResultMetaSchema,
  })
  .strict();
export type ToolResultEnvelope = z.infer<typeof ToolResultEnvelopeSchema>;

// --- FR-CORE-006: exact cache key + lease records -------------------------------------

/** THE nine mandated §16.4 key components — no semantic caching anywhere. */
export const CacheKeyComponentsSchema = z
  .object({
    provider: z.string().min(1),
    operation: z.string().min(1),
    operationVersion: z.string().min(1),
    chain: z.string().min(1),
    canonicalEntityIdentity: z.string().min(1),
    normalizedArguments: z.record(z.string(), z.unknown()),
    fieldProjection: z.array(z.string().min(1)),
    asOf: UtcTimestampSchema,
    licensePolicyVersion: z.string().min(1),
  })
  .strict();
export type CacheKeyComponents = z.infer<typeof CacheKeyComponentsSchema>;

/** One single-flight lease row with its monotonic fencing token. */
export const SingleFlightLeaseRecordSchema = z
  .object({
    resourceKeyHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    fencingToken: z.number().int().positive(),
    holderMode: HolderModeSchema,
    holderId: z.string().min(1),
    acquiredAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    releasedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type SingleFlightLeaseRecord = z.infer<typeof SingleFlightLeaseRecordSchema>;

/** One exact-cache entry as persisted (payload referenced, never inlined). */
export const ExactCacheEntryRecordSchema = z
  .object({
    cacheKeyHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    payloadRef: z.string().min(1),
    storedAt: UtcTimestampSchema,
    freshUntil: UtcTimestampSchema,
    staleUntil: UtcTimestampSchema,
    licensePolicyVersion: z.string().min(1),
    rightsPermitted: z.boolean(),
  })
  .strict();
export type ExactCacheEntryRecord = z.infer<typeof ExactCacheEntryRecordSchema>;

// --- FR-CORE-007: reservation records ----------------------------------------------------

/** One quota reservation row across the §16.7 state machine. */
export const QuotaReservationRecordSchema = z
  .object({
    reservationId: z.string().min(1),
    pipelineRunId: z.string().min(1),
    stage: z.string().min(1),
    actorId: z.string().min(1),
    provider: z.string().min(1),
    operation: z.string().min(1),
    workloadClass: WorkloadClassSchema,
    estimatedUnits: z.number().nonnegative(),
    actualUnits: z.number().nonnegative().nullable(),
    state: ReservationStateSchema,
    createdAt: UtcTimestampSchema,
    reservedAt: UtcTimestampSchema.nullable(),
    settledAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type QuotaReservationRecord = z.infer<typeof QuotaReservationRecordSchema>;

// --- FR-CORE-008: license verdicts ------------------------------------------------------------

/** Typed verdict returned by every LicensePolicySource implementation. */
export const LicenseVerdictSchema = z
  .object({
    allowed: z.boolean(),
    policyVersion: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type LicenseVerdict = z.infer<typeof LicenseVerdictSchema>;

// --- blocked-state payloads -----------------------------------------------------------------------

/**
 * Payload carried when the pipeline exits blocked / not-requested BEFORE any
 * external request. States stay distinguishable per §16.2 preamble — a
 * policy choice is never rendered as a retrieval failure.
 */
export const BlockedStatePayloadSchema = z
  .object({
    acquisitionState: z.enum([
      'NOT_REQUESTED_BY_POLICY',
      'COST_BLOCKED',
      'QUOTA_BLOCKED',
      'CAPABILITY_UNAVAILABLE',
      'RIGHTS_BLOCKED',
      'PROVIDER_UNAVAILABLE',
      'TIMED_OUT',
      'INVALID_RESPONSE',
    ]),
    machineReason: z.string().min(1),
    toolName: z.string().min(1),
    toolVersion: z.string().min(1),
    pipelineRunId: z.string().min(1),
    at: UtcTimestampSchema,
  })
  .strict();
export type BlockedStatePayload = z.infer<typeof BlockedStatePayloadSchema>;

// --- registry map -----------------------------------------------------------------------------------

export const CORE_SCHEMAS = {
  ToolDefinitionMetadata: ToolDefinitionMetadataSchema,
  ToolRegistryEntry: ToolRegistryEntrySchema,
  ToolResultEnvelope: ToolResultEnvelopeSchema,
  ToolResultMeta: ToolResultMetaSchema,
  ProviderConflictRef: ProviderConflictRefSchema,
  QuotaUsageSummary: QuotaUsageSummarySchema,
  CacheKeyComponents: CacheKeyComponentsSchema,
  SingleFlightLeaseRecord: SingleFlightLeaseRecordSchema,
  ExactCacheEntryRecord: ExactCacheEntryRecordSchema,
  QuotaReservationRecord: QuotaReservationRecordSchema,
  LicenseVerdict: LicenseVerdictSchema,
  BlockedStatePayload: BlockedStatePayloadSchema,
} as const;

export type CoreSchemaName = keyof typeof CORE_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. Throws ZodError on failure. */
export function parseCoreSchema<T extends CoreSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof CORE_SCHEMAS)[T]> {
  return CORE_SCHEMAS[name].parse(payload) as z.infer<(typeof CORE_SCHEMAS)[T]>;
}
