/**
 * Immutable per-class alert policy registry (T012, FR-ALERT-001/002/005,
 * AC-140; PRD §26.1/§26.2; plan D2/D3).
 *
 * The six §26.2 alert classes each carry a genuinely separate policy: TTL,
 * cooldown, material-change thresholds, content policy, and metric-denominator
 * membership. The durable authority is `alert.alert_policies` (one immutable
 * version row per class, `superseded_by`-linked); this module resolves an
 * `AlertPolicy` from those rows and falls back to the in-code default registry
 * so the resolver is total over the closed six-class vocabulary.
 *
 * Fail-closed laws:
 * - an unknown class refuses with `ALERT_CLASS_UNKNOWN` (via the domain parser);
 * - a persisted row whose config does not map to a known content-policy version
 *   or whose class/template pair is inconsistent refuses with
 *   `ALERT_POLICY_UNKNOWN` (an "unmapped policy version");
 * - two active (non-superseded) rows for one class are ambiguous and refuse;
 * - the D3 TTL invariant — EARLY_WATCH expires strictly sooner than
 *   CONFIRMED_OPPORTUNITY — is asserted on every resolved registry;
 * - only CONFIRMED_OPPORTUNITY may set `highConvictionAllowed` (FR-ALERT-002).
 *
 * Strictly read-only: policies are data; nothing here can trade, hold custody,
 * sign, handle private keys, or submit a transaction.
 */
import {
  ALL_ALERT_CLASSES,
  AlertClass,
  ErrorCode,
  ForesiftError,
  alertPolicyFor as domainDefaultPolicyFor,
  parseAlertClass,
  type AlertMaterialChangeThresholds,
} from '@foresift/domain';
import type { AlertClassPolicyRow } from '@foresift/shared-schemas';
import { parseAlertSchema } from '@foresift/shared-schemas';
import type { DatabaseEngine } from '@foresift/persistence';

/** Version tag of the resolved policy-registry shape. */
export const ALERT_POLICY_REGISTRY_VERSION = 1 as const;

/** The content-policy config version this code knows how to map. */
export const ALERT_CONTENT_POLICY_VERSION = 1 as const;

// --- content policy ---------------------------------------------------------

/** Closed class-template vocabulary; the renderer keys off exactly this. */
export const AlertContentTemplate = {
  EARLY_WATCH: 'EARLY_WATCH',
  OPPORTUNITY: 'OPPORTUNITY',
  THESIS_UPDATE: 'THESIS_UPDATE',
  EXPIRY: 'EXPIRY',
  RISK: 'RISK',
} as const;
export type AlertContentTemplate = (typeof AlertContentTemplate)[keyof typeof AlertContentTemplate];
export const ALL_ALERT_CONTENT_TEMPLATES: readonly AlertContentTemplate[] =
  Object.values(AlertContentTemplate);

/** Immutable per-class content policy (§26.2/§26.7/§26.8). */
export interface AlertContentPolicy {
  /** The single template class content renders through. */
  readonly template: AlertContentTemplate;
  /** §26.2: EARLY_WATCH MUST display explicit missing data. */
  readonly requiresMissingData: boolean;
  /** §26.7/§26.8: every opportunity notification carries the full envelope. */
  readonly requiresOpportunityEnvelope: boolean;
  /** FR-ALERT-002: only classes whose policy permits it may use conviction language. */
  readonly highConvictionAllowed: boolean;
}

// --- policy shape -----------------------------------------------------------

export const AlertPolicySource = {
  /** The in-code default registry (no persisted override for the class). */
  DEFAULT: 'DEFAULT',
  /** A persisted immutable version row in `alert.alert_policies`. */
  PERSISTED: 'PERSISTED',
} as const;
export type AlertPolicySource = (typeof AlertPolicySource)[keyof typeof AlertPolicySource];

/** One immutable resolved per-class policy. */
export interface AlertPolicy {
  readonly alertClass: AlertClass;
  /** Persisted version, or 1 for the in-code default. */
  readonly version: number;
  readonly ttlSeconds: number;
  readonly cooldownSeconds: number;
  readonly thresholds: AlertMaterialChangeThresholds;
  readonly content: AlertContentPolicy;
  /** FR-ALERT-005: true only for the class counted in confirmed precision/recall. */
  readonly confirmedDenominatorMember: boolean;
  readonly source: AlertPolicySource;
  /** `alert.alert_policies.policy_id` for a persisted row; null for the default. */
  readonly policyId: string | null;
}

// --- in-code defaults -------------------------------------------------------

/**
 * The content policy is a property of the class, not of a config row: a
 * persisted row may only restate it. EARLY_WATCH requires missing data; only the
 * opportunity family requires the full §26.7/§26.8 envelope.
 */
