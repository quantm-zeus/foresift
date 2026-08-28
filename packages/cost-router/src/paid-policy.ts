/** Immutable explicit paid-provider policy lifecycle (FR-COST-008/010). */
import { createHash } from 'node:crypto';
import { ErrorCode, ForesiftError } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import type { PaidProviderPolicy } from '@foresift/shared-schemas';

const REAUTH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface CreatePaidPolicyInput {
  readonly providerId: string;
  readonly budgetUnits: number;
  readonly approvedBy: string;
  readonly approvedAt?: string;
  readonly reAuthDueAt: string;
}

interface PaidPolicyRow {
  policy_id: string;
  provider_id: string;
  budget_units: string | number;
  approved_by: string;
  approved_at: string;
  activated_at: string | null;
  re_auth_due_at: string;
  active: boolean;
  superseded_by: string | null;
}

function invalid(
  message: string,
  detail: Record<string, string | number | boolean | null> = {},
): never {
  throw new ForesiftError(ErrorCode.PAID_POLICY_INVALID, message, detail);
}

function iso(value: string, field: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) invalid(`${field} must be a UTC timestamp`);
  return new Date(time).toISOString();
}

function policyIdOf(input: Required<CreatePaidPolicyInput>): string {
  const canonical = JSON.stringify([
    input.providerId,
    input.budgetUnits,
    input.approvedBy,
    input.approvedAt,
    input.reAuthDueAt,
  ]);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function fromRow(row: PaidPolicyRow): PaidProviderPolicy {
  return {
    policyId: row.policy_id,
    providerId: row.provider_id,
    budgetUnits: Number(row.budget_units),
    approvedBy: row.approved_by,
    approvedAt: new Date(row.approved_at).toISOString(),
    activatedAt: row.activated_at === null ? null : new Date(row.activated_at).toISOString(),
    reAuthDueAt: new Date(row.re_auth_due_at).toISOString(),
    active: row.active,
    supersededBy: row.superseded_by,
  };
}

export interface ActivePaidPolicySource {
  activeFor(providerId: string, at?: string): Promise<PaidProviderPolicy | undefined>;
}

export class PaidProviderPolicyStore implements ActivePaidPolicySource {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: CreatePaidPolicyInput): Promise<PaidProviderPolicy> {
    if (input.providerId.length === 0 || input.approvedBy.length === 0)
      invalid('provider and approver are required');
    if (!Number.isFinite(input.budgetUnits) || input.budgetUnits <= 0)
      invalid('an explicit positive budget is required');
    const approvedAt = iso(input.approvedAt ?? this.now().toISOString(), 'approvedAt');
    const reAuthDueAt = iso(input.reAuthDueAt, 'reAuthDueAt');
    if (reAuthDueAt <= approvedAt) invalid('initial re-authentication expiry must follow approval');
    const complete: Required<CreatePaidPolicyInput> = { ...input, approvedAt, reAuthDueAt };
    const policyId = policyIdOf(complete);
    const rows = await this.engine.query<PaidPolicyRow>(
      `INSERT INTO cost.paid_provider_policies
         (policy_id, provider_id, budget_units, approved_by, approved_at,
          re_auth_due_at, active)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE)
       ON CONFLICT (policy_id) DO NOTHING
       RETURNING *`,
      [
        policyId,
        input.providerId,
        String(input.budgetUnits),
        input.approvedBy,
        approvedAt,
        reAuthDueAt,
      ],
    );
    const inserted = rows.rows[0];
    if (inserted !== undefined) return fromRow(inserted);
    const existing = await this.get(policyId);
    if (existing === undefined) invalid('policy create did not persist', { policyId });
    return existing;
  }

  async get(policyId: string): Promise<PaidProviderPolicy | undefined> {
    const rows = await this.engine.query<PaidPolicyRow>(
      `SELECT * FROM cost.paid_provider_policies WHERE policy_id = $1`,
      [policyId],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : fromRow(row);
  }

  async activate(
    policyId: string,
    approver: string,
    at = this.now().toISOString(),
  ): Promise<PaidProviderPolicy> {
    const activatedAt = iso(at, 'activatedAt');
    return this.engine.transaction(async (tx) => {
      const current = await new PaidProviderPolicyStore(tx, this.now).get(policyId);
      if (current === undefined) invalid('policy does not exist', { policyId });
      if (current.approvedBy !== approver)
        invalid('activation approver does not match immutable approval');
      if (current.reAuthDueAt <= activatedAt) invalid('policy re-authentication is expired');
      await tx.query(
        `UPDATE cost.paid_provider_policies
         SET active = FALSE, superseded_by = $2
         WHERE provider_id = $1 AND active = TRUE AND policy_id <> $2`,
        [current.providerId, policyId],
      );
      const updated = await tx.query<PaidPolicyRow>(
        `UPDATE cost.paid_provider_policies
         SET active = TRUE, activated_at = COALESCE(activated_at, $2)
         WHERE policy_id = $1 AND superseded_by IS NULL
         RETURNING *`,
        [policyId, activatedAt],
      );
      const row = updated.rows[0];
      if (row === undefined) invalid('superseded policy cannot activate', { policyId });
      return fromRow(row);
    });
  }

  async reAuthenticate(
    policyId: string,
    approver: string,
    reAuthDueAt = new Date(this.now().getTime() + REAUTH_INTERVAL_MS).toISOString(),
  ): Promise<PaidProviderPolicy> {
    const due = iso(reAuthDueAt, 'reAuthDueAt');
    const current = await this.get(policyId);
    if (current === undefined) invalid('policy does not exist', { policyId });
    if (current.approvedBy !== approver)
      invalid('re-authentication requires the immutable approver');
    const floor = current.activatedAt ?? current.approvedAt;
    if (due <= floor || due <= this.now().toISOString())
      invalid('new re-authentication expiry must be in the future');
    const rows = await this.engine.query<PaidPolicyRow>(
      `UPDATE cost.paid_provider_policies SET re_auth_due_at = $2
       WHERE policy_id = $1 AND superseded_by IS NULL RETURNING *`,
      [policyId, due],
    );
    const row = rows.rows[0];
    if (row === undefined) invalid('superseded policy cannot be re-authenticated', { policyId });
    return fromRow(row);
  }

  async activeFor(
    providerId: string,
    at = this.now().toISOString(),
  ): Promise<PaidProviderPolicy | undefined> {
    const rows = await this.engine.query<PaidPolicyRow>(
      `SELECT * FROM cost.paid_provider_policies
       WHERE provider_id = $1 AND active = TRUE AND superseded_by IS NULL
         AND re_auth_due_at > $2
       LIMIT 1`,
      [providerId, iso(at, 'at')],
    );
    const row = rows.rows[0];
    return row === undefined ? undefined : fromRow(row);
  }
}

export { PaidProviderPolicyStore as PaidPolicyStore };
