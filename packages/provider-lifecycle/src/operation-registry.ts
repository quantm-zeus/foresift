/**
 * Versioned provider-operation definition storage (FR-PROV-001, FR-PROV-004;
 * §15.2/§15.3) over `prov.prov_operations`.
 *
 * Registration-time validation is the FIRST fail-closed gate of the product's
 * prohibited-capability boundary: a PROHIBITED_* capability class is refused
 * outright (typed `RegistryError`) before any row exists — mirroring the SQL
 * CHECK that makes the same values unrepresentable at the storage layer.
 * Unknown classes refuse too: only the nine READ_, STREAM_, and QUOTE_
 * classes are representable, in either layer.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import {
  ALLOWED_CAPABILITY_CLASSES,
  COST_CLASSES,
  CONSUMER_KINDS,
  PROHIBITED_CAPABILITY_CLASSES,
  isProhibitedCapabilityClass,
  type AllowedCapabilityClass,
  type ConsumerKind,
  type CostClass,
  type HealthStatus,
} from './vocabularies.ts';
import { RegistryError, ProvErrorCode } from './errors.ts';

/** Stable operation reference (primary key of the versioned registry). */
export interface OperationRef {
  readonly providerId: string;
  readonly operationId: string;
  readonly version: string;
}

/** Every §15.3 definition field (camelCase input form). */
export interface ProviderOperationDefinitionInput {
  readonly ref: OperationRef;
  readonly displayName: string;
  readonly capabilityClass: AllowedCapabilityClass;
  readonly costClass: CostClass;
  readonly supportedChains: readonly string[];
  readonly supportedPrograms?: ReadonlyArray<{ programId: string; versions: readonly string[] }>;
  readonly inputSchemaId: string;
  readonly rawOutputSchemaId: string;
  readonly normalizedOutputSchemaId: string;
  readonly quotaModelId: string;
  readonly cachePolicyId: string;
  readonly timeoutMs: number;
  readonly retryPolicyId: string;
  readonly declaredIndependenceGroup: string;
  readonly upstreamLineage: readonly string[];
  readonly licensePolicyId: string;
  readonly estimatedQuotaUnits: number;
  readonly quotaResetPolicyId: string;
  readonly batchCapability?: { readonly maxEntities: number; readonly maxBytes?: number };
  readonly minimumCandidateStage?: string;
  readonly protectedReserveEligible: boolean;
  readonly allowedInStrictFree: boolean;
  readonly paidFallbackAllowed: boolean;
  readonly deprecatedAt?: UtcTimestamp;
  readonly sunsetAt?: UtcTimestamp;
  readonly replacementOperationId?: string;
  /** Verification freshness horizon carried on the definition itself. */
  readonly verificationExpiresAt: UtcTimestamp;
  /** Output fields this adapter must never surface (e.g. transaction builders). */
  readonly forbiddenOutputFields: readonly string[];
  /**
   * Declared negative-capability metadata. Registration NORMALIZES this to
   * always cover the four PROHIBITED_* classes — every registered operation
   * carries complete negative metadata for the scan surfaces, whatever the
   * caller supplied.
   */
  readonly negativeCapabilities?: readonly string[];
}

export interface RegisteredOperation extends OperationRef {
  readonly capabilityClass: AllowedCapabilityClass;
  readonly costClass: CostClass;
  readonly currentState: import('./lifecycle-states.ts').LifecycleState;
  readonly healthStatus: HealthStatus;
  readonly allowedInStrictFree: boolean;
  readonly deprecatedAt: UtcTimestamp | null;
  readonly sunsetAt: UtcTimestamp | null;
  readonly replacementOperationId: string | null;
  readonly verificationExpiresAt: UtcTimestamp;
  readonly forbiddenOutputFields: readonly string[];
  readonly negativeCapabilities: readonly string[];
}

export interface DependencyRegistrationInput {
  readonly dependencyId: string;
  readonly consumerKind: ConsumerKind;
  readonly consumerKey: string;
  /** Critical field this dependency serves, when it is one (sole-source rule). */
  readonly criticalField?: string;
  readonly target: OperationRef;
  readonly active?: boolean;
  readonly registeredAt: UtcTimestamp;
}

interface OperationRow {
  provider_id: string;
  operation_id: string;
  version: string;
  capability_class: string;
  cost_class: string;
  current_state: string;
  health_status: string;
  allowed_in_strict_free: boolean;
  deprecated_at: Date | string | null;
  sunset_at: Date | string | null;
  replacement_operation_id: string | null;
  verification_expires_at: Date | string;
  forbidden_output_fields: unknown;
  negative_capabilities: unknown;
}

