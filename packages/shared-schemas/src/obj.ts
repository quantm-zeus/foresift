/** Runtime schemas for objective governance (FR-OBJ-001…010). */
import { z } from 'zod';
import {
  ALL_CLAIM_SCOPE_FIELDS,
  ALL_CLUSTER_DEFINITIONS,
  ALL_COMPARISON_DIMENSIONS,
  ALL_DELAY_SCENARIOS,
  ALL_DIAGNOSTIC_KINDS,
  ALL_HARD_CONSTRAINT_KINDS,
  ALL_HARD_CONSTRAINT_VERDICTS,
  ALL_INTEGRITY_SIGNAL_KINDS,
  ALL_INTEGRITY_VERDICTS,
  ALL_INTERVAL_METHODS,
  ALL_PROHIBITED_CLAIM_KINDS,
  ALL_PROMOTION_VERDICTS,
  ALL_RUN_COMPARABILITIES,
  ALL_SENSITIVITY_DIMENSIONS,
  ALL_UTILITY_LINE_KINDS,
  UNCERTAINTY_DISCLOSURE_TEXT,
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

export const OBJ_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const signedDecimal = z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const unsignedDecimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const contentAddress = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const domainEnum = <T extends string>(values: readonly [T, ...T[]] | readonly T[]) =>
  z.enum([...values] as [T, ...T[]]);

/** Closed-vocabulary object shapes without restating member lists. */
const shapeFrom = <K extends string, V>(keys: readonly K[], build: (key: K) => V): Record<K, V> => {
  const shape = {} as Record<K, V>;
  for (const key of keys) shape[key] = build(key);
  return shape;
};

/**
 * Exact decimal-string comparison without binary floating point: scale
 * every operand to 1e12 and compare bigints. Rejects fraction precision
 * beyond 1e12 rather than rounding silently.
 */
function decimalToPicoUnits(value: string): bigint | null {
  const match = /^(-)?(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (match === null) return null;
  const negative = match[1] === '-';
  const whole = BigInt(match[2] as string);
  const fraction = (match[3] ?? '').padEnd(12, '0');
  if (fraction.length > 12) return null;
  const scaled = whole * 1000000000000n + BigInt(fraction);
  return negative ? -scaled : scaled;
}

const requireAll = <T extends string>(
  values: readonly T[],
  seen: readonly (T | undefined)[] | Record<string, unknown>,
  context: z.RefinementCtx,
  message: string,
): void => {
  const present =
    seen instanceof Array ? seen : values.map((value) => (seen as Record<string, unknown>)[value]);
  const missing = values.filter((_value, index) => present[index] === undefined);
  if (missing.length > 0)
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${message}: ${missing.join(',')}` });
};

export const ObjectiveRunSchema = z
  .object({
    runId: id,
    configContentHash: contentAddress,
    schemaRegistryVersion: z.literal(OBJ_SCHEMA_REGISTRY_VERSION),
    candidateUniverseId: id,
    candidateUniverseHash: contentAddress,
    populationClaimId: id,
    capitalMicros: unsignedDecimal,
    windowStart: UtcTimestampSchema,
    windowEnd: UtcTimestampSchema,
    executionScenarioId: id,
    executionScenarioVersion: id,
    delayPolicyId: id,
    delayPolicyVersion: id,
    dataCutoff: UtcTimestampSchema,
    correlatedExposureConstraints: z.array(id),
    comparability: domainEnum(ALL_RUN_COMPARABILITIES),
    exploratoryReason: z.string().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.windowEnd) <= Date.parse(value.windowStart))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEnd'],
        message: 'objective window must be ordered',
      });
    if (value.comparability === 'EXPLORATORY_ONLY' && value.exploratoryReason === null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exploratoryReason'],
        message: 'exploratory runs must state why they cannot promote',
      });
    if (value.comparability === 'COMPARABLE' && value.exploratoryReason !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exploratoryReason'],
        message: 'comparable runs carry no exploratory reason',
      });
  });

const utilityLinesShape = shapeFrom(ALL_UTILITY_LINE_KINDS, () => signedDecimal);

export const UtilityReportSchema = z
  .object({
    runId: id,
    capitalDay: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    schemaRegistryVersion: z.literal(OBJ_SCHEMA_REGISTRY_VERSION),
    lines: z.object(utilityLinesShape).strict(),
    netUtility: signedDecimal,
    consumedEssReference: id,
    intervalMethod: domainEnum(ALL_INTERVAL_METHODS),
    clusterDefinition: domainEnum(ALL_CLUSTER_DEFINITIONS),
    computedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    requireAll(ALL_UTILITY_LINE_KINDS, value.lines, context, 'twelve decomposition lines required');
    const scaled = ALL_UTILITY_LINE_KINDS.map((kind) => decimalToPicoUnits(value.lines[kind]));
    const net = decimalToPicoUnits(value.netUtility);
    if (scaled.some((entry) => entry === null) || net === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['netUtility'],
        message: 'utility decimals must be exact to 1e12',
      });
      return;
    }
    const total = (scaled as bigint[]).reduce((left, right) => left + right, 0n);
    if (total !== net)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['netUtility'],
        message: 'twelve lines must sum exactly to net',
      });
  });

export const IntegrityIncidentSchema = z
  .object({
    incidentId: id,
    runId: id,
    signal: domainEnum(ALL_INTEGRITY_SIGNAL_KINDS),
    verdict: domainEnum(ALL_INTEGRITY_VERDICTS),
    reason: z.string().nullable(),
    evidenceRefs: z.array(id),
    recordedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verdict === 'FAIL_BLOCKS_PROMOTION') {
      if (value.reason === null)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'blocking verdicts require a reason',
        });
      if (value.evidenceRefs.length === 0)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['evidenceRefs'],
          message: 'blocking verdicts require evidence refs',
        });
    }
    if (value.verdict === 'PASS' && value.reason !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'passing verdicts carry no reason',
      });
  });

export const ClaimScopeSchema = z
  .object({
    scopeId: id,
    runId: id,
    supportedPopulation: id,
    profile: id,
    policy: id,
    executionScenario: id,
    delayDistribution: id,
    calendarInterval: id,
    marketRegimes: z.array(id).min(1),
    capabilityState: id,
    sampleSize: z.number().int().min(1),
    clusterEffectiveSampleSize: z.number().finite().positive(),
    uncertaintyMethod: domainEnum(ALL_INTERVAL_METHODS),
  })
  .strict()
  .superRefine((value, context) => {
    requireAll(ALL_CLAIM_SCOPE_FIELDS, value, context, 'eleven claim-scope fields required');
    if (!(value.clusterEffectiveSampleSize <= value.sampleSize))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clusterEffectiveSampleSize'],
        message: 'cluster effective sample size cannot exceed sample size',
      });
  });

const delayEvidenceShape = shapeFrom(ALL_DELAY_SCENARIOS, () =>
  z.object({ evidenced: z.boolean(), passed: z.boolean() }).strict(),
);

export const DelayEvidenceSchema = z
  .object({
    runId: id,
    results: z.object(delayEvidenceShape).strict(),
    declaredGate: z.array(domainEnum(ALL_DELAY_SCENARIOS)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    requireAll(ALL_DELAY_SCENARIOS, value.results, context, 'three delay scenarios required');
  });

// ObjectivePromotionDecision* (not PromotionDecision*): the discovery
// package already lands PromotionDecisionSchema/PromotionDecision for the
// cheap-monitor verdict, and the telemetry catalog pins promoted fields to
// that shape — the obj run-verdict concept takes the Objective- prefix.
export const ObjectivePromotionDecisionSchema = z
  .object({
    decisionId: id,
    runId: id,
    verdict: domainEnum(ALL_PROMOTION_VERDICTS),
    gateTrail: z
      .array(
        z
          .object({
            stage: id,
            outcome: domainEnum(['PASS', 'FAIL', 'REFUSE'] as const),
            evidenceRef: id.nullable(),
          })
          .strict(),
      )
      .min(1),
    decidedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const blocked = value.gateTrail.some((entry) => entry.outcome !== 'PASS');
    if (value.verdict === 'PROMOTE' && blocked)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdict'],
        message: 'promotion requires every gate stage to pass',
      });
    if (value.verdict === 'BLOCK' && !blocked)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdict'],
        message: 'blocking verdicts require a failing gate stage',
      });
  });

export const HardConstraintEvaluationSchema = z
  .object({
    runId: id,
    evaluations: z
      .object(shapeFrom(ALL_HARD_CONSTRAINT_KINDS, () => domainEnum(ALL_HARD_CONSTRAINT_VERDICTS)))
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    requireAll(
      ALL_HARD_CONSTRAINT_KINDS,
      value.evaluations,
      context,
      'seven hard constraints required',
    );
  });

export const DiagnosticReportSchema = z
  .object({
    runId: id,
    diagnostics: z
      .object(
        shapeFrom(ALL_DIAGNOSTIC_KINDS, () =>
          z
            .object({
              numerator: z.number().int().nonnegative(),
              denominator: z.number().int().positive(),
            })
            .strict(),
        ),
      )
      .strict(),
    diagnosticOnly: z.literal(true),
    computedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    requireAll(ALL_DIAGNOSTIC_KINDS, value.diagnostics, context, 'four diagnostics required');
  });

export const SensitivityGridSchema = z
  .object({
    gridId: id,
    runId: id,
    parentContentHash: contentAddress,
    dimensions: z.array(domainEnum(ALL_SENSITIVITY_DIMENSIONS)).min(1),
    points: z
      .array(
        z
          .object({
            dimension: domainEnum(ALL_SENSITIVITY_DIMENSIONS),
            basisPoints: z.number().int().positive(),
            lowerBoundUtilityMicros: signedDecimal,
          })
          .strict(),
      )
      .min(1),
    computedAt: UtcTimestampSchema,
  })
  .strict();

export const OutputLanguageScreenSchema = z
  .object({
    screenId: id,
    outputId: id,
    prohibitedClaimsFound: z.array(domainEnum(ALL_PROHIBITED_CLAIM_KINDS)),
    disclosure: z.string().min(1),
    screenPassed: z.boolean(),
    screenedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.disclosure.includes(UNCERTAINTY_DISCLOSURE_TEXT))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disclosure'],
        message: 'screened outputs must carry the research-signal disclosure',
      });
    if (value.screenPassed && value.prohibitedClaimsFound.length > 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['screenPassed'],
        message: 'screens finding prohibited claims cannot pass',
      });
    if (
      !value.screenPassed &&
      value.prohibitedClaimsFound.length === 0 &&
      value.disclosure.includes(UNCERTAINTY_DISCLOSURE_TEXT)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['screenPassed'],
        message: 'clean disclosed screens must pass',
      });
  });

export const ObjectiveComparisonSchema = z
  .object({
    leftRunId: id,
    rightRunId: id,
    dimensions: z.object(shapeFrom(ALL_COMPARISON_DIMENSIONS, () => id)).strict(),
    verdict: domainEnum(ALL_RUN_COMPARABILITIES),
  })
  .strict();

export type ObjectiveRun = z.infer<typeof ObjectiveRunSchema>;
export type UtilityReport = z.infer<typeof UtilityReportSchema>;
export type IntegrityIncident = z.infer<typeof IntegrityIncidentSchema>;
export type ClaimScopeRecord = z.infer<typeof ClaimScopeSchema>;
export type DelayEvidence = z.infer<typeof DelayEvidenceSchema>;
export type ObjectivePromotionDecision = z.infer<typeof ObjectivePromotionDecisionSchema>;
export type HardConstraintEvaluation = z.infer<typeof HardConstraintEvaluationSchema>;
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;
export type SensitivityGrid = z.infer<typeof SensitivityGridSchema>;
export type OutputLanguageScreen = z.infer<typeof OutputLanguageScreenSchema>;
export type ObjectiveComparison = z.infer<typeof ObjectiveComparisonSchema>;
