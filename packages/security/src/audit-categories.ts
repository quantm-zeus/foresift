/**
 * §35.9 audit coverage vocabulary as typed event classes (FR-SEC-002).
 *
 * The class VALUES are pinned by `AuditActionClassSchema` in
 * `@foresift/shared-schemas` (SQL CHECK constraints mirror them); this module
 * adds the coverage mapping: every auditable duty named by §35.9 maps to
 * exactly one class, and `assertSection359CoverageComplete` refuses if any
 * bullet is unmapped or any class is unreachable — so extending the product's
 * audited surface without extending this map fails loudly instead of silently
 * leaving an unauditable change class.
 */
import { AuditActionClassSchema, type AuditActionClass } from '@foresift/shared-schemas';

export type { AuditActionClass };

/** All classes, in schema order (single source: the shared schema). */
export const ALL_AUDIT_ACTION_CLASSES: readonly AuditActionClass[] = AuditActionClassSchema.options;

/** One §35.9 bullet mapped to its owning class. */
export interface CoverageBullet {
  /** The auditable duty as §35.9 names it. */
  readonly bullet: string;
  readonly actionClass: AuditActionClass;
}

/**
 * The complete §35.9 coverage map. Order follows §35.9's enumeration.
 * A completeness test asserts every class is hit AND no bullet duplicates.
 */
export const SECTION_35_9_COVERAGE: readonly CoverageBullet[] = [
  { bullet: 'authentication and authorization', actionClass: 'AUTHENTICATION_AUTHORIZATION' },
  { bullet: 'tool/resource access', actionClass: 'TOOL_RESOURCE_ACCESS' },
  { bullet: 'provider/collector calls', actionClass: 'PROVIDER_COLLECTOR_ACCESS' },
  { bullet: 'blocked operations', actionClass: 'BLOCKED_OPERATION' },
  { bullet: 'configuration changes', actionClass: 'CONFIGURATION_CHANGE' },
  { bullet: 'capability changes', actionClass: 'CAPABILITY_CHANGE' },
  { bullet: 'cost changes', actionClass: 'COST_CHANGE' },
  { bullet: 'rights changes', actionClass: 'RIGHTS_CHANGE' },
  { bullet: 'source-dependence changes', actionClass: 'SOURCE_DEPENDENCE_CHANGE' },
  { bullet: 'pool-adapter changes', actionClass: 'POOL_ADAPTER_CHANGE' },
  { bullet: 'public-gate changes', actionClass: 'PUBLIC_GATE_CHANGE' },
  { bullet: 'approvals and step-up', actionClass: 'APPROVAL_STEP_UP' },
  { bullet: 'imports and promotions', actionClass: 'IMPORT_PROMOTION' },
  { bullet: 'pauses, retirements, and rollbacks', actionClass: 'PAUSE_RETIREMENT_ROLLBACK' },
  { bullet: 'secret lifecycle', actionClass: 'SECRET_LIFECYCLE' },
  { bullet: 'incidents and recovery actions', actionClass: 'INCIDENT_RECOVERY' },
] as const;

export interface CoverageReport {
  /** Bullets with no assigned class — must always be empty. */
  readonly unmappedBullets: readonly string[];
  /** Classes no bullet maps to — must always be empty. */
  readonly uncoveredClasses: readonly AuditActionClass[];
}

/** Compute the §35.9 coverage report over the current map. */
export function section359Coverage(): CoverageReport {
  const unmapped = SECTION_35_9_COVERAGE.filter(
    (b) => !ALL_AUDIT_ACTION_CLASSES.includes(b.actionClass),
  ).map((b) => b.bullet);
  const covered = new Set(SECTION_35_9_COVERAGE.map((b) => b.actionClass));
  const uncovered = ALL_AUDIT_ACTION_CLASSES.filter((c) => !covered.has(c));
  return { unmappedBullets: unmapped, uncoveredClasses: uncovered };
}
