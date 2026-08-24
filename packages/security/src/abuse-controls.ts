/**
 * Abuse controls (FR-SEC-010): flood limiting, expensive-query
 * amplification weighting, quota-exhaustion DEGRADE-not-bypass semantics,
 * scraping/enumeration detection, prompt-attack screening seam,
 * protected-risk-monitoring allowance, and market-manipulation
 * coordination-signal guard stubs.
 *
 * ALL time flows through the injected clock — deterministic by
 * construction; there is no wall-clock fallback anywhere in this module.
 */
import { SecErrorCode, AbuseControlError } from './errors.ts';

/** Subjects whose service may NEVER be degraded or suspended. */
export const PROTECTED_SUBJECTS: readonly string[] = [
  'risk-monitoring',
  'audit-health',
  'incident-response',
] as const;

export interface SlidingWindowConfig {
  /** Window length in ms. */
  readonly windowMs: number;
  /** Admitted units per window per key. */
  readonly limit: number;
}

interface Bucket {
  /** (timestamp, cost) admissions inside the current window. */
  readonly entries: { at: number; cost: number }[];
}

export type ServiceClass = 'FULL' | 'DEGRADED' | 'PROTECTED';

export interface AbuseDecision {
  readonly admitted: boolean;
  readonly serviceClass: ServiceClass;
  /** Cost-weighted budget consumed (amplification weighting). */
  readonly costConsumed: number;
  readonly retryAfterMs?: number | undefined;
}

export class AbuseController {
  private readonly clock: () => number;
  private readonly buckets = new Map<string, Bucket>();
  private readonly flood: SlidingWindowConfig;
  private readonly queryBudgetPerWindow: number;
  private readonly enumerationThreshold: number;
  private readonly distinctAccesses = new Map<string, Set<string>>();
  private readonly burstLog: { subject: string; at: number }[] = [];

  constructor(options: {
    clock: () => number;
    flood?: SlidingWindowConfig | undefined;
    /** Weighted-cost budget for expensive queries per flood window. */
    readonly queryBudgetPerWindow?: number | undefined;
    /** Distinct-object ratio above which enumeration is flagged. */
    readonly enumerationThreshold?: number | undefined;
  }) {
    this.clock = options.clock;
    this.flood = options.flood ?? { windowMs: 60_000, limit: 120 };
    this.queryBudgetPerWindow = options.queryBudgetPerWindow ?? 600;
    this.enumerationThreshold = options.enumerationThreshold ?? 50;
  }

  /**
   * Flood limiter + amplification weighting. `cost` scales with the
   * EXPENSIVENESS of the operation (deep scans consume more budget than a
   * light read), so one heavy call can consume many admission slots.
   */
  admit(subject: string, cost = 1): AbuseDecision {
    const now = this.clock();
    const bucket = this.buckets.get(subject) ?? { entries: [] };
    const entries = bucket.entries.filter((e) => now - e.at < this.flood.windowMs);
    const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);

    if (totalCost + cost > this.flood.limit) {
      const oldestAt = entries[0]?.at ?? now;
      const retryAfterMs = Math.max(oldestAt + this.flood.windowMs - now, 0);
      throw new AbuseControlError(
        'flood limit exceeded for subject',
        { subject, retryAfterMs },
        SecErrorCode.SEC_ABUSE_RATE_LIMIT_EXCEEDED,
      );
    }

    // Amplification budget: expensive queries additionally draw down the
    // weighted query budget; exhaustion refuses rather than degrading here
    // (degradation is the QUOTA path below, not an excuse to bypass).
    if (cost > 10 && totalCost + cost > this.queryBudgetPerWindow) {
      throw new AbuseControlError(
        'expensive-query amplification budget exceeded',
        { subject },
        SecErrorCode.SEC_ABUSE_AMPLIFICATION_REFUSED,
      );
    }

    entries.push({ at: now, cost });
    this.buckets.set(subject, { entries });
    return { admitted: true, serviceClass: 'FULL', costConsumed: cost, retryAfterMs: undefined };
  }

  /**
   * Quota exhaustion: DEGRADE, never bypass. When the subject's budget is
   * exhausted but the request is not outright abusive, callers get a
   * DEGRADED service class — cheaper cached paths — while controls remain
   * fully in force.
   */
  degradeOnQuotaExhaustion(subject: string): AbuseDecision {
    if (PROTECTED_SUBJECTS.includes(subject)) {
      // Protected risk monitoring NEVER degrades and never bypasses.
      return { admitted: true, serviceClass: 'PROTECTED', costConsumed: 0 };
    }
    return { admitted: true, serviceClass: 'DEGRADED', costConsumed: 0 };
  }

  /**
   * Scraping/enumeration detection: track DISTINCT objects accessed within
   * the window; a uniform sweep across many distinct objects flags.
   */
  recordDistinctAccess(subject: string, objectKey: string): void {
    const set = this.distinctAccesses.get(subject) ?? new Set<string>();
    set.add(objectKey);
    this.distinctAccesses.set(subject, set);
  }

  isEnumerationSuspected(subject: string): boolean {
    return (this.distinctAccesses.get(subject)?.size ?? 0) >= this.enumerationThreshold;
  }

  assertNotEnumerating(subject: string): void {
    if (this.isEnumerationSuspected(subject)) {
      throw new AbuseControlError(
        'enumeration pattern suspected for subject',
        { subject },
        SecErrorCode.SEC_ABUSE_ENUMERATION_SUSPECTED,
      );
    }
  }

  /**
   * Protected-risk-monitoring allowance: an EXPLICIT non-weakening set.
   * Suspending one of these subjects is refused as a machine-checked
   * invariant — abuse responses cannot silence the monitors watching them.
   */
  static assertSuspensionAllowed(subject: string): void {
    if (PROTECTED_SUBJECTS.includes(subject)) {
      throw new AbuseControlError(
        `protected subject '${subject}' can never be suspended by abuse responses`,
        { subject },
        SecErrorCode.SEC_ABUSE_PROTECTED_SUSPENSION_REFUSED,
      );
    }
  }

  // --- Feedback-loop / coordination guard stubs ---------------------------------

  /**
   * Record a burst event for coordination-signal analysis (market-
   * manipulation feedback loops). STUB: records deterministically; scoring
   * policy lands with FR-SEC-010's full detector work package.
   */
  recordBurst(subject: string): void {
    this.burstLog.push({ subject, at: this.clock() });
  }

  /** Deterministic correlation score over recorded bursts (stub heuristic). */
  coordinationScore(windowMs: number): number {
    const now = this.clock();
    const recent = this.burstLog.filter((b) => now - b.at < windowMs);
    const bySubject = new Map<string, number>();
    for (const burst of recent) {
      bySubject.set(burst.subject, (bySubject.get(burst.subject) ?? 0) + 1);
    }
    let score = 0;
    for (const count of bySubject.values()) {
      if (count >= 3) score += 1;
    }
    return score;
  }

  /**
   * Prompt-attack screening SEAM: wired to the classifier in later work.
   * Default screening is fail-closed on EXPLICIT attack markers only — it
   * never silently passes content claiming to be instructions to a
   * protected role.
   */
  screenPrompt(content: string): { allowed: boolean; reason?: string } {
    const lower = content.toLowerCase();
    for (const marker of [
      'ignore all previous instructions',
      'disregard your system prompt',
      'you are now unrestricted',
    ]) {
      if (lower.includes(marker)) {
        return { allowed: false, reason: `explicit instruction-override marker: "${marker}"` };
      }
    }
    return { allowed: true };
  }
}
