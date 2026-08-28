/** Deterministic verified-plan freshness gate (FR-COST-006). */
import { ErrorCode, ForesiftError } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export type VerificationState = 'VERIFIED' | 'UNVERIFIED';

export interface VerificationWindow {
  readonly verifiedAt?: string;
  readonly expiresAt: string;
}

export function verificationState(
  window: VerificationWindow,
  at: Date | string,
): VerificationState {
  const atMs = typeof at === 'string' ? Date.parse(at) : at.getTime();
  const expiresMs = Date.parse(window.expiresAt);
  if (Number.isNaN(atMs) || Number.isNaN(expiresMs)) return 'UNVERIFIED';
  return atMs < expiresMs ? 'VERIFIED' : 'UNVERIFIED';
}

export function assertVerified(window: VerificationWindow, at: Date | string): void {
  if (verificationState(window, at) === 'UNVERIFIED') {
    throw new ForesiftError(
      ErrorCode.UNKNOWN_COST,
      'UNVERIFIED: verified plan metadata is stale; estimate refused',
      { expiresAt: window.expiresAt },
    );
  }
}

export class PlanVerifier {
  constructor(
    private readonly engine: DatabaseEngine,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async assertSnapshot(snapshotId: string): Promise<void> {
    const rows = await this.engine.query<{ expires_at: string }>(
      `SELECT expires_at FROM cost.resource_forecast_snapshots WHERE snapshot_id = $1`,
      [snapshotId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'UNVERIFIED: forecast snapshot is absent');
    }
    assertVerified({ expiresAt: row.expires_at }, this.now());
  }

  async assertOperation(providerId: string, operationId: string): Promise<void> {
    const rows = await this.engine.query<{ verification_expires_at: string }>(
      `SELECT verification_expires_at FROM prov.prov_operations
       WHERE provider_id = $1 AND operation_id = $2
         AND current_state IN ('VERIFIED','ACTIVE','DEGRADED')
       ORDER BY created_at DESC, version DESC LIMIT 1`,
      [providerId, operationId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'UNVERIFIED: operation plan is absent');
    }
    assertVerified({ expiresAt: row.verification_expires_at }, this.now());
  }
}

/** Mutable control-plane projection used when provider-lifecycle re-verifies. */
export class InMemoryPlanVerification {
  private window: VerificationWindow;

  constructor(initial: VerificationWindow) {
    this.window = initial;
  }

  state(at: Date | string): VerificationState {
    return verificationState(this.window, at);
  }

  assert(at: Date | string): void {
    assertVerified(this.window, at);
  }

  reVerify(fresh: VerificationWindow): void {
    if (verificationState(fresh, fresh.verifiedAt ?? new Date(0).toISOString()) === 'UNVERIFIED') {
      throw new Error('re-verification window must be fresh at verifiedAt');
    }
    this.window = fresh;
  }
}
