import { ForesiftError, ErrorCode } from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';

export interface CreatePaidPolicyInput {
  readonly policyId?: string;
  readonly providerId: string;
  readonly budgetUnits: number;
  readonly budgetCurrencyOrModel?: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly reAuthDueAt: string;
}
export interface PaidPolicyRecord extends CreatePaidPolicyInput {
  readonly policyId: string;
  readonly activatedAt: string | null;
  readonly active: boolean;
  readonly supersededBy: string | null;
}
interface PaidPolicyRow {
  policy_id: string;
  provider_id: string;
  budget_units: string | number;
  budget_currency_or_model: string | null;
  approved_by: string;
  approved_at: string | Date;
  activated_at: string | Date | null;
  re_auth_due_at: string | Date;
  active: boolean;
  superseded_by: string | null;
}
const iso = (value: string | Date): string => (value instanceof Date ? value.toISOString() : value);
const invalid = (message: string): never => {
  throw new ForesiftError(ErrorCode.PAID_POLICY_INVALID, message);
};
function rowRecord(row: PaidPolicyRow): PaidPolicyRecord {
  return {
    policyId: row.policy_id,
    providerId: row.provider_id,
    budgetUnits: Number(row.budget_units),
    ...(row.budget_currency_or_model === null
      ? {}
      : { budgetCurrencyOrModel: row.budget_currency_or_model }),
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    reAuthDueAt: iso(row.re_auth_due_at),
    activatedAt: row.activated_at === null ? null : iso(row.activated_at),
    active: row.active,
    supersededBy: row.superseded_by,
  };
}

export class PaidPolicyRepository {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreatePaidPolicyInput): Promise<PaidPolicyRecord> {
    if (!Number.isFinite(input.budgetUnits) || input.budgetUnits <= 0)
      invalid('explicit positive budget is required');
    if (!input.approvedBy || !(Date.parse(input.reAuthDueAt) > Date.parse(input.approvedAt))) {
      invalid('approver and initial expiry are required');
    }
    const identity = {
      providerId: input.providerId,
      budgetUnits: input.budgetUnits,
      budgetCurrencyOrModel: input.budgetCurrencyOrModel ?? null,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      reAuthDueAt: input.reAuthDueAt,
    };
    const policyId = input.policyId ?? sha256Text(canonicalJson(identity));
    if (!/^sha256:[0-9a-f]{64}$/.test(policyId)) invalid('policyId must be a sha256 content hash');
    const inserted = await this.engine.query<PaidPolicyRow>(
      `INSERT INTO cost.paid_provider_policies
        (policy_id,provider_id,budget_units,budget_currency_or_model,approved_by,approved_at,
         re_auth_due_at,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)
       RETURNING *`,
      [
        policyId,
        input.providerId,
        String(input.budgetUnits),
        input.budgetCurrencyOrModel ?? null,
        input.approvedBy,
        input.approvedAt,
        input.reAuthDueAt,
      ],
    );
    return rowRecord(inserted.rows[0]!);
  }

  async activate(
    policyId: string,
    approver: string,
    activatedAt = this.now().toISOString(),
  ): Promise<PaidPolicyRecord> {
    return this.engine.transaction(async (tx) => {
      const found = await tx.query<PaidPolicyRow>(
        'SELECT * FROM cost.paid_provider_policies WHERE policy_id=$1 FOR UPDATE',
        [policyId],
      );
      const policy = found.rows[0];
      if (policy === undefined) return invalid('activation policy does not exist');
      if (policy.approved_by !== approver)
        return invalid('activation approver does not match policy approval');
      if (!(Date.parse(iso(policy.re_auth_due_at)) > Date.parse(activatedAt)))
        invalid('policy re-authentication is already due');
      await tx.query(
        `UPDATE cost.paid_provider_policies
            SET active=FALSE, superseded_by=$1
          WHERE provider_id=$2 AND active=TRUE AND policy_id<>$1`,
        [policyId, policy.provider_id],
      );
      const updated = await tx.query<PaidPolicyRow>(
        `UPDATE cost.paid_provider_policies SET active=TRUE, activated_at=$2
          WHERE policy_id=$1 AND active=FALSE RETURNING *`,
        [policyId, activatedAt],
      );
      const activated = updated.rows[0];
      if (activated === undefined) return invalid('policy is already active or unavailable');
      return rowRecord(activated);
    });
  }

  async reAuthenticate(
    policyId: string,
    approver: string,
    reAuthDueAt?: string,
  ): Promise<PaidPolicyRecord> {
    const found = await this.engine.query<PaidPolicyRow>(
      'SELECT * FROM cost.paid_provider_policies WHERE policy_id=$1',
      [policyId],
    );
    const policy = found.rows[0];
    if (policy === undefined) return invalid('re-authentication policy does not exist');
    if (policy.approved_by !== approver || policy.activated_at === null) {
      return invalid('re-authentication requires the original approver and an activated policy');
    }
    const due = reAuthDueAt ?? new Date(this.now().getTime() + 86_400_000).toISOString();
    if (!(Date.parse(due) > this.now().getTime()))
      invalid('re-authentication expiry must be in the future');
    const updated = await this.engine.query<PaidPolicyRow>(
      `UPDATE cost.paid_provider_policies SET re_auth_due_at=$2
        WHERE policy_id=$1 RETURNING *`,
      [policyId, due],
    );
    return rowRecord(updated.rows[0]!);
  }

  async activeForProvider(
    providerId: string,
    at = this.now().toISOString(),
  ): Promise<PaidPolicyRecord | null> {
    const found = await this.engine.query<PaidPolicyRow>(
      `SELECT * FROM cost.paid_provider_policies
        WHERE provider_id=$1 AND active=TRUE AND activated_at <= $2 AND re_auth_due_at > $2
        LIMIT 1`,
      [providerId, at],
    );
    return found.rows[0] === undefined ? null : rowRecord(found.rows[0]);
  }
}

export { PaidPolicyRepository as PaidPolicyStore };
