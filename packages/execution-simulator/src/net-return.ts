/**
 * §64.9 net-return composition (FR-EXEC-003, FR-EXEC-018).
 *
 * Every modeled cost dimension is an explicit, required leg — pool fees,
 * aggregator fees, Token-2022 transfer fees, priority/network fees,
 * execution impact, failed attempts, partial-fill penalty, residual
 * inventory, adverse-selection/MEV buffer, quote-conversion depeg, and
 * account-creation rent. An omitted leg is structurally impossible (the
 * input type requires all of them) and refused at runtime; "assumed zero"
 * is never substituted for evidence. A leg that genuinely did not apply is
 * carried as the explicit string `'0'`, so the record always states the
 * assumption instead of leaving it implicit.
 *
 * Arithmetic is exact: decimal strings are parsed to scaled BigInt at the
 * common maximum scale, subtracted, and re-formatted canonically — no
 * floating-point in cost assembly.
 *
 * Traces: FR-EXEC-003, FR-EXEC-018, AC-121.
 */
import { isQualityCode } from '@foresift/domain';
import type { QualityCode } from '@foresift/domain';
import type { NetReturnBreakdown } from '@foresift/shared-schemas';

export type { NetReturnBreakdown };

/** Signed canonical decimal string (gross return may be negative). */
const SIGNED_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
/** Non-negative canonical decimal string (cost legs cannot be negative). */
const NON_NEGATIVE_DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Every §64.9 cost leg. All fields required — omission is a type error and
 * a runtime refusal, never a silent zero. */
export interface NetReturnInput {
  /** Gross return before any modeled cost (may be negative). */
  readonly grossReturnUsd: string;
  readonly poolFeesUsd: string;
  readonly aggregatorFeesUsd: string;
  readonly tokenTransferFeesUsd: string;
  readonly priorityNetworkFeesUsd: string;
  readonly executionImpactUsd: string;
  readonly failedAttemptsUsd: string;
  readonly partialFillPenaltyUsd: string;
  readonly residualInventoryUsd: string;
  readonly adverseSelectionMevBufferUsd: string;
  readonly quoteConversionDepegUsd: string;
  readonly accountCreationRentUsd: string;
  /** §13.9 quality codes carrying evidence status (ESTIMATED, PARTIAL…). */
  readonly qualityCodes: readonly QualityCode[];
}

/** The §64.9 legs in subtraction order, with their input field names. */
const COST_LEGS = [
  'poolFeesUsd',
  'aggregatorFeesUsd',
  'tokenTransferFeesUsd',
  'priorityNetworkFeesUsd',
  'executionImpactUsd',
  'failedAttemptsUsd',
  'partialFillPenaltyUsd',
  'residualInventoryUsd',
  'adverseSelectionMevBufferUsd',
  'quoteConversionDepegUsd',
  'accountCreationRentUsd',
] as const;

export type NetReturnCostLeg = (typeof COST_LEGS)[number];

class NetReturnInputInvalidError extends Error {
  constructor(
    readonly refused: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(`net-return input refused: ${refused}`);
    this.name = 'NetReturnInputInvalidError';
  }
}

function requireLeg(
  input: NetReturnInput,
  leg: NetReturnCostLeg | 'grossReturnUsd',
  signed: boolean,
): string {
  const value = input[leg];
  if (typeof value !== 'string') {
    throw new NetReturnInputInvalidError('NET_RETURN_LEG_MISSING', { leg, value });
  }
  const pattern = signed ? SIGNED_DECIMAL : NON_NEGATIVE_DECIMAL;
  if (!pattern.test(value)) {
    throw new NetReturnInputInvalidError('NET_RETURN_LEG_MALFORMED', { leg, value });
  }
  return value;
}

/** Decimal places in a canonical decimal string (0 for integers). */
function scaleOf(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** Parse a canonical decimal string to a BigInt scaled by `scale`. */
function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionalPart = ''] = unsigned.split('.');
  const paddedFraction = (fractionalPart + '0'.repeat(scale)).slice(0, scale);
  const scaled = BigInt(`${integerPart}${paddedFraction}`);
  return negative ? -scaled : scaled;
}