const ALERT_CONTENT_POLICY_BY_CLASS: Readonly<Record<AlertClass, AlertContentPolicy>> =
  Object.freeze({
    EARLY_WATCH: Object.freeze({
      template: AlertContentTemplate.EARLY_WATCH,
      requiresMissingData: true,
      requiresOpportunityEnvelope: false,
      highConvictionAllowed: false,
    }),
    CONFIRMED_OPPORTUNITY: Object.freeze({
      template: AlertContentTemplate.OPPORTUNITY,
      requiresMissingData: false,
      requiresOpportunityEnvelope: true,
      highConvictionAllowed: true,
    }),
    THESIS_STRENGTHENING: Object.freeze({
      template: AlertContentTemplate.THESIS_UPDATE,
      requiresMissingData: false,
      requiresOpportunityEnvelope: false,
      highConvictionAllowed: false,
    }),
    THESIS_WEAKENING: Object.freeze({
      template: AlertContentTemplate.THESIS_UPDATE,
      requiresMissingData: false,
      requiresOpportunityEnvelope: false,
      highConvictionAllowed: false,
    }),
    OPPORTUNITY_EXPIRED: Object.freeze({
      template: AlertContentTemplate.EXPIRY,
      requiresMissingData: false,
      requiresOpportunityEnvelope: false,
      highConvictionAllowed: false,
    }),
    RISK_ALERT: Object.freeze({
      template: AlertContentTemplate.RISK,
      requiresMissingData: false,
      requiresOpportunityEnvelope: false,
      highConvictionAllowed: false,
    }),
  });

/** The in-code policy template for one class (zero runtime dependencies). */
export function defaultAlertPolicyFor(alertClass: AlertClass): AlertPolicy {
  const parsed = parseAlertClass(alertClass);
  const base = domainDefaultPolicyFor(parsed);
  return Object.freeze({
    alertClass: parsed,
    version: 1,
    ttlSeconds: base.ttlSeconds,
    cooldownSeconds: base.cooldownSeconds,
    thresholds: Object.freeze({ ...base.materialChangeThresholds }),
    content: ALERT_CONTENT_POLICY_BY_CLASS[parsed],
    confirmedDenominatorMember: base.confirmedDenominatorMember,
    source: AlertPolicySource.DEFAULT,
    policyId: null,
  });
}

/**
 * Total pure fallback resolver: every one of the six §26.2 classes resolves to
 * the in-code default policy; an unknown literal refuses with
 * `ALERT_CLASS_UNKNOWN` through the domain parser.
 */
export function alertPolicyFor(alertClass: AlertClass): AlertPolicy {
  return defaultAlertPolicyFor(alertClass);
}

/** The in-code default registry, total over the six classes. */
export const DEFAULT_ALERT_POLICIES: Readonly<Record<AlertClass, AlertPolicy>> = Object.freeze(
  Object.fromEntries(
    ALL_ALERT_CLASSES.map((alertClass) => [alertClass, defaultAlertPolicyFor(alertClass)]),
  ) as Record<AlertClass, AlertPolicy>,
);

// --- registry ---------------------------------------------------------------

/** The resolved registry: persisted versions where present, defaults otherwise. */
export interface AlertPolicyRegistry {
  readonly registryVersion: number;
  readonly policies: Readonly<Record<AlertClass, AlertPolicy>>;
  /** Resolve one class; total over the six-class vocabulary. */
  policyFor(alertClass: AlertClass): AlertPolicy;
  /** Where the resolved policy for this class came from. */
  sourceFor(alertClass: AlertClass): AlertPolicySource;
  /** The distinct ttl/cooldown pairs, for AC-140 separation assertions. */
  readonly ttlSecondsByClass: Readonly<Record<AlertClass, number>>;
  readonly cooldownSecondsByClass: Readonly<Record<AlertClass, number>>;
}

function invariantViolation(message: string, detail: Record<string, string | number>): never {
  throw new ForesiftError(ErrorCode.CONTRACT_INVARIANT_VIOLATED, message, detail);
}

function assertUnitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      `persisted alert policy ${field} must be a number in [0,1]`,
      { field },
    );
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      `persisted alert policy ${field} must be a non-negative integer`,
      { field },
    );
  }
  return value;
}

