/** Additive, immutable §19.1 feature-definition registration. */
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';

export const SignalRegistryErrorCode = {
  DEFINITION_INVALID: 'SIG_DEFINITION_INVALID',
  REIMPLEMENTATION_REVIEW_REQUIRED: 'SIG_REIMPLEMENTATION_REVIEW_REQUIRED',
  VERSION_DRIFT: 'SIG_FEATURE_VERSION_DRIFT',
} as const;

export type SignalRegistryErrorCode =
  (typeof SignalRegistryErrorCode)[keyof typeof SignalRegistryErrorCode];

export class SignalRegistryError extends Error {
  readonly code: SignalRegistryErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(
    code: SignalRegistryErrorCode,
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'SignalRegistryError';
    this.code = code;
    this.detail = detail;
  }
}

/** §19.1 plus the mandatory §19.9 numeric-stability registration fields. */
export interface SignalFeatureDefinition {
  readonly featureId: string;
  readonly version: number;
  readonly description: string;
  readonly formula: string;
  readonly inputFields: readonly string[];
  readonly unit: string;
  readonly windows: readonly string[];
  readonly minimumObservations: number;
  readonly nullPolicy: string;
  readonly outlierPolicy: string;
  readonly updatePolicy: string;
  readonly freshnessLimitSeconds: number;
  readonly cohortDefinitionId?: string;
  readonly evidenceRequirements: readonly string[];
  /** Defaults to true, matching SQL; non-numeric definitions opt out explicitly. */
  readonly isNumeric?: boolean;
  readonly minimumDenominator?: number;
  readonly stabilityTransform?: string;
  readonly shrinkagePolicy?: string;
  readonly cappedContribution?: number;
  readonly outlierPolicyIsRobust: boolean;
  readonly cohortFallbackPolicyId?: string;
  readonly economicEventRequired?: boolean;
}

/** Human review is intentionally separate from the immutable definition field set. */
export interface FeatureRegistrationReview {
  readonly independentlyReimplementable: boolean;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly rationale: string;
}

export type FeatureRegistrationResult = 'CREATED' | 'UNCHANGED';

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function invalid(definition: SignalFeatureDefinition, reason: string): never {
  throw new SignalRegistryError(
    SignalRegistryErrorCode.DEFINITION_INVALID,
    `invalid feature definition ${definition.featureId}@${definition.version}: ${reason}`,
    { featureId: definition.featureId, version: definition.version, reason },
  );
}

/** Fail-closed payload law, independent of which persistence adapter is used. */
export function assertFeatureDefinitionComplete(definition: SignalFeatureDefinition): void {
  if (!nonEmpty(definition.featureId)) invalid(definition, 'featureId is required');
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    invalid(definition, 'version must be a positive integer');
  }
  for (const [field, value] of [
    ['description', definition.description],
    ['formula', definition.formula],
    ['unit', definition.unit],
    ['nullPolicy', definition.nullPolicy],
    ['outlierPolicy', definition.outlierPolicy],
    ['updatePolicy', definition.updatePolicy],
  ] as const) {
    if (!nonEmpty(value)) invalid(definition, `${field} is required`);
  }
  if (definition.inputFields.length === 0 || definition.inputFields.some((field) => !nonEmpty(field))) {
    invalid(definition, 'inputFields must identify every required input');
  }
  if (!Number.isInteger(definition.minimumObservations) || definition.minimumObservations < 1) {
    invalid(definition, 'minimumObservations must be at least one');
  }
  if (!Number.isInteger(definition.freshnessLimitSeconds) || definition.freshnessLimitSeconds < 0) {
    invalid(definition, 'freshnessLimitSeconds must be a non-negative integer');
  }
  if (definition.isNumeric === false) return;
  if (
    definition.minimumDenominator === undefined ||
    !Number.isInteger(definition.minimumDenominator) ||
    definition.minimumDenominator < 1
  ) {
    invalid(definition, 'numeric features require minimumDenominator >= 1');
  }
  if (!nonEmpty(definition.stabilityTransform ?? '')) {
    invalid(definition, 'numeric features require a stabilityTransform');
  }
  if (!nonEmpty(definition.shrinkagePolicy ?? '')) {
    invalid(definition, 'numeric features require a shrinkagePolicy');
  }
  if (!definition.outlierPolicyIsRobust) {
    invalid(definition, 'numeric features require a robust outlier policy');
  }
  if (!nonEmpty(definition.cohortFallbackPolicyId ?? '')) {
    invalid(definition, 'numeric features require a cohortFallbackPolicyId');
  }
  if (
    definition.cappedContribution === undefined ||
    !Number.isFinite(definition.cappedContribution) ||
    definition.cappedContribution <= 0 ||
    definition.cappedContribution > 1
  ) {
    invalid(definition, 'numeric ranking contribution must be capped in (0, 1]');
  }
}

export function assertIndependentReimplementationReview(
  definition: SignalFeatureDefinition,
  review: FeatureRegistrationReview | undefined,
): void {
  const reviewedAt = review === undefined ? Number.NaN : Date.parse(review.reviewedAt);
  if (
    review === undefined ||
    review.independentlyReimplementable !== true ||
    !nonEmpty(review.reviewedBy) ||
    !Number.isFinite(reviewedAt) ||
    !nonEmpty(review.rationale)
  ) {
    throw new SignalRegistryError(
      SignalRegistryErrorCode.REIMPLEMENTATION_REVIEW_REQUIRED,
      `feature ${definition.featureId}@${definition.version} lacks an affirmative independent-reimplementation review`,
      { featureId: definition.featureId, version: definition.version },
    );
  }
}

