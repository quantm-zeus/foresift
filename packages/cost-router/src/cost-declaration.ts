/** Fail-closed read view over the provider operation registry (FR-COST-001). */
import {
  ErrorCode,
  ForesiftError,
  costClass,
  quotaModel,
  type CostClass,
  type QuotaModel,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  CostBatchCapabilitySchema,
  OperationCostDeclarationSchema,
  type CostBatchCapability,
  type OperationCostDeclaration,
} from '@foresift/shared-schemas';

export type { CostBatchCapability, OperationCostDeclaration };

export interface CostDeclarationSource {
  declaration(provider: string, operation: string): Promise<OperationCostDeclaration>;
}

function unknownCost(
  message: string,
  detail: Record<string, string | number | boolean | null> = {},
): never {
  throw new ForesiftError(ErrorCode.COST_DECLARATION_UNKNOWN, `UNKNOWN_COST: ${message}`, detail);
}

function required(row: Record<string, unknown>, field: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(row, field) || row[field] === undefined) {
    unknownCost(`provider operation is missing ${field}`, { field });
  }
  return row[field];
}

/** Parse the exact seven cost declaration fields; null is valid only where declared. */
export function parseCostDeclaration(row: Record<string, unknown>): OperationCostDeclaration {
  try {
    const providerId = required(row, 'providerId');
    const operationId = required(row, 'operationId');
    const version = required(row, 'version');
    const parsedCostClass: CostClass = costClass(required(row, 'costClass'));
    const rawQuotaModel = required(row, 'quotaModel');
    const parsedQuotaModel: QuotaModel = quotaModel(
      typeof rawQuotaModel === 'string' ? rawQuotaModel : '',
    );
    const quotaUnitCost = required(row, 'quotaUnitCost');
    const resetPolicyId = required(row, 'resetPolicyId');
    const rawBatch = required(row, 'batchCapability');
    const minimumCandidateStage = required(row, 'minimumCandidateStage');
    const protectedReserveEligible = required(row, 'protectedReserveEligible');
    const allowedInStrictFree = required(row, 'allowedInStrictFree');
    const paidFallbackAllowed = Object.prototype.hasOwnProperty.call(row, 'paidFallbackAllowed')
      ? row.paidFallbackAllowed
      : false;
    const batchCapability: CostBatchCapability | null =
      rawBatch === null ? null : CostBatchCapabilitySchema.parse(rawBatch);

    return OperationCostDeclarationSchema.parse({
      providerId,
      operationId,
      version,
      costClass: parsedCostClass,
      quotaModel: parsedQuotaModel,
      quotaUnitCost,
      resetPolicyId,
      batchCapability,
      minimumCandidateStage,
      protectedReserveEligible,
      allowedInStrictFree,
      paidFallbackAllowed,
      ...(row.verificationExpiresAt === undefined
        ? {}
        : { verificationExpiresAt: row.verificationExpiresAt }),
    });
  } catch (error) {
    if (error instanceof ForesiftError && error.code === ErrorCode.COST_DECLARATION_UNKNOWN) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    unknownCost(`invalid provider cost declaration: ${message}`);
  }
}

interface CostRow {
  provider_id: string;
  operation_id: string;
  version: string;
  cost_class: string;
  quota_model_id: string;
  estimated_quota_units: string | number;
  quota_reset_policy_id: string;
  batch_capability: unknown;
  minimum_candidate_stage: string | null;
  protected_reserve_eligible: boolean;
  allowed_in_strict_free: boolean;
  paid_fallback_allowed: boolean;
  verification_expires_at: Date | string;
}

/** Current ACTIVE provider-operation projection. Multiple active versions refuse. */
export class SqlCostDeclarationSource implements CostDeclarationSource {
  constructor(private readonly engine: DatabaseEngine) {}

  async declaration(provider: string, operation: string): Promise<OperationCostDeclaration> {
    const result = await this.engine.query<CostRow>(
      `SELECT provider_id, operation_id, version, cost_class, quota_model_id,
              estimated_quota_units, quota_reset_policy_id, batch_capability,
              minimum_candidate_stage, protected_reserve_eligible,
              allowed_in_strict_free, paid_fallback_allowed, verification_expires_at
         FROM prov.prov_operations
        WHERE provider_id = $1 AND operation_id = $2 AND current_state = 'ACTIVE'
        ORDER BY version DESC`,
      [provider, operation],
    );
    if (result.rows.length !== 1) {
      unknownCost(
        result.rows.length === 0
          ? 'operation declaration not found or inactive'
          : 'ambiguous active operation versions',
        {
          provider,
          operation,
        },
      );
    }
    const row = result.rows[0]!;
    return parseCostDeclaration({
      providerId: row.provider_id,
      operationId: row.operation_id,
      version: row.version,
      costClass: row.cost_class,
      quotaModel: row.quota_model_id,
      quotaUnitCost: Number(row.estimated_quota_units),
      resetPolicyId: row.quota_reset_policy_id,
      batchCapability: row.batch_capability,
      minimumCandidateStage: row.minimum_candidate_stage,
      protectedReserveEligible: row.protected_reserve_eligible,
      allowedInStrictFree: row.allowed_in_strict_free,
      paidFallbackAllowed: row.paid_fallback_allowed,
      verificationExpiresAt:
        typeof row.verification_expires_at === 'string'
          ? new Date(row.verification_expires_at).toISOString()
          : row.verification_expires_at.toISOString(),
    });
  }
}

/** Convenient immutable source for composition tests and non-SQL registries. */
export class InMemoryCostDeclarationSource implements CostDeclarationSource {
  private readonly declarations = new Map<string, OperationCostDeclaration>();
  constructor(values: readonly OperationCostDeclaration[]) {
    for (const value of values) {
      const parsed = OperationCostDeclarationSchema.parse(value);
      this.declarations.set(`${parsed.providerId}\u0000${parsed.operationId}`, parsed);
    }
  }
  async declaration(provider: string, operation: string): Promise<OperationCostDeclaration> {
    const value = this.declarations.get(`${provider}\u0000${operation}`);
    if (value === undefined)
      unknownCost('operation declaration not found', { provider, operation });
    return value;
  }
}

export { SqlCostDeclarationSource as CostDeclarationReader };
