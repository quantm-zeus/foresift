/** Fail-closed read projection over prov.prov_operations (FR-COST-001). */
import {
  CostClass,
  ErrorCode,
  ForesiftError,
  costClass,
  quotaModel,
  type QuotaModel,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { CostBatchCapabilitySchema, type OperationCostDeclaration } from '@foresift/shared-schemas';

const REQUIRED_COST_FIELDS = [
  'costClass',
  'quotaUnitCost',
  'resetPolicyId',
  'batchCapability',
  'minimumCandidateStage',
  'protectedReserveEligible',
  'allowedInStrictFree',
] as const;

export type CostDeclaration = OperationCostDeclaration & { readonly quotaModel: QuotaModel };

function unknown(
  message: string,
  detail: Record<string, string | number | boolean | null> = {},
): never {
  throw new ForesiftError(ErrorCode.UNKNOWN_COST, message, detail);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeBatch(value: unknown): CostDeclaration['batchCapability'] {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null) unknown('batch capability is malformed');
  const record = value as Record<string, unknown>;
  const normalized = {
    maxBatchSize: record.maxBatchSize ?? record.maxEntities,
    safeMaxUtilization: record.safeMaxUtilization ?? 1,
    keyFields: record.keyFields ?? ['providerId', 'operationId'],
    coalescingWindowMs: record.coalescingWindowMs ?? 0,
  };
  const parsed = CostBatchCapabilitySchema.safeParse(normalized);
  if (!parsed.success) unknown('batch capability is unrecognized');
  return parsed.data;
}

/** Project a camel-case operation registry record, refusing every absent gap. */
export function projectCostDeclaration(input: unknown): CostDeclaration {
  if (typeof input !== 'object' || input === null) unknown('operation declaration is absent');
  const row = input as Record<string, unknown>;
  for (const field of REQUIRED_COST_FIELDS) {
    if (!hasOwn(row, field) || row[field] === undefined)
      unknown(`required cost field ${field} is absent`);
  }
  if (typeof row.providerId !== 'string' || row.providerId.length === 0)
    unknown('providerId is absent');
  if (typeof row.operationId !== 'string' || row.operationId.length === 0)
    unknown('operationId is absent');
  if (typeof row.version !== 'string' || row.version.length === 0) unknown('version is absent');
  if (
    typeof row.quotaUnitCost !== 'number' ||
    !Number.isFinite(row.quotaUnitCost) ||
    row.quotaUnitCost < 0
  ) {
    unknown('quotaUnitCost is invalid');
  }
  if (typeof row.resetPolicyId !== 'string' || row.resetPolicyId.length === 0)
    unknown('resetPolicyId is invalid');
  if (typeof row.minimumCandidateStage !== 'string' || row.minimumCandidateStage.length === 0) {
    unknown('minimumCandidateStage is invalid');
  }
  if (
    typeof row.protectedReserveEligible !== 'boolean' ||
    typeof row.allowedInStrictFree !== 'boolean'
  ) {
    unknown('reserve eligibility or STRICT_FREE permission is invalid');
  }
  const parsedCostClass = costClass(row.costClass);
  const rawQuotaModel = row.quotaModel;
  const parsedQuotaModel =
    rawQuotaModel === undefined
      ? quotaModel('UNKNOWN_CONFIGURABLE')
      : quotaModel(String(rawQuotaModel));
  const quotaModelId = row.quotaModelId;
  if (typeof quotaModelId !== 'string' || quotaModelId.length === 0)
    unknown('quotaModelId is absent');
  const expiresAt = row.verificationExpiresAt;
  if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) {
    unknown('verificationExpiresAt is absent or invalid');
  }
  return {
    providerId: row.providerId,
    operationId: row.operationId,
    version: row.version,
    costClass: parsedCostClass,
    quotaModelId,
    quotaModel: parsedQuotaModel,
    quotaUnitCost: row.quotaUnitCost,
    resetPolicyId: row.resetPolicyId,
    batchCapability: normalizeBatch(row.batchCapability),
    minimumCandidateStage: row.minimumCandidateStage,
    protectedReserveEligible: row.protectedReserveEligible,
    allowedInStrictFree: row.allowedInStrictFree,
    paidFallbackAllowed: row.paidFallbackAllowed === true,
    verificationExpiresAt: new Date(expiresAt).toISOString(),
  };
}

interface OperationCostRow {
  provider_id: string;
  operation_id: string;
  version: string;
  cost_class: string;
  quota_model_id: string;
  estimated_quota_units: number | string;
  quota_reset_policy_id: string;
  batch_capability: unknown;
  minimum_candidate_stage: string | null;
  protected_reserve_eligible: boolean;
  allowed_in_strict_free: boolean;
  paid_fallback_allowed: boolean;
  verification_expires_at: string;
}

export interface CostDeclarationSource {
  get(providerId: string, operationId: string): Promise<CostDeclaration>;
}

export class ProviderOperationCostDeclarationSource implements CostDeclarationSource {
  constructor(private readonly engine: DatabaseEngine) {}

  async get(providerId: string, operationId: string): Promise<CostDeclaration> {
    const result = await this.engine.query<OperationCostRow>(
      `SELECT provider_id, operation_id, version, cost_class, quota_model_id,
              estimated_quota_units, quota_reset_policy_id, batch_capability,
              minimum_candidate_stage, protected_reserve_eligible,
              allowed_in_strict_free, paid_fallback_allowed,
              verification_expires_at
       FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2
         AND current_state NOT IN ('BLOCKED','REMOVED')
       ORDER BY created_at DESC, version DESC LIMIT 1`,
      [providerId, operationId],
    );
    const row = result.rows[0];
    if (row === undefined)
      unknown('provider operation is not registered', { providerId, operationId });
    return projectCostDeclaration({
      providerId: row.provider_id,
      operationId: row.operation_id,
      version: row.version,
      costClass: row.cost_class,
      quotaModelId: row.quota_model_id,
      quotaUnitCost: Number(row.estimated_quota_units),
      resetPolicyId: row.quota_reset_policy_id,
      batchCapability: row.batch_capability,
      minimumCandidateStage: row.minimum_candidate_stage,
      protectedReserveEligible: row.protected_reserve_eligible,
      allowedInStrictFree: row.allowed_in_strict_free,
      paidFallbackAllowed: row.paid_fallback_allowed,
      verificationExpiresAt: row.verification_expires_at,
    });
  }
}

export { ProviderOperationCostDeclarationSource as CostDeclarationReader };

/** Convenient declaration for a known free, unmetered local operation. */
export function freeUnmeteredDeclaration(input: {
  providerId: string;
  operationId: string;
  version: string;
  quotaModel: QuotaModel;
  verificationExpiresAt: string;
}): CostDeclaration {
  return projectCostDeclaration({
    ...input,
    quotaModelId: input.quotaModel,
    costClass: CostClass.FREE_UNMETERED,
    quotaUnitCost: 0,
    resetPolicyId: 'never',
    batchCapability: null,
    minimumCandidateStage: 'DISCOVERED',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
  });
}