function normalizeInstant(value: Date | string | null): UtcTimestamp | null {
  if (value === null) return null;
  if (typeof value === 'string') return value as UtcTimestamp;
  return value.toISOString().replace('.000Z', 'Z') as UtcTimestamp;
}

function jsonArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

export function rowToOperation(row: OperationRow): RegisteredOperation {
  return {
    providerId: row.provider_id,
    operationId: row.operation_id,
    version: row.version,
    capabilityClass: row.capability_class as AllowedCapabilityClass,
    costClass: row.cost_class as CostClass,
    currentState: row.current_state as RegisteredOperation['currentState'],
    healthStatus: row.health_status as HealthStatus,
    allowedInStrictFree: row.allowed_in_strict_free,
    deprecatedAt: normalizeInstant(row.deprecated_at),
    sunsetAt: normalizeInstant(row.sunset_at),
    replacementOperationId: row.replacement_operation_id,
    verificationExpiresAt: normalizeInstant(row.verification_expires_at)!,
    forbiddenOutputFields: jsonArray(row.forbidden_output_fields),
    negativeCapabilities: jsonArray(row.negative_capabilities),
  };
}

export class OperationRegistry {
  private readonly engine: DatabaseEngine;

  constructor(engine: DatabaseEngine) {
    this.engine = engine;
  }

  async registerProvider(input: {
    readonly providerId: string;
    readonly displayName: string;
    readonly providerGroup: string;
    readonly disabledByDefault?: boolean;
  }): Promise<void> {
    await this.engine.query(
      `INSERT INTO prov.prov_providers (provider_id, display_name, provider_group, disabled_by_default)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_id) DO NOTHING`,
      [input.providerId, input.displayName, input.providerGroup, input.disabledByDefault ?? false],
    );
  }

