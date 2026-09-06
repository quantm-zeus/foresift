/**
 * §64.4 state-completeness assessment and §64.5 read-only route aggregation
 * (FR-EXEC-002, FR-EXEC-005, FR-EXEC-014, FR-EXEC-020, AC-232).
 *
 * Missing tick/bin/curve/account state that can materially affect a fill
 * marks the state incomplete and blocks confirmed tradability rather than
 * assuming uniform liquidity. Route evaluation avoids shared-vault double
 * counting, detects loops, caps complexity, tracks quote conversion/depeg,
 * and refuses transaction-construction payloads from quote providers.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import type { CoverageAssessment, DecodedPoolState } from './adapter-contract.ts';

/** Families whose absence materially affects any fill (AC-232). */
const ALWAYS_MATERIAL_FAMILIES: readonly string[] = ['Pool', 'Vault0', 'Vault1', 'Mint0', 'Mint1'];

/** CLMM/DLMM families that are material only for those designs. */
const CONDITIONALLY_MATERIAL_FAMILIES: readonly string[] = [
  'TickArray',
  'BinArray',
  'Position',
  'CurveState',
];

export interface AssessStateCompletenessInput {
  readonly decoded: DecodedPoolState;
  /** Account families actually decoded and available for the fill. */
  readonly availableAccountFamilies: readonly string[];
  /** Pool designs using ticks/bins/positions must declare them here. */
  readonly requiresConditionalFamilies: boolean;
  /** Simulated notional; tiny notionals still need reserves (AC-232). */
  readonly notionalUsd: string;
}

/**
 * §64.4 coverage assessment: missing required accounts or unsupported
 * program/layout is reported as incomplete — never silently downgraded.
 *
 * Fail-closed input law: the decoded record must carry its adapter identity
 * and a valid completeness verdict; `notionalUsd` must be a decimal digit
 * string (AC-232 blocking applies at every notional — tiny notionals still
 * need reserves, so the amount can never downgrade a missing family).
 */
export function assessStateCompleteness(input: AssessStateCompletenessInput): CoverageAssessment {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, input);
  }
  if (typeof input.decoded !== 'object' || input.decoded === null) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, input.decoded);
  }
  if (
    input.decoded.stateCompleteness !== 'COMPLETE' &&
    input.decoded.stateCompleteness !== 'INCOMPLETE_BLOCKING'
  ) {
    throw new ExecVocabularyError(
      ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID,
      input.decoded.stateCompleteness,
    );
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input.notionalUsd)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, input.notionalUsd);
  }
  if (!Array.isArray(input.availableAccountFamilies)) {
    throw new ExecVocabularyError(
      ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID,
      input.availableAccountFamilies,
    );
  }
  const available = new Set(input.availableAccountFamilies);
  const missing: string[] = [];
  for (const family of ALWAYS_MATERIAL_FAMILIES) {
    if (!available.has(family)) missing.push(family);
  }
  if (input.requiresConditionalFamilies) {
    for (const family of CONDITIONALLY_MATERIAL_FAMILIES) {
      if (family === 'CurveState') continue;
      if (!available.has(family)) missing.push(family);
    }
  }
  const incomplete =
    missing.length > 0 || input.decoded.stateCompleteness === 'INCOMPLETE_BLOCKING';
  return {
    stateCompleteness: incomplete ? 'INCOMPLETE_BLOCKING' : 'COMPLETE',
    missingAccountFamilies: missing,
    materialToFill: missing.length > 0,
    uncertaintyBound: missing.length === 0 ? null : Math.min(1, 0.25 * missing.length),
  };
}

// ---------------------------------------------------------------------------
// §64.5 canonical route and fragmentation
// ---------------------------------------------------------------------------

export interface RouteLeg {
  readonly legId: string;
  readonly poolId: string;
  readonly vaultIds: readonly string[];
  readonly feeBps: number;
  readonly priceImpactBps: number;
  readonly inTokenMint: string;
  readonly outTokenMint: string;
}

export interface QuoteConversion {
  readonly sourceId: string;
  readonly quotedAt: string;
  /** Stablecoin depeg state for the quote asset (§64.5). */
  readonly depegState: 'NONE' | 'WATCH' | 'DEPEGGED';
}

export interface RouteEvaluation {
  readonly aggregateImpactBps: number;
  readonly aggregateFeeBps: number;
  readonly legs: readonly RouteLeg[];
  readonly sharedVaultIds: readonly string[];
  readonly quoteConversion: QuoteConversion | null;
  readonly routeComplexity: number;
}

export interface EvaluateRouteInput {
  readonly legs: readonly RouteLeg[];
  readonly quoteConversion?: QuoteConversion;
  /** Maximum route legs allowed (§64.5 route complexity cap). */
  readonly maxLegs?: number;
  /** A quote provider payload, when the caller attempted to pass one. */
  readonly transactionPayloadFromProvider?: unknown;
}