function thresholdsFromRow(
  alertClass: AlertClass,
  raw: Record<string, unknown>,
): AlertMaterialChangeThresholds {
  const defaults = domainDefaultPolicyFor(alertClass).materialChangeThresholds;
  const severityDelta = raw['severityDelta'] ?? defaults.severityDelta;
  const thesisVersionDelta = raw['thesisVersionDelta'] ?? defaults.thesisVersionDelta;
  const materialEvidenceChangeIsMaterial =
    raw['materialEvidenceChangeIsMaterial'] ?? defaults.materialEvidenceChangeIsMaterial;
  if (typeof materialEvidenceChangeIsMaterial !== 'boolean') {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      'persisted alert policy materialEvidenceChangeIsMaterial must be boolean',
      { field: 'materialEvidenceChangeIsMaterial' },
    );
  }
  return Object.freeze({
    severityDelta: assertUnitInterval(severityDelta, 'thresholds.severityDelta'),
    thesisVersionDelta: assertNonNegativeInteger(
      thesisVersionDelta,
      'thresholds.thesisVersionDelta',
    ),
    materialEvidenceChangeIsMaterial,
  });
}

/**
 * Map one persisted row's `config` to the class content policy. A config that
 * declares an unknown content version, a missing template, or a template that
 * does not match the class refuses with `ALERT_POLICY_UNKNOWN` — an unmapped
 * policy version must never silently render through the wrong template.
 */
function contentPolicyFromRow(
  alertClass: AlertClass,
  config: Record<string, unknown>,
): AlertContentPolicy {
  const expected = ALERT_CONTENT_POLICY_BY_CLASS[alertClass];
  const contentPolicyVersion = config['contentPolicyVersion'];
  if (contentPolicyVersion !== ALERT_CONTENT_POLICY_VERSION) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      'persisted alert policy content version is not mapped by this code',
      {
        alertClass,
        contentPolicyVersion:
          typeof contentPolicyVersion === 'number' ? contentPolicyVersion : null,
      },
    );
  }
  const template = config['template'];
  if (template !== expected.template) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      'persisted alert policy template does not match its alert class',
      { alertClass, template: typeof template === 'string' ? template : null },
    );
  }
  return expected;
}

function policyFromRow(row: AlertClassPolicyRow): AlertPolicy {
  // Parse the class first so an unknown class refuses with its own typed code.
  const alertClass = parseAlertClass(row.alertClass);
  if (row.highConvictionAllowed === true && alertClass !== AlertClass.CONFIRMED_OPPORTUNITY) {
    invariantViolation(
      'FR-ALERT-002: only CONFIRMED_OPPORTUNITY may allow high-conviction language',
      { alertClass },
    );
  }
  // FR-ALERT-005: the confirmed class is the denominator member; a persisted
  // version cannot silently drop it, and no other class may claim it.
  if (alertClass === AlertClass.CONFIRMED_OPPORTUNITY && row.confirmedDenominatorMember !== true) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      'a persisted CONFIRMED_OPPORTUNITY policy must be a confirmed-denominator member',
      { alertClass },
    );
  }
  if (row.confirmedDenominatorMember === true && alertClass !== AlertClass.CONFIRMED_OPPORTUNITY) {
    invariantViolation(
      'FR-ALERT-005: only CONFIRMED_OPPORTUNITY may join the confirmed denominator',
      { alertClass },
    );
  }
  return Object.freeze({
    alertClass,
    version: row.version,
    ttlSeconds: row.ttlSeconds,
    cooldownSeconds: row.cooldownSeconds,
    thresholds: thresholdsFromRow(alertClass, row.thresholds),
    content: contentPolicyFromRow(alertClass, row.config),
    confirmedDenominatorMember: row.confirmedDenominatorMember,
    source: AlertPolicySource.PERSISTED,
    policyId: row.policyId,
  });
}

/**
 * Assert the D3 TTL invariant: EARLY_WATCH expires strictly sooner than
 * CONFIRMED_OPPORTUNITY. A registry that violates it refuses with
 * `CONTRACT_INVARIANT_VIOLATED` rather than shipping an inverted class TTL.
 */
export function assertEarlyWatchTtlStrictlyShorter(
  policies: Readonly<Record<AlertClass, AlertPolicy>>,
): void {
  const early = policies[AlertClass.EARLY_WATCH].ttlSeconds;
  const confirmed = policies[AlertClass.CONFIRMED_OPPORTUNITY].ttlSeconds;
  if (!(early < confirmed)) {
    invariantViolation(
      'FR-ALERT-002: EARLY_WATCH TTL must be strictly shorter than CONFIRMED_OPPORTUNITY TTL',
      { earlyWatchTtlSeconds: early, confirmedTtlSeconds: confirmed },
    );
  }
}

/**
 * Build the immutable registry from persisted policy rows (already validated by
 * the Zod row schema). The highest active version wins per class; classes with
 * no persisted row fall back to the in-code default. A duplicate active version
 * for one class is ambiguous and refuses.
 */
