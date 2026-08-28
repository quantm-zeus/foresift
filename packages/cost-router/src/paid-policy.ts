/** Immutable paid data-provider policy lifecycle (FR-COST-008/010). */
import { createHash } from 'node:crypto';
import { ErrorCode, ForesiftError, utcTimestamp, type ClockPort } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { canonicalJson } from '@foresift/persistence';
import { PaidProviderPolicySchema, type PaidProviderPolicy } from '@foresift/shared-schemas';

export interface PaidPolicyCreateInput {
  readonly providerId: string;
  readonly budgetUnits: number;
  readonly approvedBy: string;
  readonly reAuthDueAt: string;
}

const systemClock: ClockPort = {
  now: () => utcTimestamp(new Date().toISOString()),
  nowEpochMs: () => Date.now(),
};

export interface ActivePaidPolicySource {
  activePolicy(providerId: string, at?: string): Promise<PaidProviderPolicy | null>;
}

interface PolicyRow {
  policy_id: string;
  provider_id: string;
  budget_units: string | number;
  approved_by: string;
  approved_at: Date | string;
  activated_at: Date | string | null;
  re_auth_due_at: Date | string;
  active: boolean;
  superseded_by: string | null;
}

const iso = (value: Date | string): string =>
  typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();

function fromRow(row: PolicyRow): PaidProviderPolicy {
  return PaidProviderPolicySchema.parse({
    policyId: row.policy_id,
    providerId: row.provider_id,
    budgetUnits: Number(row.budget_units),
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    activatedAt: row.activated_at === null ? null : iso(row.activated_at),
    reAuthDueAt: iso(row.re_auth_due_at),
    active: row.active,
    supersededBy: row.superseded_by,
  });
}

function inadmissible(
  message: string,
  detail: Record<string, string | number | boolean | null> = {},
): never {
  throw new ForesiftError(ErrorCode.COST_POLICY_INADMISSIBLE, message, detail);
}

export class PaidPolicyStore implements ActivePaidPolicySource {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly clock: ClockPort = systemClock,
  ) {}

  private now(): string {
    return this.clock.now();
  }

  private policyId(input: PaidPolicyCreateInput, approvedAt: string): string {
    const body = canonicalJson({
      providerId: input.providerId,
      budgetUnits: input.budgetUnits,
      approvedBy: input.approvedBy,
      approvedAt,
      reAuthDueAt: new Date(input.reAuthDueAt).toISOString(),
    });
    return `sha256:${createHash('sha256').update(body).digest('hex')}`;
  }

  async create(input: PaidPolicyCreateInput): Promise<PaidProviderPolicy> {
    if (!Number.isFinite(input.budgetUnits) || input.budgetUnits <= 0) {
      inadmissible('paid policy requires a positive explicit budget');
    }
    if (input.providerId.length === 0 || input.approvedBy.length === 0) {
      inadmissible('paid policy requires provider and approver');
    }
    const approvedAt = this.now();
    const due = new Date(input.reAuthDueAt);
    if (!Number.isFinite(due.getTime()) || due.getTime() <= new Date(approvedAt).getTime()) {
      inadmissible('paid policy initial re-authentication expiry must be in the future');
    }
    const policyId = this.policyId(input, approvedAt);
    const result = await this.engine.query<PolicyRow>(
      `INSERT INTO cost.paid_provider_policies
         (policy_id, provider_id, budget_units, approved_by, approved_at,
          activated_at, re_auth_due_at, active, superseded_by)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,FALSE,NULL)
       ON CONFLICT (policy_id) DO NOTHING
       RETURNING *`,
      [
        policyId,
        input.providerId,
        String(input.budgetUnits),
        input.approvedBy,
        approvedAt,
        due.toISOString(),
      ],
    );
    if (result.rows[0] !== undefined) return fromRow(result.rows[0]);
    const existing = await this.get(policyId);
    if (existing === null) inadmissible('paid policy insert did not converge', { policyId });
    return existing;
  }

  async get(policyId: string): Promise<PaidProviderPolicy | null> {
    const result = await this.engine.query<PolicyRow>(
      `SELECT * FROM cost.paid_provider_policies WHERE policy_id = $1`,
      [policyId],
    );
    return result.rows[0] === undefined ? null : fromRow(result.rows[0]);
  }

  async activate(policyId: string, approver: string): Promise<PaidProviderPolicy> {
    return this.engine.transaction(async (tx) => {
      const result = await tx.query<PolicyRow>(
        `UPDATE cost.paid_provider_policies
            SET active = TRUE, activated_at = $3
          WHERE policy_id = $1 AND approved_by = $2 AND active = FALSE
            AND superseded_by IS NULL AND re_auth_due_at > $3
          RETURNING *`,
        [policyId, approver, this.now()],
      );
      if (result.rows[0] === undefined) {
        inadmissible(
          'paid policy activation requires matching approver, unexpired approval, and no active peer',
          { policyId },
        );
      }
      return fromRow(result.rows[0]);
    });
  }

  /** Re-authentication creates and activates an immutable successor policy. */
  async reAuthenticate(
    policyId: string,
    approver: string,
    reAuthDueAt?: string,
  ): Promise<PaidProviderPolicy> {
    const old = await this.get(policyId);
    if (old === null || !old.active)
      inadmissible('only an active policy can be re-authenticated', { policyId });
    const previousTtl = new Date(old.reAuthDueAt).getTime() - new Date(old.approvedAt).getTime();
    const successorApprovedAt = new Date(
      Math.max(new Date(this.now()).getTime(), new Date(old.approvedAt).getTime() + 1),
    ).toISOString();
    const due =
      reAuthDueAt ??
      new Date(new Date(successorApprovedAt).getTime() + Math.max(previousTtl, 1)).toISOString();
    return this.engine.transaction(async (tx) => {
      const successorClock: ClockPort = {
        now: () => utcTimestamp(successorApprovedAt),
        nowEpochMs: () => new Date(successorApprovedAt).getTime(),
      };
      const successor = new PaidPolicyStore(tx, successorClock);
      const created = await successor.create({
        providerId: old.providerId,
        budgetUnits: old.budgetUnits,
        approvedBy: approver,
        reAuthDueAt: due,
      });
      await tx.query(
        `UPDATE cost.paid_provider_policies
            SET active = FALSE, superseded_by = $2
          WHERE policy_id = $1 AND active = TRUE AND superseded_by IS NULL`,
        [policyId, created.policyId],
      );
      return successor.activate(created.policyId, approver);
    });
  }

  async activePolicy(providerId: string, at = this.now()): Promise<PaidProviderPolicy | null> {
    const result = await this.engine.query<PolicyRow>(
      `SELECT * FROM cost.paid_provider_policies
        WHERE provider_id = $1 AND active = TRUE AND superseded_by IS NULL
          AND activated_at IS NOT NULL AND re_auth_due_at > $2
        ORDER BY activated_at DESC`,
      [providerId, at],
    );
    if (result.rows.length > 1)
      inadmissible('multiple active paid policies violate provider uniqueness', { providerId });
    return result.rows[0] === undefined ? null : fromRow(result.rows[0]);
  }

  /** There is deliberately no budget/approver update API. BYOK is never queried here. */
  async assertAdmissible(
    providerId: string,
    units: number,
    at = this.now(),
  ): Promise<PaidProviderPolicy> {
    const policy = await this.activePolicy(providerId, at);
    if (policy === null || units > policy.budgetUnits) {
      inadmissible('paid call lacks an active unexpired policy budget', { providerId, units });
    }
    return policy;
  }
}

export { PaidPolicyStore as PaidPolicyService };