  /**
   * Register one operation VERSION at lifecycle state DISCOVERED. Refuses
   * prohibited capability classes outright (FR-PROV-004), refuses unknown
   * classes, and normalizes negative-capability metadata to the complete
   * prohibited set so every registered operation scans clean.
   */
  async registerOperation(def: ProviderOperationDefinitionInput): Promise<RegisteredOperation> {
    if (isProhibitedCapabilityClass(def.capabilityClass)) {
      throw new RegistryError(
        `capability class ${def.capabilityClass} is prohibited and can never be registered`,
        { capabilityClass: def.capabilityClass },
        ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
      );
    }
    if (!(ALLOWED_CAPABILITY_CLASSES as readonly string[]).includes(def.capabilityClass)) {
      throw new RegistryError(
        `capability class ${String(def.capabilityClass)} is not part of the §15.2 vocabulary`,
        { capabilityClass: String(def.capabilityClass) },
        ProvErrorCode.PROV_CAPABILITY_CLASS_UNKNOWN,
      );
    }
    if (!(COST_CLASSES as readonly string[]).includes(def.costClass)) {
      throw new RegistryError(
        `cost class ${String(def.costClass)} is not part of the §15.2 vocabulary`,
        { costClass: String(def.costClass) },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }

    const provider = await this.engine.query<{ provider_id: string }>(
      'SELECT provider_id FROM prov.prov_providers WHERE provider_id = $1',
      [def.ref.providerId],
    );
    if (provider.rows.length === 0) {
      throw new RegistryError(
        `provider ${def.ref.providerId} is not registered`,
        { providerId: def.ref.providerId },
        ProvErrorCode.PROV_PROVIDER_UNKNOWN,
      );
    }

    if (def.deprecatedAt !== undefined && def.replacementOperationId === undefined) {
      throw new RegistryError(
        'a deprecated registration MUST name its replacement operation',
        { ref: JSON.stringify(def.ref) },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }
    if (def.timeoutMs <= 0 || def.estimatedQuotaUnits < 0) {
      throw new RegistryError(
        'timeout_ms must be positive and estimated_quota_units non-negative',
        { timeoutMs: def.timeoutMs, estimatedQuotaUnits: def.estimatedQuotaUnits },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }

    const negative = Array.from(
      new Set([...(def.negativeCapabilities ?? []), ...PROHIBITED_CAPABILITY_CLASSES]),
    );

    const inserted = await this.engine.query<OperationRow>(
      `INSERT INTO prov.prov_operations (
         provider_id, operation_id, version, capability_class, cost_class,
         current_state, health_status, supported_chains, supported_programs,
         input_schema_id, raw_output_schema_id, normalized_output_schema_id,
         quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
         declared_independence_group, upstream_lineage, license_policy_id,
         estimated_quota_units, quota_reset_policy_id, batch_max_entities,
         batch_max_bytes, minimum_candidate_stage, protected_reserve_eligible,
         allowed_in_strict_free, paid_fallback_allowed, deprecated_at, sunset_at,
         replacement_operation_id, verification_expires_at,
         forbidden_output_fields, negative_capabilities
       ) VALUES (
         $1, $2, $3, $4, $5, 'DISCOVERED', 'HEALTHY',
         $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14,
         $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23,
         $24, $25, $26, $27, $28, $29, $30::jsonb, $31::jsonb
       )
       RETURNING *`,
      [
        def.ref.providerId,
        def.ref.operationId,
        def.ref.version,
        def.capabilityClass,
        def.costClass,
        JSON.stringify([...def.supportedChains]),
        def.supportedPrograms === undefined
          ? null
          : JSON.stringify(
              def.supportedPrograms.map((p) => ({
                programId: p.programId,
                versions: [...p.versions],
              })),
            ),
        def.inputSchemaId,
        def.rawOutputSchemaId,
        def.normalizedOutputSchemaId,
        def.quotaModelId,
        def.cachePolicyId,
        def.timeoutMs,
        def.retryPolicyId,
        def.declaredIndependenceGroup,
        JSON.stringify([...def.upstreamLineage]),
        def.licensePolicyId,
        def.estimatedQuotaUnits,
        def.quotaResetPolicyId,
        def.batchCapability?.maxEntities ?? null,
        def.batchCapability?.maxBytes ?? null,
        def.minimumCandidateStage ?? null,
        def.protectedReserveEligible,
        def.allowedInStrictFree,
        def.paidFallbackAllowed,
        def.deprecatedAt ?? null,
        def.sunsetAt ?? null,
        def.replacementOperationId ?? null,
        def.verificationExpiresAt,
        JSON.stringify([...def.forbiddenOutputFields]),
        JSON.stringify(negative),
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new RegistryError('operation registration returned no row', {
        ref: JSON.stringify(def.ref),
      });
    }
    return rowToOperation(row);
  }

  async getOperation(ref: OperationRef): Promise<RegisteredOperation> {
    const found = await this.engine.query<OperationRow>(
      'SELECT * FROM prov.prov_operations WHERE provider_id = $1 AND operation_id = $2 AND version = $3',
      [ref.providerId, ref.operationId, ref.version],
    );
    const row = found.rows[0];
    if (row === undefined) {
      throw new RegistryError(
        `operation ${ref.providerId}/${ref.operationId}@${ref.version} is not registered`,
        { ref: JSON.stringify(ref) },
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
      );
    }
    return rowToOperation(row);
  }

  async findOperation(ref: OperationRef): Promise<RegisteredOperation | undefined> {
    try {
      return await this.getOperation(ref);
    } catch (error) {
      if (error instanceof RegistryError && error.code === ProvErrorCode.PROV_OPERATION_UNKNOWN) {
        return undefined;
      }
      throw error;
    }
  }

  async listOperationsByState(state: import('./lifecycle-states.ts').LifecycleState): Promise<
    readonly RegisteredOperation[]
  > {
    const rows = await this.engine.query<OperationRow>(
      'SELECT * FROM prov.prov_operations WHERE current_state = $1 ORDER BY provider_id, operation_id, version',
      [state],
    );
    return rows.rows.map(rowToOperation);
  }

  /** Register an affected-feature/consumer dependency on an operation. */
  async registerDependency(input: DependencyRegistrationInput): Promise<void> {
    if (!(CONSUMER_KINDS as readonly string[]).includes(input.consumerKind)) {
      throw new RegistryError(
        `consumer kind ${String(input.consumerKind)} is not part of the vocabulary`,
        { consumerKind: String(input.consumerKind) },
        ProvErrorCode.PROV_DEFINITION_INVALID,
      );
    }
    await this.getOperation(input.target);
    await this.engine.query(
      `INSERT INTO prov.prov_operation_dependencies (
         dependency_id, consumer_kind, consumer_key, critical_field,
         provider_id, operation_id, operation_version, active, registered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.dependencyId,
        input.consumerKind,
        input.consumerKey,
        input.criticalField ?? null,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        input.active ?? true,
        input.registeredAt,
      ],
    );
  }

  /** Active dependencies serving `criticalField` across ALL operations. */
  async listActiveDependenciesForCriticalField(
    criticalField: string,
  ): Promise<readonly { target: OperationRef; dependencyId: string }[]> {
    const rows = await this.engine.query<{
      dependency_id: string;
      provider_id: string;
      operation_id: string;
      operation_version: string;
    }>(
      `SELECT dependency_id, provider_id, operation_id, operation_version
       FROM prov.prov_operation_dependencies
       WHERE critical_field = $1 AND active = true`,
      [criticalField],
    );
    return rows.rows.map((r) => ({
      dependencyId: r.dependency_id,
      target: {
        providerId: r.provider_id,
        operationId: r.operation_id,
        version: r.operation_version,
      },
    }));
  }
}
