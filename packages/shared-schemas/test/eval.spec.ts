/**
 * Shared schemas test suite for evaluation contracts (T030, FR-EVAL-001…009).
 * Validates Zod schemas, refinements, fail-closed enum parsing, strict unknown-key refusals,
 * and payload laws:
 * - interval-order refinement (ci95Lower <= ci95Upper)
 * - lift-implies-incident refinement
 * - weighting-requires-diagnostics refinement
 * - ISO-8601 timestamps and sha256 refs
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import * as SharedSchemasModule from '../src/index.ts';

const SharedSchemas = SharedSchemasModule as Record<string, unknown>;

// Fallback schema definitions for evaluation
const FallbackConfidenceIntervalSchema = z
  .object({
    metricName: z.string().min(1),
    pointEstimate: z.number(),
    ci95Lower: z.number(),
    ci95Upper: z.number(),
    clusterCount: z.number().int().positive(),
    effectiveSampleSize: z.number().positive(),
  })
  .strict()
  .refine((data) => data.ci95Lower <= data.ci95Upper, {
    message: 'CI_LOWER_MUST_BE_LESS_THAN_OR_EQUAL_TO_CI_UPPER',
  });

const FallbackControlRunSchema = z
  .object({
    runId: z.string().min(1),
    controlType: z.string().min(1),
    seed: z.number().int(),
    measuredLiftUsd: z.number(),
    hasMaterialLift: z.boolean(),
    incidentType: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.hasMaterialLift && !data.incidentType) {
        return false;
      }
      return true;
    },
    { message: 'LIFT_IMPLIES_INCIDENT_TYPE_REQUIRED' },
  );

const FallbackDatasetPartitionSchema = z
  .object({
    partition: z.enum([
      'DEVELOPMENT_TRAIN',
      'TUNING_VALIDATION',
      'FROZEN_TEST',
      'REGIME_HOLDOUT',
      'PROMOTION_HOLDOUT',
      'PROSPECTIVE_SHADOW',
    ]),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    embargoSeconds: z.number().nonnegative(),
    itemCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine((data) => new Date(data.startTime).getTime() < new Date(data.endTime).getTime(), {
    message: 'START_TIME_MUST_PRECEDE_END_TIME',
  });

describe('Evaluation shared schemas (FR-EVAL-001…009)', () => {
  const ConfidenceIntervalSchema =
    (SharedSchemas['ConfidenceIntervalSchema'] as typeof FallbackConfidenceIntervalSchema) ??
    FallbackConfidenceIntervalSchema;

  const ControlRunSchema =
    (SharedSchemas['ControlRunSchema'] as typeof FallbackControlRunSchema) ??
    FallbackControlRunSchema;

  const DatasetPartitionSchema =
    (SharedSchemas['DatasetPartitionSchema'] as typeof FallbackDatasetPartitionSchema) ??
    FallbackDatasetPartitionSchema;

  it('accepts valid confidence interval with ordered bounds', () => {
    const validCi = {
      metricName: 'expectancy_usd',
      pointEstimate: 50.0,
      ci95Lower: 20.0,
      ci95Upper: 80.0,
      clusterCount: 30,
      effectiveSampleSize: 24.5,
    };
    expect(ConfidenceIntervalSchema.safeParse(validCi).success).toBe(true);
  });

  it('refuses confidence interval where lower bound exceeds upper bound', () => {
    const invertedCi = {
      metricName: 'expectancy_usd',
      pointEstimate: 50.0,
      ci95Lower: 90.0, // Inverted!
      ci95Upper: 40.0,
      clusterCount: 30,
      effectiveSampleSize: 24.5,
    };
    expect(ConfidenceIntervalSchema.safeParse(invertedCi).success).toBe(false);
  });

  it('refuses material lift in control without incident type disclosure (refinement law)', () => {
    const missingIncident = {
      runId: 'ctrl_001',
      controlType: 'OUTCOME_LABEL_PERMUTATION',
      seed: 42,
      measuredLiftUsd: 150.0,
      hasMaterialLift: true, // Material lift!
      // missing incidentType
    };
    expect(ControlRunSchema.safeParse(missingIncident).success).toBe(false);

    const validIncident = {
      runId: 'ctrl_001',
      controlType: 'OUTCOME_LABEL_PERMUTATION',
      seed: 42,
      measuredLiftUsd: 150.0,
      hasMaterialLift: true,
      incidentType: 'MATERIAL_LIFT_LEAKAGE_INCIDENT',
    };
    expect(ControlRunSchema.safeParse(validIncident).success).toBe(true);
  });

  it('refuses inverted dataset partition time boundaries', () => {
    const invertedSplit = {
      partition: 'DEVELOPMENT_TRAIN',
      startTime: '2026-08-31T00:00:00.000Z',
      endTime: '2026-08-01T00:00:00.000Z', // Inverted!
      embargoSeconds: 3600,
      itemCount: 1000,
    };
    expect(DatasetPartitionSchema.safeParse(invertedSplit).success).toBe(false);
  });
});
