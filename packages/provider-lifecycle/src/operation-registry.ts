/**
 * Versioned operation-definition storage (FR-PROV-001, FR-PROV-004; §15.3).
 *
 * The registry owns three fail-closed rules:
 *   * registration-time validation refuses PROHIBITED_* capability classes
 *     OUTRIGHT — before any Zod parse, before any row exists (§41.1);
 *   * every §15.3 field persists exactly once per (provider, operation,
 *     version); re-registering a live version is a conflict, never an
 *     implicit overwrite;
 *   * registrations append their genesis event (NULL→DISCOVERED,
 *     REGISTERED_DISCOVERED) atomically with the first projection row, under
 *     a deterministic idempotency key so retries cannot double-append.
 *
 * Affected-feature dependency registrations (§15.4 "affected features") are
 * first-class rows here too, so deprecation can later name its blast radius.
 */
import { fixedClock, utcTimestamp, type ClockPort } from '@foresift/domain';
import { canonicalJson } from '@foresift/persistence';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  LifecycleEventRecordSchema,
  OperationDefinitionSchema,
  OperationDependencyRecordSchema,
  type LifecycleEventRecord,
  type OperationDefinition,
  type OperationDependencyRecord,
} from './schemas.ts';
import { ProvErrorCode, RegistryError } from './errors.ts';
import type { ProviderAuditBridge } from './audit-bridges.ts';

export interface OperationRegistryOptions {
  readonly engine: DatabaseEngine;
  /** Injected clock (Constitution XI) — never the wall clock. */
  readonly clock?: ClockPort;
  /** Optional security-chain bridge for cross-domain attestations. */
  readonly audit?: ProviderAuditBridge;
}

export interface RegisterProviderInput {
  readonly providerId: string;
  readonly providerGroup: string;
  readonly displayName: string;
  /** Providers start disabled-by-default; activation is always explicit. */
  readonly disabledByDefault?: boolean;
}

export interface RegistrationResult {
  readonly definition: OperationDefinition;
  readonly genesisEvent: LifecycleEventRecord;
}

interface DefinitionRow {
  provider_id: string;
  operation_id: string;
  version: string;
  capability_class: string;
  supported_chains: unknown;
  supported_programs: unknown;
  input_schema_id: string;
  raw_output_schema_id: string;
  normalized_output_schema_id: string;
  quota_model_id: string;
  cache_policy_id: string;
  timeout_ms: number;
  retry_policy_id: string;
  declared_independence_group: string;
  upstream_lineage: unknown;
  license_policy_id: string;
  health_status: string;
  cost_class: string;
  estimated_quota_units: string | number;
  quota_reset_policy_id: string;
  batch_capability: unknown;
  minimum_candidate_stage: string | null;
  protected_reserve_eligible: boolean;
  allowed_in_strict_free: boolean;
  paid_fallback_allowed: boolean;
  deprecated_at: Date | string | null;
  sunset_at: Date | string | null;
  replacement_operation_id: string | null;
  verification_expires_at: Date | string;
  forbidden_output_fields: unknown;
  negative_capabilities: unknown;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

function rowToDefinition(row: DefinitionRow): OperationDefinition {
  return OperationDefinitionSchema.parse({
    providerId: row.provider_id,
    operationId: row.operation_id,
    version: row.version,
    capabilityClass: row.capability_class,
    supportedChains: row.supported_chains,
    supportedPrograms: row.supported_programs ?? undefined,
    inputSchemaId: row.input_schema_id,
    rawOutputSchemaId: row.raw_output_schema_id,
    normalizedOutputSchemaId: row.normalized_output_schema_id,
    quotaModelId: row.quota_model_id,
    cachePolicyId: row.cache_policy_id,
    timeoutMs: row.timeout_ms,
    retryPolicyId: row.retry_policy_id,
    declaredIndependenceGroup: row.declared_independence_group,
    upstreamLineage: row.upstream_lineage,
    licensePolicyId: row.license_policy_id,
    healthStatus: row.health_status,
    costClass: row.cost_class,
    estimatedQuotaUnits: Number(row.estimated_quota_units),
    quotaResetPolicyId: row.quota_reset_policy_id,
    batchCapability: row.batch_capability ?? undefined,
    minimumCandidateStage: row.minimum_candidate_stage ?? undefined,
    protectedReserveEligible: row.protected_reserve_eligible,
    allowedInStrictFree: row.allowed_in_strict_free,
    paidFallbackAllowed: row.paid_fallback_allowed,
    deprecatedAt: row.deprecated_at === null ? undefined : iso(row.deprecated_at),
    sunsetAt: row.sunset_at === null ? undefined : iso(row.sunset_at),
    replacementOperationId: row.replacement_operation_id ?? undefined,
    verificationExpiresAt: iso(row.verification_expires_at),
    forbiddenOutputFields: row.forbidden_output_fields,
    negativeCapabilities: row.negative_capabilities,
  });
}

function rowToDependency(row: Record<string, unknown>): OperationDependencyRecord {
  return OperationDependencyRecordSchema.parse({
    dependencyId: Number(row.dependency_id),
    consumerKind: row.consumer_kind,
    consumerKey: row.consumer_key,
    providerId: row.provider_id,
    operationId: row.operation_id,
    criticalField: row.critical_field,
    active: row.active,
    registeredAt: iso(row.registered_at as Date | string),
  });
}

export class OperationRegistry {
  private readonly engine: DatabaseEngine;
  private readonly clock: ClockPort;
  private readonly audit: ProviderAuditBridge | undefined;

