/**
 * Versioned provider-operation registry truth (FR-PROV-001, FR-PROV-004;
 * §15.3, T109). Definitions are IMMUTABLE PER VERSION: re-registering an
 * identical definition resolves to the SAME row (INV-009 retry fence), while
 * a conflicting re-registration refuses instead of mutating.
 *
 * Registration-time validation is double-enforced: this API layer refuses the
 * prohibited §15.2 capability classes outright BEFORE any SQL, and the SQL
 * CHECK constraint in g0_prov_0001 makes them unrepresentable even if this
 * layer were bypassed.
 */
import { z } from 'zod';
import type { DatabaseEngine } from '@foresift/persistence';
import { canonicalJson } from '@foresift/persistence';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import { UtcTimestampSchema } from '@foresift/shared-schemas';
import {
  ALLOWED_CAPABILITY_CLASSES,
  DependencyConsumerKindSchema,
  isProhibitedCapabilityClass,
  ProviderCostClassSchema,
  PROHIBITED_CAPABILITY_CLASSES,
  REQUIRED_NEGATIVE_CAPABILITIES,
} from './vocabulary.ts';
import { ProvErrorCode, RegistryError } from './errors.ts';

/** The §15.3 ProviderOperationDefinition, exactly as the requirement fixes it. */
export const OperationDefinitionSchema = z
  .object({
    providerId: z.string().min(1),
    operationId: z.string().min(1),
    version: z.string().min(1),
    capabilityClass: z.enum(ALLOWED_CAPABILITY_CLASSES),
    costClass: ProviderCostClassSchema,
    supportedChains: z.array(z.string().min(1)).min(1),
    supportedPrograms: z.array(z.string().min(1)),
    inputSchemaId: z.string().min(1),
    rawOutputSchemaId: z.string().min(1),
    normalizedOutputSchemaId: z.string().min(1),
    quotaModelId: z.string().min(1),
    cachePolicyId: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    retryPolicyId: z.string().min(1),
    declaredIndependenceGroup: z.string().min(1),
    upstreamLineage: z.array(z.string().min(1)),
    licensePolicyId: z.string().min(1),
    estimatedQuotaUnits: z.number().int().nonnegative(),
    quotaResetPolicyId: z.string().min(1),
    batchCapability: z.record(z.unknown()).nullable(),
    minimumCandidateStage: z.string().min(1).nullable(),
    protectedReserveEligible: z.boolean(),
    allowedInStrictFree: z.boolean(),
    paidFallbackAllowed: z.boolean(),
    deprecatedAt: UtcTimestampSchema.nullable(),
    sunsetAt: UtcTimestampSchema.nullable(),
    replacementOperationId: z.string().min(1).nullable(),
    /** NOT NULL in SQL: callers supply it honestly or the insert fails. */
    verificationExpiresAt: UtcTimestampSchema,
    forbiddenOutputFields: z.array(z.string().min(1)),
    /**
     * Negative-capability metadata: registration forces the full prohibited
     * alphabet onto EVERY registered operation (merge, below).
     */
    negativeCapabilities: z.array(z.string()),
  })
  .strict();
export type OperationDefinition = z.infer<typeof OperationDefinitionSchema>;

export interface RegisterProviderInput {
  readonly providerId: string;
  readonly displayName: string;
  readonly providerGroup: string;
  readonly disabledByDefault?: boolean;
}

export interface OperationTarget {
  readonly providerId: string;
  readonly operationId: string;
  readonly version: string;
}

export interface RegisterDependencyInput {
  readonly consumerKind: z.infer<typeof DependencyConsumerKindSchema>;
  readonly consumerKey: string;
  readonly target: OperationTarget;
}

export interface RegisteredOperation extends OperationDefinition {
  readonly currentState: string;
  readonly healthStatus: string;
}

