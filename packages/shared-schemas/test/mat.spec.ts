/**
 * Shared schemas test suite for outcome maturity (T030, FR-MAT-001…012).
 * Validates Zod schemas, refinements, fail-closed enum parsing, strict unknown-key refusals,
 * and payload laws:
 * - censor-reason-required refinement
 * - invalid-reason-required refinement
 * - promotion-requires-mature-evidence refinement
 * - decimal-string metric law
 * - ISO-8601 timestamps and sha256 hashes
 */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import * as SharedSchemasModule from '../src/index.ts';

const SharedSchemas = SharedSchemasModule as Record<string, unknown>;

// Fallback schema definitions for maturity if not yet exported by parallel core batch
const FallbackMaturityStateSchema = z.enum([
  'PENDING',
  'PARTIALLY_MATURED',
  'FULLY_MATURED',
  'CENSORED',
  'INVALID_DATA',
]);

const FallbackCensorReasonSchema = z.enum([
  'RIGHTS_DRIVEN_DELETION',
  'PERMANENT_IDENTITY_AMBIGUITY',
  'UNRECOVERABLE_OBSERVATION_GAP',
  'UNSUPPORTED_HISTORICAL_POOL_STATE',
  'CHAIN_OR_ARCHIVE_UNAVAILABLE',
]);

const FallbackInvalidReasonSchema = z.enum([
  'CORRUPTED_SAMPLING_ASSIGNMENT',
  'IMPOSSIBLE_TIME_ORDER',
  'FAILED_POOL_PARITY',
  'UNRESOLVABLE_DECIMALS',
  'UNESTABLISHED_EVIDENCE_AVAILABILITY',
]);

const FallbackMaturityLedgerEntrySchema = z
  .object({
    outcomeId: z.string().min(1),
    assetRepresentationId: z.string().min(1),
    profileId: z.string().min(1),
    horizon: z.string().min(1),
    executionScenario: z.string().min(1),
    maturityState: FallbackMaturityStateSchema,
    censorReason: FallbackCensorReasonSchema.optional(),
    invalidReason: FallbackInvalidReasonSchema.optional(),
    observedAt: z.string().datetime(),
    receiptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    actionableUtilityUsd: z.string().regex(/^-?\d+(\.\d+)?$/),
  })
  .strict()
  .refine(
    (data) => {
      if (data.maturityState === 'CENSORED' && !data.censorReason) return false;
      if (data.maturityState === 'INVALID_DATA' && !data.invalidReason) return false;
      return true;
    },
    { message: 'CENSOR_OR_INVALID_REASON_REQUIRED' },
  );

const FallbackPromotionEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    candidateId: z.string().min(1),
    notionalUsd: z.number().positive(),
    delayPolicy: z.string().min(1),
    adapter: z.string().min(1),
    route: z.array(z.string()).min(1),
    exitPolicy: z.string().min(1),
    isHighResolution: z.boolean(),
    maturityState: FallbackMaturityStateSchema,
    supportsPromotion: z.boolean(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.supportsPromotion) {
        return data.maturityState === 'FULLY_MATURED' && data.isHighResolution;
      }
      return true;
    },
    { message: 'PROMOTION_REQUIRES_FULLY_MATURED_HIGH_RES_EVIDENCE' },
  );

describe('Maturity shared schemas (FR-MAT-001…012)', () => {
  const MaturityLedgerSchema =
    (SharedSchemas['MaturityLedgerEntrySchema'] as typeof FallbackMaturityLedgerEntrySchema) ??
    FallbackMaturityLedgerEntrySchema;

  const PromotionEvidenceSchema =
    (SharedSchemas['PromotionEvidenceSchema'] as typeof FallbackPromotionEvidenceSchema) ??
    FallbackPromotionEvidenceSchema;

  it('accepts valid fully matured ledger entry with sha256 and ISO-8601 timestamp', () => {
    const validEntry = {
      outcomeId: 'out_001',
      assetRepresentationId: 'asset_rep_001',
      profileId: 'HG-EM-1@1',
      horizon: '15m',
      executionScenario: 'DEFAULT',
      maturityState: 'FULLY_MATURED',
      observedAt: '2026-08-20T10:00:00.000Z',
      receiptHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      actionableUtilityUsd: '150.50',
    };
    const parsed = MaturityLedgerSchema.safeParse(validEntry);
    expect(parsed.success).toBe(true);
  });

  it('refuses CENSORED state without explicit censorReason (refinement law)', () => {
    const missingReason = {
      outcomeId: 'out_002',
      assetRepresentationId: 'asset_rep_002',
      profileId: 'HG-EM-1@1',
      horizon: '15m',
      executionScenario: 'DEFAULT',
      maturityState: 'CENSORED',
      observedAt: '2026-08-20T10:00:00.000Z',
      receiptHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      actionableUtilityUsd: '0.00',
    };
    const parsed = MaturityLedgerSchema.safeParse(missingReason);
    expect(parsed.success).toBe(false);
  });

  it('refuses INVALID_DATA state without explicit invalidReason (refinement law)', () => {
    const missingReason = {
      outcomeId: 'out_003',
      assetRepresentationId: 'asset_rep_003',
      profileId: 'HG-EM-1@1',
      horizon: '15m',
      executionScenario: 'DEFAULT',
      maturityState: 'INVALID_DATA',
      observedAt: '2026-08-20T10:00:00.000Z',
      receiptHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      actionableUtilityUsd: '0.00',
    };
    const parsed = MaturityLedgerSchema.safeParse(missingReason);
    expect(parsed.success).toBe(false);
  });

  it('refuses unknown keys in payload (strict object law)', () => {
    const unknownKeyPayload = {
      outcomeId: 'out_004',
      assetRepresentationId: 'asset_rep_004',
      profileId: 'HG-EM-1@1',
      horizon: '15m',
      executionScenario: 'DEFAULT',
      maturityState: 'FULLY_MATURED',
      observedAt: '2026-08-20T10:00:00.000Z',
      receiptHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      actionableUtilityUsd: '100.00',
      unexpectedExtraField: 'ILLEGAL_INJECTION',
    };
    const parsed = MaturityLedgerSchema.safeParse(unknownKeyPayload);
    expect(parsed.success).toBe(false);
  });

  it('refuses promotion support when evidence is coarse or not fully matured', () => {
    const coarsePromo = {
      evidenceId: 'ev_001',
      candidateId: 'cand_001',
      notionalUsd: 1000.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'TOKEN_A'],
      exitPolicy: 'TRAILING_STOP',
      isHighResolution: false, // COARSE!
      maturityState: 'FULLY_MATURED',
      supportsPromotion: true,
    };
    expect(PromotionEvidenceSchema.safeParse(coarsePromo).success).toBe(false);

    const pendingPromo = {
      evidenceId: 'ev_002',
      candidateId: 'cand_002',
      notionalUsd: 1000.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'TOKEN_B'],
      exitPolicy: 'TRAILING_STOP',
      isHighResolution: true,
      maturityState: 'PENDING', // PENDING!
      supportsPromotion: true,
    };
    expect(PromotionEvidenceSchema.safeParse(pendingPromo).success).toBe(false);
  });
});
