/**
 * Field-level freshness (FR-CORE-006; PRD §16.5). The PRD example defaults
 * are THE data table in `@foresift/domain`; deployments may override rows at
 * composition time only (never per call), and every override must keep the
 * SQL window-shape invariant (stale window ≥ fresh window).
 *
 * Boundary semantics are INCLUSIVE: an entry is FRESH through
 * `storedAt + freshTtl`, STALE-admissible through `storedAt + acceptableStale`
 * (for holder modes permitted by the family's staleAdmission scope), and
 * EXPIRED strictly after that.
 */
import {
  DEFAULT_FRESHNESS_POLICY_TABLE,
  ForesiftError,
  HolderMode,
  type FreshnessFieldFamily,
  type StaleAdmissionScope,
} from '@foresift/domain';

export interface FreshnessPolicyRow {
  readonly freshTtlSeconds: number;
  readonly acceptableStaleSeconds: number;
  readonly staleAdmission: StaleAdmissionScope;
}

/** Outcome aligned with the §16.3 cache-outcome vocabulary + refusal. */
export type FreshnessOutcome = 'HIT_FRESH' | 'HIT_STALE' | 'EXPIRED';

export interface FreshnessDecision {
  readonly outcome: FreshnessOutcome;
  readonly freshUntil: string;
  readonly staleUntil: string;
}

const MANUAL_HOLDER_MODES: readonly HolderMode[] = ['MCP_MANUAL', 'ADMIN_CHAT'];

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/** Validate a policy row (or override): windows ordered, non-negative TTLs. */
function validateRow(row: FreshnessPolicyRow): void {
  if (
    !Number.isFinite(row.freshTtlSeconds) ||
    row.freshTtlSeconds < 0 ||
    row.acceptableStaleSeconds < row.freshTtlSeconds
  ) {
    throw new ForesiftError('FRESHNESS_POLICY_INVALID', 'fresh/stale windows out of order', {
      freshTtlSeconds: row.freshTtlSeconds,
      acceptableStaleSeconds: row.acceptableStaleSeconds,
    });
  }
}

export class FreshnessEvaluator {
  private readonly table: Readonly<Record<FreshnessFieldFamily, FreshnessPolicyRow>>;

  /** `overrides` replace whole rows at composition time; partial rows refuse. */
  constructor(overrides?: Partial<Record<FreshnessFieldFamily, FreshnessPolicyRow>>) {
    const merged: Record<FreshnessFieldFamily, FreshnessPolicyRow> = {
      ...DEFAULT_FRESHNESS_POLICY_TABLE,
    };
    for (const [family, row] of Object.entries(overrides ?? {})) {
      if (!row) continue;
      validateRow(row);
      merged[family as FreshnessFieldFamily] = row;
    }
    for (const row of Object.values(merged)) validateRow(row);
    this.table = merged;
  }

  policyFor(family: FreshnessFieldFamily): FreshnessPolicyRow {
    return this.table[family];
  }

  /**
   * Inclusive-edge evaluation at `decisionTime` against an entry stored at
   * `storedAt`. MANUAL_ONLY families admit stale reads only to manual holder
   * modes; AUTOMATED families admit stale to everyone.
   */
  evaluate(request: {
    family: FreshnessFieldFamily;
    storedAt: string;
    decisionTime: string;
    holderMode: HolderMode;
  }): FreshnessDecision {
    const row = this.policyFor(request.family);
    const freshUntil = addSeconds(request.storedAt, row.freshTtlSeconds);
    const staleUntil = addSeconds(request.storedAt, row.acceptableStaleSeconds);
    if (request.decisionTime <= freshUntil) {
      return { outcome: 'HIT_FRESH', freshUntil, staleUntil };
    }
    if (request.decisionTime <= staleUntil) {
      const admitted =
        row.staleAdmission === 'AUTOMATED' || MANUAL_HOLDER_MODES.includes(request.holderMode);
      return { outcome: admitted ? 'HIT_STALE' : 'EXPIRED', freshUntil, staleUntil };
    }
    return { outcome: 'EXPIRED', freshUntil, staleUntil };
  }
}
