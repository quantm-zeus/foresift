import { costClass, quotaModel, ForesiftError, ErrorCode } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  OperationCostDeclarationSchema,
  type OperationCostDeclaration,
} from '@foresift/shared-schemas';

export interface ProviderOperationCostRow {
  provider_id: unknown;
  operation_id: unknown;
  cost_class: unknown;
  quota_model_id: unknown;
  estimated_quota_units: unknown;
  quota_reset_policy_id: unknown;
  batch_capability: unknown;
  minimum_candidate_stage: unknown;
  protected_reserve_eligible: unknown;
  allowed_in_strict_free: unknown;
  paid_fallback_allowed?: unknown;
  verification_expires_at?: unknown;
  version?: unknown;
}

function unknownCost(
  message: string,
  detail: Record<string, string | number | boolean | null> = {},
): never {
  throw new ForesiftError(ErrorCode.UNKNOWN_COST, message, detail);
}

function asTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : undefined;
}

function parseBatch(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      unknownCost('malformed batch capability');
    }
  }
  if (typeof value !== 'object') unknownCost('malformed batch capability');
  const raw = value as Record<string, unknown>;
  // Provider-lifecycle's older maxEntities declaration is accepted as the
  // same explicit bound, while all policy-bearing fields stay deny-closed.
  return {
    maxBatchSize: raw.maxBatchSize ?? raw.maxEntities,
    safeMaxUtilization: raw.safeMaxUtilization ?? 1,
    keyFields: raw.keyFields ?? [],
    ...(raw.coalescingWindowMs === undefined ? {} : { coalescingWindowMs: raw.coalescingWindowMs }),
    ...(raw.automaticUpgrade === undefined ? {} : { automaticUpgrade: raw.automaticUpgrade }),
    ...(raw.autoUpgrade === undefined ? {} : { autoUpgrade: raw.autoUpgrade }),
  };
}

export function operationCostDeclarationFromRow(
  row: ProviderOperationCostRow,
): OperationCostDeclaration {
  const requiredStrings = [
    row.provider_id,
    row.operation_id,
    row.cost_class,
    row.quota_model_id,
    row.quota_reset_policy_id,
    row.minimum_candidate_stage,
  ];
  if (requiredStrings.some((v) => typeof v !== 'string' || v.length === 0)) {
    unknownCost('operation has an incomplete cost declaration');
  }
  if (
    typeof row.protected_reserve_eligible !== 'boolean' ||
    typeof row.allowed_in_strict_free !== 'boolean'
  ) {
    unknownCost('operation has an incomplete cost declaration');
  }
  const units =
    typeof row.estimated_quota_units === 'number'
      ? row.estimated_quota_units
      : Number(row.estimated_quota_units);
  if (!Number.isFinite(units) || units < 0) unknownCost('invalid quota unit cost');
  let parsedCost: ReturnType<typeof costClass>;
  let parsedModel: ReturnType<typeof quotaModel>;
  try {
    parsedCost = costClass(row.cost_class as string);
    parsedModel = quotaModel(row.quota_model_id as string);
  } catch (error) {
    unknownCost(error instanceof Error ? error.message : 'unrecognized cost declaration enum');
  }
  const candidate = {
    providerId: row.provider_id as string,
    operationId: row.operation_id as string,
    ...(typeof row.version === 'string' ? { version: row.version } : {}),
    costClass: parsedCost,
    quotaModelId: parsedModel,
    quotaUnitCost: units,
    resetPolicyId: row.quota_reset_policy_id as string,
    batchCapability: parseBatch(row.batch_capability),
    minimumCandidateStage: row.minimum_candidate_stage as string,
    protectedReserveEligible: row.protected_reserve_eligible,
    allowedInStrictFree: row.allowed_in_strict_free,
    ...(typeof row.paid_fallback_allowed === 'boolean'
      ? { paidFallbackAllowed: row.paid_fallback_allowed }
      : {}),
    ...(asTimestamp(row.verification_expires_at) === undefined
      ? {}
      : { verificationExpiresAt: asTimestamp(row.verification_expires_at) }),
  };
  const parsed = OperationCostDeclarationSchema.safeParse(candidate);
  if (!parsed.success) unknownCost('operation has an invalid cost declaration');
  return parsed.data;
}

export class OperationCostDeclarationReader {
  constructor(private readonly engine: DatabaseEngine) {}

  async get(providerId: string, operationId: string): Promise<OperationCostDeclaration> {
    const result = await this.engine.query<ProviderOperationCostRow>(
      `SELECT provider_id, operation_id, version, cost_class, quota_model_id,
              estimated_quota_units, quota_reset_policy_id, batch_capability,
              minimum_candidate_stage, protected_reserve_eligible,
              allowed_in_strict_free, paid_fallback_allowed, verification_expires_at
         FROM prov.prov_operations
        WHERE provider_id = $1 AND operation_id = $2
          AND current_state IN ('VERIFIED','ACTIVE','DEGRADED')
        ORDER BY created_at DESC, version DESC LIMIT 1`,
      [providerId, operationId],
    );
    const row = result.rows[0];
    if (row === undefined)
      unknownCost('provider operation is not registered', { providerId, operationId });
    return operationCostDeclarationFromRow(row);
  }
}

export type { OperationCostDeclaration } from '@foresift/shared-schemas';

export function loadCostDeclaration(value: unknown): OperationCostDeclaration {
  if (value === null || typeof value !== 'object') unknownCost('operation declaration is absent');
  return operationCostDeclarationFromRow(value as ProviderOperationCostRow);
}

export function isCostDeclarationComplete(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return OperationCostDeclarationSchema.safeParse({
    providerId: raw.providerId,
    operationId: raw.operationId,
    ...(raw.version === undefined ? {} : { version: raw.version }),
    costClass: raw.costClass,
    quotaModelId: raw.quotaModelId,
    quotaUnitCost: raw.quotaUnitCost ?? raw.estimatedQuotaUnits,
    resetPolicyId: raw.resetPolicyId ?? raw.quotaResetPolicyId,
    batchCapability: raw.batchCapability,
    minimumCandidateStage: raw.minimumCandidateStage,
    protectedReserveEligible: raw.protectedReserveEligible,
    allowedInStrictFree: raw.allowedInStrictFree,
    ...(raw.verificationExpiresAt === undefined
      ? {}
      : { verificationExpiresAt: raw.verificationExpiresAt }),
  }).success;
}

export async function readOperationCostDeclaration(
  engine: DatabaseEngine,
  providerId: string,
  operationId: string,
): Promise<OperationCostDeclaration> {
  return new OperationCostDeclarationReader(engine).get(providerId, operationId);
}
