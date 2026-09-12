/**
 * Shadow-run influence choke point (T023, FR-WF-008; PRD §9.6 / §25).
 *
 * The product law (packages/domain/src/wf.ts `shadowSuppressesInfluence`) is:
 * a shadow run executes the full pipeline, may write decisions and
 * shadow-tagged outbox rows for evaluation, and may READ evidence freely — but
 * it MUST NOT deliver an opportunity-influencing notification or write policy
 * back. This module is the single choke point every such path must consult:
 *
 * - `shadowSuppressionFor(run, influence)` returns the suppression verdict the
 *   commit boundary uses to tag a row `SUPPRESSED_SHADOW` (never deliverable);
 * - `assertNoOpportunityInfluence(run, influence)` refuses with a typed
 *   `WF_SHADOW_INFLUENCE_REFUSED` wherever an actual influence is attempted
 *   (delivery of a deliverable row, policy write-back).
 *
 * Both consult the one domain law, so the SQL/domain/schema vocabularies cannot
 * drift apart. Governance (which versions are shadow) is consumed as a flag
 * here; the lifecycle/activation gates belong to g2-production-readiness.
 *
 * Strictly read-only: refusing influence is a safety guard; this module can
 * never trade, custody, sign, handle keys, or submit a transaction.
 */
import {
  ErrorCode,
  ForesiftError,
  shadowSuppressesInfluence,
  type ShadowInfluenceKind,
} from '@foresift/domain';

/** The run fields the choke point needs; extra fields are ignored. */
export interface ShadowRunContext {
  readonly runId?: string;
  readonly shadow: boolean;
}

/** Typed refusal: a shadow run attempted an opportunity-influencing action. */
export class ShadowInfluenceRefusedError extends ForesiftError {
  constructor(message: string, detail: Record<string, string | number | boolean | null> = {}) {
    super(ErrorCode.WF_SHADOW_INFLUENCE_REFUSED, message, detail);
    this.name = 'ShadowInfluenceRefusedError';
  }
}

/**
 * The suppression verdict: a status tag when the domain law suppresses this
 * influence for this run, or `null` when the influence is permitted. Reads are
 * always permitted, so they always return `null`.
 */
export function shadowSuppressionFor(
  run: ShadowRunContext,
  influence: ShadowInfluenceKind,
): 'SUPPRESSED_SHADOW' | null {
  return shadowSuppressesInfluence({ shadow: run.shadow, influence }) ? 'SUPPRESSED_SHADOW' : null;
}

/**
 * THE choke point. Refuses with `WF_SHADOW_INFLUENCE_REFUSED` when a shadow run
 * attempts an opportunity-influencing action; permits reads and non-shadow
 * runs. The commit boundary calls `shadowSuppressionFor` to TAG instead of
 * refuse (shadow-tagged rows are evaluation data); delivery and policy
 * write-back call this to REFUSE.
 */
export function assertNoOpportunityInfluence(
  run: ShadowRunContext,
  influence: ShadowInfluenceKind,
): void {
  if (shadowSuppressionFor(run, influence) !== null) {
    throw new ShadowInfluenceRefusedError('a shadow run must not exert opportunity influence', {
      runId: run.runId ?? null,
      influence,
    });
  }
}