export function buildAlertPolicyRegistry(
  rows: readonly AlertClassPolicyRow[],
): AlertPolicyRegistry {
  const resolved: Partial<Record<AlertClass, AlertPolicy>> = {};
  for (const row of rows) {
    const policy = policyFromRow(row);
    const existing = resolved[policy.alertClass];
    if (existing !== undefined) {
      invariantViolation('two active alert policy versions for one class are ambiguous', {
        alertClass: policy.alertClass,
        firstVersion: existing.version,
        secondVersion: policy.version,
      });
    }
    resolved[policy.alertClass] = policy;
  }
  const policies = Object.freeze(
    Object.fromEntries(
      ALL_ALERT_CLASSES.map((alertClass) => [
        alertClass,
        resolved[alertClass] ?? defaultAlertPolicyFor(alertClass),
      ]),
    ) as Record<AlertClass, AlertPolicy>,
  );
  assertEarlyWatchTtlStrictlyShorter(policies);
  const ttlSecondsByClass = Object.freeze(
    Object.fromEntries(ALL_ALERT_CLASSES.map((c) => [c, policies[c].ttlSeconds])) as Record<
      AlertClass,
      number
    >,
  );
  const cooldownSecondsByClass = Object.freeze(
    Object.fromEntries(ALL_ALERT_CLASSES.map((c) => [c, policies[c].cooldownSeconds])) as Record<
      AlertClass,
      number
    >,
  );
  return Object.freeze({
    registryVersion: ALERT_POLICY_REGISTRY_VERSION,
    policies,
    ttlSecondsByClass,
    cooldownSecondsByClass,
    policyFor(alertClass: AlertClass): AlertPolicy {
      return policies[parseAlertClass(alertClass)];
    },
    sourceFor(alertClass: AlertClass): AlertPolicySource {
      return policies[parseAlertClass(alertClass)].source;
    },
  });
}

/** The default registry (no persisted overrides). */
export const DEFAULT_ALERT_POLICY_REGISTRY: AlertPolicyRegistry = buildAlertPolicyRegistry([]);

const SELECT_ACTIVE_POLICIES = `
    SELECT policy_id, alert_class, version, config_hash, config,
           ttl_seconds, cooldown_seconds, high_conviction_allowed,
           confirmed_denominator, thresholds, superseded_by, created_at
      FROM alert.alert_policies
     WHERE superseded_by IS NULL
     ORDER BY alert_class, version`;

interface RawPolicyRow {
  readonly policy_id: string;
  readonly alert_class: string;
  readonly version: number;
  readonly config_hash: string;
  readonly config: unknown;
  readonly ttl_seconds: number;
  readonly cooldown_seconds: number;
  readonly high_conviction_allowed: boolean;
  readonly confirmed_denominator: boolean;
  readonly thresholds: unknown;
  readonly superseded_by: string | null;
  readonly created_at: string;
}

/**
 * Load the active (non-superseded) policy rows and build the registry. A row
 * that fails the strict Zod row schema — including an unknown class — refuses
 * through its typed code rather than degrading to a default.
 */
export async function loadAlertPolicies(engine: DatabaseEngine): Promise<AlertPolicyRegistry> {
  const result = await engine.query<RawPolicyRow>(SELECT_ACTIVE_POLICIES);
  const rows: AlertClassPolicyRow[] = result.rows.map((row) => {
    const candidate = {
      policyId: row.policy_id,
      alertClass: row.alert_class,
      version: row.version,
      configHash: row.config_hash,
      config: row.config,
      ttlSeconds: row.ttl_seconds,
      cooldownSeconds: row.cooldown_seconds,
      highConvictionAllowed: row.high_conviction_allowed,
      confirmedDenominatorMember: row.confirmed_denominator,
      thresholds: row.thresholds,
      supersededBy: row.superseded_by,
      createdAt: row.created_at,
    };
    // Parse the class before the schema so an unknown class keeps its own code.
    parseAlertClass(candidate.alertClass);
    try {
      return parseAlertSchema('AlertClassPolicyRow', candidate);
    } catch (error) {
      throw new ForesiftError(
        ErrorCode.ALERT_POLICY_UNKNOWN,
        'persisted alert policy row does not satisfy the alert policy schema',
        { policyId: row.policy_id, cause: error instanceof Error ? error.name : null },
      );
    }
  });
  return buildAlertPolicyRegistry(rows);
}

/** Resolve a class against an optional persisted registry, else the default. */
export function resolveAlertPolicy(
  alertClass: AlertClass,
  registry?: AlertPolicyRegistry,
): AlertPolicy {
  return (registry ?? DEFAULT_ALERT_POLICY_REGISTRY).policyFor(alertClass);
}