  constructor(options: OperationRegistryOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? fixedClock(utcTimestamp('1970-01-01T00:00:00Z'));
    this.audit = options.audit;
  }

  /**
   * Register a provider shell. Identical re-registration is an idempotent
   * no-op; a DIFFERENT description under the same id refuses (fail-closed —
   * provider identity metadata is configuration truth, not updatable here).
   */
  async registerProvider(input: RegisterProviderInput): Promise<void> {
    const disabled = input.disabledByDefault ?? true;
    const now = this.clock.now();
    await this.engine.transaction(async (tx) => {
      const existing = await tx.query<Record<string, unknown>>(
        'SELECT provider_group, display_name, disabled_by_default FROM prov.prov_providers WHERE provider_id = $1',
        [input.providerId],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        const identical =
          prior.provider_group === input.providerGroup &&
          prior.display_name === input.displayName &&
          prior.disabled_by_default === disabled;
        if (!identical) {
          throw new RegistryError(
            `provider ${input.providerId} already registered with a different description`,
            { providerId: input.providerId },
            ProvErrorCode.PROV_DEFINITION_INVALID,
          );
        }
        return;
      }
      await tx.query(
        `INSERT INTO prov.prov_providers
           (provider_id, provider_group, display_name, disabled_by_default, registered_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.providerId, input.providerGroup, input.displayName, disabled, now],
      );
    });
  }

  /**
   * Register one exact operation version. Atomically: validates the §15.3
   * definition, inserts the projection row at DISCOVERED, appends the genesis
   * ledger event, and attests cross-version CAPABILITY_CHANGE facts.
   */
  async registerOperation(definitionInput: unknown): Promise<RegistrationResult> {
    // Prohibited classes are refused OUTRIGHT, before parsing names them a
    // shape problem — they are a product-boundary violation (§41.1).
    const raw = (definitionInput ?? {}) as { capabilityClass?: unknown };
    if (
      typeof raw.capabilityClass === 'string' &&
      raw.capabilityClass.startsWith('PROHIBITED_')
    ) {
      throw new RegistryError(
        `prohibited capability class refused outright: ${raw.capabilityClass}`,
        { capabilityClass: raw.capabilityClass },
        ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
      );
    }
    const parsed = OperationDefinitionSchema.safeParse(definitionInput);
    if (!parsed.success) {
      throw new RegistryError(
        `operation definition invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }
    const definition = parsed.data;

    const result = await this.engine.transaction(async (tx) => {
      const provider = await tx.query<Record<string, unknown>>(
        'SELECT provider_id FROM prov.prov_providers WHERE provider_id = $1',
        [definition.providerId],
      );
      if (provider.rows[0] === undefined) {
        throw new RegistryError(
          `provider not registered: ${definition.providerId}`,
          { providerId: definition.providerId },
          ProvErrorCode.PROV_PROVIDER_UNKNOWN,
        );
      }

      const duplicate = await tx.query<DefinitionRow>(
        'SELECT * FROM prov.prov_operations WHERE provider_id = $1 AND operation_id = $2 AND version = $3',
        [definition.providerId, definition.operationId, definition.version],
      );
      if (duplicate.rows.length > 0) {
        throw new RegistryError(
          `operation version already registered: ${definition.providerId}/${definition.operationId}@${definition.version}`,
          {
            providerId: definition.providerId,
            operationId: definition.operationId,
            version: definition.version,
          },
          ProvErrorCode.PROV_OPERATION_VERSION_CONFLICT,
        );
      }

      // Latest prior version's capability class, for the change attestation.
      const priorVersions = await tx.query<{ capability_class: string }>(
        `SELECT capability_class FROM prov.prov_operations
         WHERE provider_id = $1 AND operation_id = $2 ORDER BY registered_at DESC LIMIT 1`,
        [definition.providerId, definition.operationId],
      );
      const previousCapabilityClass = priorVersions.rows[0]?.capability_class ?? null;

      const now = this.clock.now();
      await tx.query(
        `INSERT INTO prov.prov_operations (
           provider_id, operation_id, version, capability_class,
           supported_chains, supported_programs,
           input_schema_id, raw_output_schema_id, normalized_output_schema_id,
           quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
           declared_independence_group, upstream_lineage, license_policy_id,
           current_state, health_status, cost_class, estimated_quota_units,
           quota_reset_policy_id, batch_capability, minimum_candidate_stage,
           protected_reserve_eligible, allowed_in_strict_free, paid_fallback_allowed,
           deprecated_at, sunset_at, replacement_operation_id,
           verification_expires_at, forbidden_output_fields, negative_capabilities,
           registered_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,
                 'DISCOVERED',$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25,
                 $26,$27,$28,$29,$30::jsonb,$31::jsonb,$32)`,
        [
          definition.providerId,
          definition.operationId,
          definition.version,
          definition.capabilityClass,
          JSON.stringify(definition.supportedChains),
          definition.supportedPrograms ? JSON.stringify(definition.supportedPrograms) : null,
          definition.inputSchemaId,
          definition.rawOutputSchemaId,
          definition.normalizedOutputSchemaId,
          definition.quotaModelId,
          definition.cachePolicyId,
          definition.timeoutMs,
          definition.retryPolicyId,
          definition.declaredIndependenceGroup,
          JSON.stringify(definition.upstreamLineage),
          definition.licensePolicyId,
          definition.healthStatus,
          definition.costClass,
          String(definition.estimatedQuotaUnits),
          definition.quotaResetPolicyId,
          definition.batchCapability ? JSON.stringify(definition.batchCapability) : null,
          definition.minimumCandidateStage ?? null,
          definition.protectedReserveEligible,
          definition.allowedInStrictFree,
          definition.paidFallbackAllowed,
          definition.deprecatedAt ?? null,
          definition.sunsetAt ?? null,
          definition.replacementOperationId ?? null,
          definition.verificationExpiresAt,
          JSON.stringify(definition.forbiddenOutputFields),
          JSON.stringify(definition.negativeCapabilities),
          now,
        ],
      );

      // Genesis event: NULL→DISCOVERED under a deterministic retry fence.
      const genesisKey = `prov-register:${definition.providerId}:${definition.operationId}:${definition.version}`;
      const inserted = await tx.query<Record<string, unknown>>(
        `INSERT INTO prov.prov_lifecycle_events (
           provider_id, operation_id, operation_version, from_state, to_state,
           reason_class, actor, occurred_at, evidence_refs, idempotency_key)
         VALUES ($1, $2, $3, NULL, 'DISCOVERED', 'REGISTERED_DISCOVERED',
                 'operation-registry', $4, $5::jsonb, $6)
         RETURNING *`,
        [
          definition.providerId,
          definition.operationId,
          definition.version,
          now,
          JSON.stringify([canonicalJson(definition)]),
          genesisKey,
        ],
      );

      return {
        definition,
        genesisEvent: LifecycleEventRecordSchema.parse({
          seq: Number((inserted.rows[0] as Record<string, unknown>).seq),
          providerId: definition.providerId,
          operationId: definition.operationId,
          operationVersion: definition.version,
          fromState: null,
          toState: 'DISCOVERED',
          reasonClass: 'REGISTERED_DISCOVERED',
          actor: 'operation-registry',
          occurredAt: now,
          evidenceRefs: [canonicalJson(definition)],
          idempotencyKey: genesisKey,
        }),
        previousCapabilityClass,
      };
    });

    if (result.previousCapabilityClass !== null && result.previousCapabilityClass !== result.definition.capabilityClass) {
      await this.audit?.capabilityChange({
        occurredAt: utcTimestamp(result.genesisEvent.occurredAt),
        actor: result.genesisEvent.actor,
        providerId: result.definition.providerId,
        operationId: result.definition.operationId,
        version: result.definition.version,
        previousCapabilityClass: result.previousCapabilityClass,
        capabilityClass: result.definition.capabilityClass,
      });
    }

    return { definition: result.definition, genesisEvent: result.genesisEvent };
  }

  /**
   * Register an affected-feature dependency (§15.4 rule 1/rule 6 blast-radius
   * inputs). Refuses unknown operations and duplicate active registrations.
   */
  async registerDependency(input: {
    readonly consumerKind: OperationDependencyRecord['consumerKind'];
    readonly consumerKey: string;
    readonly providerId: string;
    readonly operationId: string;
    readonly criticalField?: string;
  }): Promise<OperationDependencyRecord> {
    const record = await this.engine.transaction(async (tx) => {
      const op = await tx.query<Record<string, unknown>>(
        `SELECT version, registered_at FROM prov.prov_operations
         WHERE provider_id = $1 AND operation_id = $2
         ORDER BY registered_at DESC LIMIT 1`,
        [input.providerId, input.operationId],
      );
      const opRow = op.rows[0];
      if (opRow === undefined) {
        throw new RegistryError(
          `cannot attach dependency to unregistered operation ${input.providerId}/${input.operationId}`,
          { providerId: input.providerId, operationId: input.operationId },
          ProvErrorCode.PROV_OPERATION_UNKNOWN,
        );
      }

      try {
        const inserted = await tx.query<Record<string, unknown>>(
          `INSERT INTO prov.prov_operation_dependencies (
             consumer_kind, consumer_key, provider_id, operation_id, critical_field,
             active, registered_at)
           VALUES ($1, $2, $3, $4, $5, true, $6)
           RETURNING *`,
          [
            input.consumerKind,
            input.consumerKey,
            input.providerId,
            input.operationId,
            input.criticalField ?? null,
            this.clock.now(),
          ],
        );
        return {
          record: rowToDependency(inserted.rows[0]!),
          version: opRow.version as string,
        };
      } catch (error) {
        if (error instanceof Error && /prov_operation_dependencies_unique|duplicate key/i.test(error.message)) {
          throw new RegistryError(
            `dependency already registered: ${input.consumerKind}/${input.consumerKey} → ${input.providerId}/${input.operationId}`,
            { consumerKind: input.consumerKind, consumerKey: input.consumerKey },
            ProvErrorCode.PROV_DEPENDENCY_REGISTRATION_INVALID,
          );
        }
        throw error;
      }
    });

    await this.audit?.sourceDependenceChange({
      occurredAt: this.clock.now(),
      actor: 'operation-registry',
      providerId: input.providerId,
      operationId: input.operationId,
      version: record.version,
      consumerKind: input.consumerKind,
      consumerKey: input.consumerKey,
      active: true,
    });
    return record.record;
  }

  /** Active dependencies naming this operation — deprecation blast radius. */
  async listDependencies(
    providerId: string,
    operationId: string,
    options?: { readonly includeInactive?: boolean },
  ): Promise<OperationDependencyRecord[]> {
    const rows = await this.engine.query<Record<string, unknown>>(
      `SELECT * FROM prov.prov_operation_dependencies
       WHERE provider_id = $1 AND operation_id = $2
         ${options?.includeInactive === true ? '' : 'AND active'}
       ORDER BY dependency_id ASC`,
      [providerId, operationId],
    );
    return rows.rows.map(rowToDependency);
  }

  /** Exact-version definition read-back. */
  async getDefinition(
    providerId: string,
    operationId: string,
    version: string,
  ): Promise<OperationDefinition | undefined> {
    const rows = await this.engine.query<DefinitionRow>(
      'SELECT * FROM prov.prov_operations WHERE provider_id = $1 AND operation_id = $2 AND version = $3',
      [providerId, operationId, version],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : rowToDefinition(row);
  }

  /** All registered versions of an operation, oldest first. */
  async listVersions(providerId: string, operationId: string): Promise<string[]> {
    const rows = await this.engine.query<{ version: string; registered_at: Date | string }>(
      `SELECT version, registered_at FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2 ORDER BY registered_at ASC, version ASC`,
      [providerId, operationId],
    );
    return rows.rows.map((r) => r.version);
  }
}