type DefinitionRow = {
  feature_id: string;
  version: number;
  description: string;
  formula: string;
  input_fields: string[];
  unit: string;
  windows: string[];
  minimum_observations: number;
  null_policy: string;
  outlier_policy: string;
  update_policy: string;
  freshness_limit_seconds: number;
  cohort_definition_id: string | null;
  evidence_requirements: string[];
  minimum_denominator: number | null;
  is_numeric: boolean;
  stability_transform: string | null;
  shrinkage_policy: string | null;
  capped_contribution: number | string | null;
  outlier_policy_is_robust: boolean;
  cohort_fallback_policy_id: string | null;
  economic_event_required: boolean;
};

function rowDefinition(row: DefinitionRow): SignalFeatureDefinition {
  return {
    featureId: row.feature_id,
    version: Number(row.version),
    description: row.description,
    formula: row.formula,
    inputFields: row.input_fields,
    unit: row.unit,
    windows: row.windows,
    minimumObservations: Number(row.minimum_observations),
    nullPolicy: row.null_policy,
    outlierPolicy: row.outlier_policy,
    updatePolicy: row.update_policy,
    freshnessLimitSeconds: Number(row.freshness_limit_seconds),
    ...(row.cohort_definition_id === null ? {} : { cohortDefinitionId: row.cohort_definition_id }),
    evidenceRequirements: row.evidence_requirements,
    isNumeric: row.is_numeric,
    ...(row.minimum_denominator === null
      ? {}
      : { minimumDenominator: Number(row.minimum_denominator) }),
    ...(row.stability_transform === null ? {} : { stabilityTransform: row.stability_transform }),
    ...(row.shrinkage_policy === null ? {} : { shrinkagePolicy: row.shrinkage_policy }),
    ...(row.capped_contribution === null
      ? {}
      : { cappedContribution: Number(row.capped_contribution) }),
    outlierPolicyIsRobust: row.outlier_policy_is_robust,
    ...(row.cohort_fallback_policy_id === null
      ? {}
      : { cohortFallbackPolicyId: row.cohort_fallback_policy_id }),
    economicEventRequired: row.economic_event_required,
  };
}

function normalizedDefinition(definition: SignalFeatureDefinition): SignalFeatureDefinition {
  return {
    ...definition,
    isNumeric: definition.isNumeric ?? true,
    economicEventRequired: definition.economicEventRequired ?? false,
  };
}

export async function getFeatureDefinition(
  engine: DatabaseEngine,
  featureId: string,
  version: number,
): Promise<SignalFeatureDefinition | undefined> {
  const result = await engine.query<DefinitionRow>(
    'SELECT * FROM sig.feature_definitions WHERE feature_id = $1 AND version = $2',
    [featureId, version],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : rowDefinition(row);
}

/**
 * Registers one immutable definition version. Replaying identical content is
 * idempotent; any content drift at the same key is a loud refusal.
 */
export async function registerFeatureDefinition(
  engine: DatabaseEngine,
  definition: SignalFeatureDefinition,
  review: FeatureRegistrationReview,
): Promise<FeatureRegistrationResult> {
  assertFeatureDefinitionComplete(definition);
  assertIndependentReimplementationReview(definition, review);
  const normalized = normalizedDefinition(definition);
  const inserted = await engine.query<{ feature_id: string }>(
    `INSERT INTO sig.feature_definitions (
       feature_id, version, description, formula, input_fields, unit, windows,
       minimum_observations, null_policy, outlier_policy, update_policy,
       freshness_limit_seconds, cohort_definition_id, evidence_requirements,
       minimum_denominator, is_numeric, stability_transform, shrinkage_policy,
       capped_contribution, outlier_policy_is_robust, cohort_fallback_policy_id,
       economic_event_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (feature_id, version) DO NOTHING
     RETURNING feature_id`,
    [
      definition.featureId,
      definition.version,
      definition.description,
      definition.formula,
      [...definition.inputFields],
      definition.unit,
      [...definition.windows],
      definition.minimumObservations,
      definition.nullPolicy,
      definition.outlierPolicy,
      definition.updatePolicy,
      definition.freshnessLimitSeconds,
      definition.cohortDefinitionId ?? null,
      [...definition.evidenceRequirements],
      definition.minimumDenominator ?? null,
      normalized.isNumeric,
      definition.stabilityTransform ?? null,
      definition.shrinkagePolicy ?? null,
      definition.cappedContribution ?? null,
      definition.outlierPolicyIsRobust,
      definition.cohortFallbackPolicyId ?? null,
      normalized.economicEventRequired,
    ],
  );
  if (inserted.rows.length === 1) return 'CREATED';

  const existing = await getFeatureDefinition(engine, definition.featureId, definition.version);
  if (existing !== undefined && canonicalJson(existing) === canonicalJson(normalized)) {
    return 'UNCHANGED';
  }
  throw new SignalRegistryError(
    SignalRegistryErrorCode.VERSION_DRIFT,
    `feature definition ${definition.featureId}@${definition.version} already exists with different content; register a new version`,
    { featureId: definition.featureId, version: definition.version },
  );
}