/** Format a scaled BigInt back to a canonical decimal string. */
function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  let fractionalPart = scale > 0 ? digits.slice(digits.length - scale) : '';
  fractionalPart = fractionalPart.replace(/0+$/, '');
  const sign = negative && value !== 0n ? '-' : '';
  return fractionalPart.length > 0
    ? `${sign}${integerPart}.${fractionalPart}`
    : `${sign}${integerPart}`;
}

/**
 * Compose the §64.9 net return: every leg validated, exact decimal
 * subtraction, quality codes fail-closed against the §13.9 vocabulary.
 */
export function composeNetReturn(input: NetReturnInput): NetReturnBreakdown {
  if (input === null || typeof input !== 'object') {
    throw new NetReturnInputInvalidError('NET_RETURN_INPUT_INVALID', { input });
  }
  const gross = requireLeg(input, 'grossReturnUsd', true);
  const legs: Record<NetReturnCostLeg, string> = {} as Record<NetReturnCostLeg, string>;
  for (const leg of COST_LEGS) {
    legs[leg] = requireLeg(input, leg, false);
  }
  for (const code of input.qualityCodes) {
    if (!isQualityCode(code)) {
      throw new NetReturnInputInvalidError('NET_RETURN_QUALITY_CODE_UNKNOWN', { code });
    }
  }

  const scale = Math.max(scaleOf(gross), ...COST_LEGS.map((leg) => scaleOf(legs[leg])));
  let net = toScaled(gross, scale);
  for (const leg of COST_LEGS) {
    net -= toScaled(legs[leg], scale);
  }

  return {
    grossReturnUsd: gross,
    poolFeesUsd: legs.poolFeesUsd,
    aggregatorFeesUsd: legs.aggregatorFeesUsd,
    tokenTransferFeesUsd: legs.tokenTransferFeesUsd,
    priorityNetworkFeesUsd: legs.priorityNetworkFeesUsd,
    executionImpactUsd: legs.executionImpactUsd,
    failedAttemptsUsd: legs.failedAttemptsUsd,
    partialFillPenaltyUsd: legs.partialFillPenaltyUsd,
    residualInventoryUsd: legs.residualInventoryUsd,
    adverseSelectionMevBufferUsd: legs.adverseSelectionMevBufferUsd,
    quoteConversionDepegUsd: legs.quoteConversionDepegUsd,
    accountCreationRentUsd: legs.accountCreationRentUsd,
    netReturnUsd: fromScaled(net, scale),
    qualityCodes: [...input.qualityCodes],
  };
}

/**
 * Verify a recorded breakdown's internal consistency: the recorded net must
 * equal gross minus the sum of the legs, exactly. Used when re-validating
 * stored payloads (replay, aggregation) — a tampered or drifted record is
 * refused rather than silently accepted.
 */
export function netReturnConsistent(breakdown: NetReturnBreakdown): boolean {
  try {
    const legs: NetReturnInput = {
      grossReturnUsd: breakdown.grossReturnUsd,
      poolFeesUsd: breakdown.poolFeesUsd,
      aggregatorFeesUsd: breakdown.aggregatorFeesUsd,
      tokenTransferFeesUsd: breakdown.tokenTransferFeesUsd,
      priorityNetworkFeesUsd: breakdown.priorityNetworkFeesUsd,
      executionImpactUsd: breakdown.executionImpactUsd,
      failedAttemptsUsd: breakdown.failedAttemptsUsd,
      partialFillPenaltyUsd: breakdown.partialFillPenaltyUsd,
      residualInventoryUsd: breakdown.residualInventoryUsd,
      adverseSelectionMevBufferUsd: breakdown.adverseSelectionMevBufferUsd,
      quoteConversionDepegUsd: breakdown.quoteConversionDepegUsd,
      accountCreationRentUsd: breakdown.accountCreationRentUsd,
      qualityCodes: breakdown.qualityCodes,
    };
    return composeNetReturn(legs).netReturnUsd === breakdown.netReturnUsd;
  } catch {
    return false;
  }
}