interface OperationRow {
  provider_id: string;
  operation_id: string;
  version: string;
  capability_class: string;
  cost_class: string;
  supported_chains: string[];
  supported_programs: unknown;
  input_schema_id: string;
  raw_output_schema_id: string;
  normalized_output_schema_id: string;
  quota_model_id: string;
  cache_policy_id: string;
  timeout_ms: number;
  retry_policy_id: string;
  declared_independence_group: string;
  upstream_lineage: string[];
  license_policy_id: string;
  estimated_quota_units: number;
  quota_reset_policy_id: string;
  batch_capability: unknown;
  minimum_candidate_stage: string | null;
  protected_reserve_eligible: boolean;
  allowed_in_strict_free: boolean;
  paid_fallback_allowed: boolean;
  last_documentation_verification_at: Date | string | null;
  last_live_probe_at: Date | string | null;
  deprecated_at: Date | string | null;
  sunset_at: Date | string | null;
  replacement_operation_id: string | null;
  verification_expires_at: Date | string;
  forbidden_output_fields: string[];
  negative_capabilities: string[];
  current_state: string;
  health_status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToOperation(row: OperationRow): RegisteredOperation {
  return {
    providerId: row.provider_id,
    operationId: row.operation_id,
    version: row.version,
    capabilityClass: row.capability_class as OperationDefinition['capabilityClass'],
    costClass: ProviderCostClassSchema.parse(row.cost_class),
    supportedChains: [...row.supported_chains],
    supportedPrograms: Array.isArray(row.supported_programs)
      ? (row.supported_programs as string[])
      : [],
    inputSchemaId: row.input_schema_id,
    rawOutputSchemaId: row.raw_output_schema_id,
    normalizedOutputSchemaId: row.normalized_output_schema_id,
    quotaModelId: row.quota_model_id,
    cachePolicyId: row.cache_policy_id,
    timeoutMs: row.timeout_ms,
    retryPolicyId: row.retry_policy_id,
    declaredIndependenceGroup: row.declared_independence_group,
    upstreamLineage: [...row.upstream_lineage],
    licensePolicyId: row.license_policy_id,
    estimatedQuotaUnits: row.estimated_quota_units,
    quotaResetPolicyId: row.quota_reset_policy_id,
    batchCapability: (row.batch_capability ?? null) as OperationDefinition['batchCapability'],
    minimumCandidateStage: row.minimum_candidate_stage,
    protectedReserveEligible: row.protected_reserve_eligible,
    allowedInStrictFree: row.allowed_in_strict_free,
    paidFallbackAllowed: row.paid_fallback_allowed,
    deprecatedAt: toIso(row.deprecated_at),
    sunsetAt: toIso(row.sunset_at),
    replacementOperationId: row.replacement_operation_id,
    verificationExpiresAt: utcTimestamp(toIso(row.verification_expires_at) ?? ''),
    forbiddenOutputFields: [...row.forbidden_output_fields],
    negativeCapabilities: [...row.negative_capabilities],
    currentState: row.current_state,
    healthStatus: row.health_status,
  };
}

/**
 * Canonical §15.3 projection used for the immutable-version retry fence.
 * Timestamps normalize through their instant (a stored timestamptz reads back
 * as `…T00:00:00.000Z` while the caller sent `…T00:00:00Z` — same instant,
 * and the fence must treat them identically).
 */
function definitionFingerprint(definition: OperationDefinition): string {
  const normTs = (value: string | null): string | null =>
    value === null ? null : new Date(value).toISOString();
  // Control-plane projections appended by rowToOperation are not part of the
  // immutable §15.3 definition and must not influence the retry fence.
  const {
    currentState: _state,
    healthStatus: _health,
    ...semantic
  } = definition as OperationDefinition & Record<string, unknown>;
  return canonicalJson({
    ...semantic,
    deprecatedAt: normTs(definition.deprecatedAt),
    sunsetAt: normTs(definition.sunsetAt),
    verificationExpiresAt: normTs(definition.verificationExpiresAt),
  });
}

export interface RegistrationResult {
  readonly definition: OperationDefinition;
  /** False when a retry hit an identical already-registered version. */
  readonly created: boolean;
  readonly currentState: string;
  readonly healthStatus: string;
}

const INSERT_COLUMNS = `provider_id, operation_id, version,
         capability_class, cost_class, supported_chains, supported_programs,
         input_schema_id, raw_output_schema_id, normalized_output_schema_id,
         quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
         declared_independence_group, upstream_lineage, license_policy_id,
         estimated_quota_units, quota_reset_policy_id, batch_capability,
         minimum_candidate_stage, protected_reserve_eligible,
         allowed_in_strict_free, paid_fallback_allowed,
         deprecated_at, sunset_at, replacement_operation_id,
         verification_expires_at, forbidden_output_fields, negative_capabilities,
         current_state, health_status, created_at, updated_at`;

function insertArgs(definition: OperationDefinition, now: string): unknown[] {
  return [
    definition.providerId,
    definition.operationId,
    definition.version,
    definition.capabilityClass,
    definition.costClass,
    definition.supportedChains,
    JSON.stringify(definition.supportedPrograms),
    definition.inputSchemaId,
    definition.rawOutputSchemaId,
    definition.normalizedOutputSchemaId,
    definition.quotaModelId,
    definition.cachePolicyId,
    definition.timeoutMs,
    definition.retryPolicyId,
    definition.declaredIndependenceGroup,
    definition.upstreamLineage,
    definition.licensePolicyId,
    definition.estimatedQuotaUnits,
    definition.quotaResetPolicyId,
    definition.batchCapability === null ? null : JSON.stringify(definition.batchCapability),
    definition.minimumCandidateStage,
    definition.protectedReserveEligible,
    definition.allowedInStrictFree,
    definition.paidFallbackAllowed,
    definition.deprecatedAt,
    definition.sunsetAt,
    definition.replacementOperationId,
    definition.verificationExpiresAt,
    definition.forbiddenOutputFields,
    definition.negativeCapabilities,
    now,
  ];
}

export interface OperationRegistryOptions {
  /**
   * Optional §15.4 rule-1 gate consulted before any NEW dependency edge lands
   * (deprecation wiring supplies `DeprecationRules.assertDependencyRegistrationAllowed`
   * — a deprecated target blocks new dependencies unless an exception exists).
   */
  readonly dependencyGate?: (target: OperationTarget) => Promise<void>;
}

export class OperationRegistry {
  private readonly dependencyGate: ((target: OperationTarget) => Promise<void>) | undefined;