function requireLegField(value: unknown, label: string, legId: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ROUTE_LEG_FIELD_INVALID',
      field: label,
      legId,
    });
  }
  return value;
}

function detectSharedVaults(legs: readonly RouteLeg[]): string[] {
  const seen = new Map<string, number>();
  for (const leg of legs) {
    for (const vault of leg.vaultIds) {
      seen.set(vault, (seen.get(vault) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([vault]) => vault);
}

function detectLoop(legs: readonly RouteLeg[]): boolean {
  const visited = new Set<string>();
  for (const leg of legs) {
    const key = `${leg.inTokenMint}->${leg.outTokenMint}@${leg.poolId}`;
    if (visited.has(key)) return true;
    visited.add(key);
  }
  return false;
}

/**
 * Evaluate a read-only aggregate route: per-leg fees and impact compound,
 * shared vaults are identified (never double counted downstream), loops and
 * over-complex routes are refused, and provider transaction payloads are
 * refused outright (§64.5, INV-001).
 */
export function evaluateRoute(input: EvaluateRouteInput): RouteEvaluation {
  if (input.transactionPayloadFromProvider !== undefined) {
    // §64.5/FR-EXEC-005: reject transaction-construction payloads from quote
    // providers — evidence channels never become execution channels.
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'TRANSACTION_PAYLOAD_FROM_QUOTE_PROVIDER',
    });
  }
  if (input === null || typeof input !== 'object' || !Array.isArray(input.legs)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  const maxLegs = input.maxLegs ?? 5;
  if (!Number.isInteger(maxLegs) || maxLegs < 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ROUTE_COMPLEXITY_CAP_INVALID',
      maxLegs,
    });
  }
  for (const leg of input.legs) {
    if (leg === null || typeof leg !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, leg);
    }
    requireLegField(leg.legId, 'legId', String(leg.legId));
    requireLegField(leg.poolId, 'poolId', leg.legId);
    requireLegField(leg.inTokenMint, 'inTokenMint', leg.legId);
    requireLegField(leg.outTokenMint, 'outTokenMint', leg.legId);
    if (!Array.isArray(leg.vaultIds) || leg.vaultIds.length === 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ROUTE_LEG_VAULTS_REQUIRED',
        legId: leg.legId,
      });
    }
    if (
      !Number.isInteger(leg.feeBps) ||
      leg.feeBps < 0 ||
      !Number.isInteger(leg.priceImpactBps) ||
      leg.priceImpactBps < 0
    ) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ROUTE_LEG_BPS_INVALID',
        legId: leg.legId,
        feeBps: leg.feeBps,
        priceImpactBps: leg.priceImpactBps,
      });
    }
  }
  if (input.quoteConversion !== undefined) {
    const qc = input.quoteConversion;
    if (
      qc === null ||
      typeof qc !== 'object' ||
      typeof qc.sourceId !== 'string' ||
      qc.sourceId.length === 0 ||
      typeof qc.quotedAt !== 'string' ||
      !/Z$/.test(qc.quotedAt) ||
      !['NONE', 'WATCH', 'DEPEGGED'].includes(qc.depegState)
    ) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'QUOTE_CONVERSION_INVALID',
        quoteConversion: qc,
      });
    }
    if (qc.depegState === 'DEPEGGED') {
      // §64.5: a depegged quote asset cannot serve a fill decision — the
      // conversion difference is unbounded until the depeg resolves.
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'QUOTE_ASSET_DEPEGGED',
        sourceId: qc.sourceId,
        quotedAt: qc.quotedAt,
      });
    }
  }
  if (input.legs.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EMPTY_ROUTE',
    });
  }
  if (input.legs.length > maxLegs) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ROUTE_COMPLEXITY_CAP_EXCEEDED',
      legs: input.legs.length,
      maxLegs,
    });
  }
  if (detectLoop(input.legs)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ROUTE_LOOP_DETECTED',
    });
  }
  // Chain continuity: each leg's input must be the previous leg's output.
  for (let i = 1; i < input.legs.length; i += 1) {
    if (input.legs[i]?.inTokenMint !== input.legs[i - 1]?.outTokenMint) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ROUTE_PATH_INVALID',
        atLeg: i,
      });
    }
  }
  let fee = 0;
  let impact = 0;
  // Compound multiplicatively: (1-f1)(1-f2)... per leg.
  for (const leg of input.legs) {
    fee = 1 - (1 - fee) * (1 - leg.feeBps / 10_000);
    impact = 1 - (1 - impact) * (1 - leg.priceImpactBps / 10_000);
  }
  return {
    aggregateImpactBps: Math.round(impact * 10_000),
    aggregateFeeBps: Math.round(fee * 10_000),
    legs: input.legs,
    sharedVaultIds: detectSharedVaults(input.legs),
    quoteConversion: input.quoteConversion ?? null,
    routeComplexity: input.legs.length,
  };
}