  constructor(
    private readonly engine: DatabaseEngine,
    private readonly clock: ClockPort,
    options?: OperationRegistryOptions,
  ) {
    this.dependencyGate = options?.dependencyGate;
  }

  /**
   * Registers a provider identity (disabled-by-default until explicitly
   * enabled elsewhere). Retries are idempotent.
   */
  async registerProvider(input: RegisterProviderInput): Promise<{ created: boolean }> {
    const inserted = await this.engine.query<{ provider_id: string }>(
      `INSERT INTO prov.prov_providers (provider_id, display_name, provider_group, disabled_by_default)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_id) DO NOTHING
       RETURNING provider_id`,
      [input.providerId, input.displayName, input.providerGroup, input.disabledByDefault ?? true],
    );
    return { created: inserted.rows.length === 1 };
  }

  /** Throws {@link ProvErrorCode.PROV_PROVIDER_UNKNOWN} when absent. */
  async assertProviderKnown(providerId: string): Promise<void> {
    const found = await this.engine.query<{ provider_id: string }>(
      'SELECT provider_id FROM prov.prov_providers WHERE provider_id = $1',
      [providerId],
    );
    if (found.rows.length === 0) {
      throw new RegistryError(
        `provider ${providerId} is not registered`,
        { providerId },
        ProvErrorCode.PROV_PROVIDER_UNKNOWN,
      );
    }
  }

  /**
   * Registers one immutable operation version. Refuses prohibited capability
   * classes outright; identical re-registration is an idempotent no-op;
   * conflicting re-registration refuses rather than mutating stored truth.
   * New versions always start DISCOVERED / HEALTHY.
   */
  async registerOperation(input: OperationDefinition): Promise<RegistrationResult> {
    const capability = String(input.capabilityClass);
    if (!ALLOWED_CAPABILITY_CLASSES.includes(capability as never)) {
      // Prohibited classes get their dedicated refusal; unknown classes the
      // generic one. Neither ever reaches SQL.
      if (isProhibitedCapabilityClass(capability)) {
        throw new RegistryError(
          `capability class ${capability} is prohibited (read-only product boundary) and cannot be registered`,
          { capabilityClass: capability },
          ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED,
        );
      }
      throw new RegistryError(
        `capability class ${capability} is not a known allowed class`,
        { capabilityClass: capability },
        ProvErrorCode.PROV_CAPABILITY_CLASS_UNKNOWN,
      );
    }

    // Negative capabilities are mandatory metadata: every registered
    // operation reports the full prohibited alphabet, nothing else.
    const negatives = Array.from(new Set([...input.negativeCapabilities])).filter(
      (value): value is (typeof PROHIBITED_CAPABILITY_CLASSES)[number] =>
        isProhibitedCapabilityClass(value),
    );
    const merged: OperationDefinition = {
      ...input,
      negativeCapabilities: Array.from(
        new Set([...negatives, ...REQUIRED_NEGATIVE_CAPABILITIES]),
      ).sort(),
    };
    const parsed = OperationDefinitionSchema.safeParse(merged);
    if (!parsed.success) {
      throw new RegistryError(
        `operation definition failed schema validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        {},
        ProvErrorCode.PROV_DEFINITION_SCHEMA_INVALID,
      );
    }
    const definition = parsed.data;

    await this.assertProviderKnown(definition.providerId);

    const existing = await this.engine.query<OperationRow>(
      `SELECT * FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
      [definition.providerId, definition.operationId, definition.version],
    );
    const prior = existing.rows[0];
    if (prior !== undefined) {
      if (definitionFingerprint(rowToOperation(prior)) !== definitionFingerprint(merged)) {
        throw new RegistryError(
          `operation ${definition.providerId}/${definition.operationId}@${definition.version} is already registered with a different definition; versions are immutable`,
          {
            providerId: definition.providerId,
            operationId: definition.operationId,
            version: definition.version,
          },
          ProvErrorCode.PROV_OPERATION_ALREADY_REGISTERED,
        );
      }
      return {
        definition: merged,
        created: false,
        currentState: prior.current_state,
        healthStatus: prior.health_status,
      };
    }

    await this.engine.query(
      `INSERT INTO prov.prov_operations (${INSERT_COLUMNS})
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
               'DISCOVERED','HEALTHY',$31,$31)`,
      insertArgs(merged, this.clock.now()),
    );
    return {
      definition: merged,
      created: true,
      currentState: 'DISCOVERED',
      healthStatus: 'HEALTHY',
    };
  }

  /** Throws {@link ProvErrorCode.PROV_OPERATION_UNKNOWN} when absent. */
  async getOperation(target: OperationTarget): Promise<RegisteredOperation> {
    const rows = await this.engine.query<OperationRow>(
      `SELECT * FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2 AND version = $3`,
      [target.providerId, target.operationId, target.version],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new RegistryError(
        `operation ${target.providerId}/${target.operationId}@${target.version} is not registered`,
        { ...target },
        ProvErrorCode.PROV_OPERATION_UNKNOWN,
      );
    }
    return rowToOperation(row);
  }

  async findOperations(filter?: {
    providerId?: string;
    currentState?: string;
  }): Promise<RegisteredOperation[]> {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (filter?.providerId !== undefined) {
      args.push(filter.providerId);
      clauses.push(`provider_id = $${args.length}`);
    }
    if (filter?.currentState !== undefined) {
      args.push(filter.currentState);
      clauses.push(`current_state = $${args.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await this.engine.query<OperationRow>(
      `SELECT * FROM prov.prov_operations ${where} ORDER BY provider_id, operation_id, version`,
      args,
    );
    return rows.rows.map(rowToOperation);
  }

  /**
   * Registers an affected-feature dependency edge (§15.4 "affected features"
   * are first-class registry rows so deprecation can name its blast radius).
   * Retries are idempotent via the UNIQUE fence: a replayed registration
   * resolves to the SAME dependency row.
   */
  async registerDependency(
    input: RegisterDependencyInput,
  ): Promise<{ dependencyId: string; created: boolean }> {
    const consumerKind = DependencyConsumerKindSchema.parse(input.consumerKind);
    // §15.4 rule 1: a deprecated target refuses NEW dependencies unless a
    // valid migration exception exists (gate supplied by deprecation wiring).
    if (this.dependencyGate !== undefined) {
      await this.dependencyGate(input.target);
    }
    const deterministicId = Buffer.from(
      `${consumerKind}|${input.consumerKey}|${input.target.providerId}|${input.target.operationId}|${input.target.version}`,
      'utf8',
    ).toString('base64url');

    const inserted = await this.engine.query<{ dependency_id: string }>(
      `INSERT INTO prov.prov_operation_dependencies (
         dependency_id, consumer_kind, consumer_key,
         provider_id, operation_id, operation_version, registered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (consumer_kind, consumer_key, provider_id, operation_id, operation_version)
       DO NOTHING
       RETURNING dependency_id`,
      [
        deterministicId,
        consumerKind,
        input.consumerKey,
        input.target.providerId,
        input.target.operationId,
        input.target.version,
        this.clock.now(),
      ],
    );
    // Replayed registration resolves to the SAME row (INV-009).
    return { dependencyId: deterministicId, created: inserted.rows.length === 1 };
  }

  /** Dependency edges pointing AT an operation (its blast radius). */
  async dependents(
    target: OperationTarget,
  ): Promise<
    { dependencyId: string; consumerKind: string; consumerKey: string; active: boolean }[]
  > {
    const rows = await this.engine.query<{
      dependency_id: string;
      consumer_kind: string;
      consumer_key: string;
      active: boolean;
    }>(
      `SELECT dependency_id, consumer_kind, consumer_key, active
       FROM prov.prov_operation_dependencies
       WHERE provider_id = $1 AND operation_id = $2 AND operation_version = $3
       ORDER BY dependency_id`,
      [target.providerId, target.operationId, target.version],
    );
    return rows.rows.map((r) => ({
      dependencyId: r.dependency_id,
      consumerKind: r.consumer_kind,
      consumerKey: r.consumer_key,
      active: r.active,
    }));
  }

  /** All active dependency edges across the registry (sole-source analysis). */
  async allActiveDependencies(): Promise<
    {
      dependencyId: string;
      consumerKind: string;
      consumerKey: string;
      providerId: string;
      operationId: string;
      operationVersion: string;
    }[]
  > {
    const rows = await this.engine.query<{
      dependency_id: string;
      consumer_kind: string;
      consumer_key: string;
      provider_id: string;
      operation_id: string;
      operation_version: string;
    }>(
      `SELECT dependency_id, consumer_kind, consumer_key,
              provider_id, operation_id, operation_version
       FROM prov.prov_operation_dependencies
       WHERE active = TRUE
       ORDER BY dependency_id`,
    );
    return rows.rows.map((r) => ({
      dependencyId: r.dependency_id,
      consumerKind: r.consumer_kind,
      consumerKey: r.consumer_key,
      providerId: r.provider_id,
      operationId: r.operation_id,
      operationVersion: r.operation_version,
    }));
  }

  /** Deactivates a dependency edge (soft state; the registry keeps history). */
  async setDependencyActive(dependencyId: string, active: boolean): Promise<void> {
    const updated = await this.engine.query<{ dependency_id: string }>(
      'UPDATE prov.prov_operation_dependencies SET active = $2 WHERE dependency_id = $1 RETURNING dependency_id',
      [dependencyId, active],
    );
    if (updated.rows.length === 0) {
      throw new RegistryError(
        `dependency ${dependencyId} is not registered`,
        { dependencyId },
        ProvErrorCode.PROV_DEPENDENCY_UNKNOWN,
      );
    }
  }
}
