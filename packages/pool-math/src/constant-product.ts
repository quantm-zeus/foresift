/**
 * Exact deterministic constant-product math on BigInt raw amounts (FR-EXEC-015).
 *
 * Rounding-direction law: conservative for the trader — `quoteExactIn` rounds
 * the output DOWN, `quoteExactOut` rounds the required input UP, and fees are
 * taken before pricing. Usable ONLY for a verified constant-product pool (the
 * registry enforces family resolution; this module additionally refuses pools
 * that do not declare a constant-product curve).
 *
 * Traces: FR-EXEC-002, FR-EXEC-013, FR-EXEC-015, FR-EXEC-016, AC-230, AC-231.
 */
import { AdapterFamily } from '@foresift/domain';
import type {
  AccountRequirement,
  CoverageAssessment,
  DecodedPoolState,
  LiquidityMutationInput,
  PoolMathAdapter,
  QuoteExactInInput,
  QuoteExactOutInput,
  QuoteResult,
  RawAccountStateBundle,
} from './adapter-contract.ts';

/** Basis points for pool fees (fee applied to the input amount). */
export interface ConstantProductFeeConfig {
  /** Total fee in basis points charged on the input (e.g. 25 = 0.25%). */
  readonly feeBps: number;
}

/** Which side of the reserve pair the quote trades. */
export type ConstantProductDirection = 'ZERO_TO_ONE' | 'ONE_TO_ZERO';

export interface ConstantProductCurveState {
  readonly reserveZeroRaw: bigint;
  readonly reserveOneRaw: bigint;
}

/** Fixed rounding law guard: amounts must be positive. */
function requirePositive(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new RangeError(`${label} must be a positive bigint, got ${String(value)}`);
  }
  return value;
}

function requireBps(feeBps: number): number {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new RangeError(`feeBps must be an integer in [0, 10000], got ${feeBps}`);
  }
  return feeBps;
}

/** Apply the pool fee to the input: returns the amount that actually trades. */
export function applyFee(rawAmountIn: bigint, feeBps: number): bigint {
  requirePositive(rawAmountIn, 'rawAmountIn');
  const bps = requireBps(feeBps);
  return (rawAmountIn * (10_000n - BigInt(bps))) / 10_000n;
}

/**
 * Exact constant-product output for `amountIn` after fee, rounded DOWN
 * (conservative for output): `out = (in * rOut) / (rIn + in)`.
 */
export function constantProductOut(
  amountInAfterFee: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  requirePositive(amountInAfterFee, 'amountInAfterFee');
  requirePositive(reserveIn, 'reserveIn');
  requirePositive(reserveOut, 'reserveOut');
  return (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
}

/**
 * Exact constant-product input required for `amountOut`, rounded UP
 * (conservative for input): `in = ceil(rIn * out / (rOut - out))`.
 * Refuses amounts at or above the output reserve (would exhaust the pool).
 */
export function constantProductIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  requirePositive(amountOut, 'amountOut');
  requirePositive(reserveIn, 'reserveIn');
  requirePositive(reserveOut, 'reserveOut');
  if (amountOut >= reserveOut) {
    throw new RangeError('amountOut must be below the output reserve');
  }
  const numerator = reserveIn * amountOut;
  const denominator = reserveOut - amountOut;
  // Ceiling division: conservative for the trader.
  return (numerator + denominator - 1n) / denominator;
}

/** Upper bound on deliverable net output for a direction (the output reserve). */
function maxOutputReserve(
  curve: ConstantProductCurveState,
  direction: ConstantProductDirection,
): bigint {
  return direction === 'ZERO_TO_ONE' ? curve.reserveOneRaw : curve.reserveZeroRaw;
}

/**
 * Closed-form first estimate of the gross input for `exactOut`: invert the
 * fee, then require the pool to net-produce that gross output. This can
 * under-quote by a few raw units (two floor divisions lose value), so
 * `quoteExactOut` walks forward from here until the executed path delivers
 * at least the requested amount.
 */
function grossRequiredEstimate(
  netOut: bigint,
  feeBps: number,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  const bps = BigInt(feeBps);
  const grossForNet =
    (netOut * 10_000n) / (10_000n - bps) +
    ((netOut * 10_000n) % (10_000n - bps) === 0n ? 0n : 1n);
  return constantProductIn(grossForNet, reserveIn, reserveOut);
}

export function priceImpactBpsBeforeAfter(
  reserveIn: bigint,
  reserveOut: bigint,
  amountInAfterFee: bigint,
): number {
  // Boundary guard (FR-EXEC-015): raw reserves beyond the double range would
  // project to 0/Infinity and silently understate or corrupt the impact
  // reading. Amounts stay exact BigInt; the impact projection refuses instead
  // of reporting a number that cannot be trusted.
  const nReserveIn = Number(reserveIn);
  const nReserveOut = Number(reserveOut);
  const newIn = reserveIn + amountInAfterFee;
  const newOut = reserveOut - constantProductOut(amountInAfterFee, reserveIn, reserveOut);
  const nNewIn = Number(newIn);
  const nNewOut = Number(newOut);
  if (
    !Number.isFinite(nReserveIn) ||
    !Number.isFinite(nReserveOut) ||
    !Number.isFinite(nNewIn) ||
    !Number.isFinite(nNewOut)
  ) {
    throw new RangeError('price impact is not representable: reserves exceed the double range');
  }
  const spotBefore = nReserveOut / nReserveIn;
  const spotAfter = nNewOut / nNewIn;
  return Math.max(0, ((spotBefore - spotAfter) / spotBefore) * 10_000);
}

function decodeCurveState(poolState: DecodedPoolState): ConstantProductCurveState {
  const zero = poolState.reserves['0'];
  const one = poolState.reserves['1'];
  if (zero === undefined || one === undefined) {
    throw new RangeError('constant-product pool state requires reserves keyed "0" and "1"');
  }
  const curveKind = poolState.curveState['kind'];
  if (curveKind !== 'CONSTANT_PRODUCT') {
    // FR-EXEC-015: never pretend another design is constant product.
    throw new RangeError(`refusing non-constant-product curve state kind ${String(curveKind)}`);
  }
  return { reserveZeroRaw: BigInt(zero), reserveOneRaw: BigInt(one) };
}

function quoteDirection(
  input: { readonly inTokenMint: string; readonly outTokenMint: string },
  poolState: DecodedPoolState,
): ConstantProductDirection {
  const mintZero = poolState.curveState['mint0'];
  const mintOne = poolState.curveState['mint1'];
  if (mintZero === input.inTokenMint && mintOne === input.outTokenMint) {
    return 'ZERO_TO_ONE';
  }
  if (mintOne === input.inTokenMint && mintZero === input.outTokenMint) {
    return 'ONE_TO_ZERO';
  }
  throw new RangeError('quote mints do not match the pool reserve pair');
}

function feeBpsOf(poolState: DecodedPoolState): number {
  const fee = poolState.feeConfiguration['feeBps'];
  if (typeof fee !== 'number') {
    throw new RangeError('pool fee configuration must declare numeric feeBps');
  }
  return requireBps(fee);
}

/**
 * The single verified constant-product adapter. Its family is
 * `CONSTANT_PRODUCT_AMM`, so the registry will only resolve it for pools
 * whose signed manifest and curve state verified as constant product.
 */
export class ConstantProductAdapter implements PoolMathAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly chainId: string;
  readonly programId: string;
  readonly supportedProgramVersions: readonly string[];
  readonly curveTypes: readonly string[];
  readonly family = AdapterFamily.CONSTANT_PRODUCT_AMM;

  constructor(config: {
    readonly adapterId: string;
    readonly version: string;
    readonly chainId: string;
    readonly programId: string;
    readonly supportedProgramVersions: readonly string[];
    readonly curveTypes?: readonly string[];
  }) {
    this.adapterId = config.adapterId;
    this.version = config.version;
    this.chainId = config.chainId;
    this.programId = config.programId;
    this.supportedProgramVersions = [...config.supportedProgramVersions];
    this.curveTypes = config.curveTypes ?? ['CONSTANT_PRODUCT'];
  }

  decodeState(input: RawAccountStateBundle): DecodedPoolState {
    if (input.programId !== this.programId) {
      throw new RangeError(`account bundle program ${input.programId} does not match adapter`);
    }
    if (input.accounts.owner !== this.programId) {
      throw new RangeError('account bundle is not owned by the pool program');
    }
    // Decode is deterministic: the bundle must carry both reserve hashes and
    // the account data itself; incomplete bundles decode as incomplete.
    return {
      programId: input.programId,
      programVersion: input.programVersion,
      adapterId: this.adapterId,
      adapterVersion: this.version,
      reserves: Object.fromEntries(
        Object.entries((input as unknown as { reserves?: Record<string, string> }).reserves ?? {}),
      ),
      curveState: { kind: 'CONSTANT_PRODUCT' },
      feeConfiguration: {},
      stateCompleteness:
        (input as unknown as { reserves?: Record<string, string> }).reserves !== undefined
          ? 'COMPLETE'
          : 'INCOMPLETE_BLOCKING',
    };
  }

  validateStateCompleteness(state: DecodedPoolState): CoverageAssessment {
    const missing: string[] = [];
    if (state.reserves['0'] === undefined) missing.push('reserve0');
    if (state.reserves['1'] === undefined) missing.push('reserve1');
    if (state.feeConfiguration['feeBps'] === undefined) missing.push('feeBps');
    return {
      stateCompleteness: missing.length === 0 ? 'COMPLETE' : 'INCOMPLETE_BLOCKING',
      missingAccountFamilies: missing,
      materialToFill: missing.length > 0,
      uncertaintyBound: missing.length === 0 ? null : 1,
    };
  }

  quoteExactIn(input: QuoteExactInInput): QuoteResult {
    const curve = decodeCurveState(input.poolState);
    const direction = quoteDirection(input, input.poolState);
    const feeBps = feeBpsOf(input.poolState);
    requirePositive(input.rawAmountIn, 'rawAmountIn');
    const afterFee = applyFee(input.rawAmountIn, feeBps);
    const [reserveIn, reserveOut] =
      direction === 'ZERO_TO_ONE'
        ? [curve.reserveZeroRaw, curve.reserveOneRaw]
        : [curve.reserveOneRaw, curve.reserveZeroRaw];
    const out = constantProductOut(afterFee, reserveIn, reserveOut);
    return {
      rawAmountIn: input.rawAmountIn,
      rawAmountOut: out,
      feeRawAmount: input.rawAmountIn - afterFee,
      priceImpactBps: priceImpactBpsBeforeAfter(reserveIn, reserveOut, afterFee),
      minimumOutputRaw: null,
    };
  }

  quoteExactOut(input: QuoteExactOutInput): QuoteResult {
    const curve = decodeCurveState(input.poolState);
    const direction = quoteDirection(input, input.poolState);
    const feeBps = feeBpsOf(input.poolState);
    requirePositive(input.rawAmountOut, 'rawAmountOut');
    if (input.rawAmountOut >= maxOutputReserve(curve, direction)) {
      throw new RangeError('requested output at or above the output reserve');
    }
    const [reserveIn, reserveOut] =
      direction === 'ZERO_TO_ONE'
        ? [curve.reserveZeroRaw, curve.reserveOneRaw]
        : [curve.reserveOneRaw, curve.reserveZeroRaw];
    // The net output the trader demands. Because both the fee (floor) and the
    // output rounding (floor) lose value, a closed-form gross estimate
    // under-quotes: executing it would deliver LESS than the requested
    // amount. The conservative law requires the trader to receive at least
    // rawAmountOut, so resolve the smallest input whose full executed path
    // applyFee -> constantProductOut delivers >= the requested amount.
    let candidateIn = grossRequiredEstimate(input.rawAmountOut, feeBps, reserveIn, reserveOut);
    while (
      constantProductOut(applyFee(candidateIn, feeBps), reserveIn, reserveOut) < input.rawAmountOut
    ) {
      candidateIn += 1n;
    }
    const afterFee = applyFee(candidateIn, feeBps);
    const modeledOut = constantProductOut(afterFee, reserveIn, reserveOut);
    return {
      rawAmountIn: candidateIn,
      rawAmountOut: modeledOut,
      feeRawAmount: candidateIn - afterFee,
      priceImpactBps: priceImpactBpsBeforeAfter(reserveIn, reserveOut, afterFee),
      minimumOutputRaw: input.rawAmountOut,
    };
  }

  modelLiquidityMutation(input: LiquidityMutationInput): DecodedPoolState {
    const curve = decodeCurveState(input.poolState);
    const zeroDelta = input.rawAmounts['0'] ?? 0n;
    const oneDelta = input.rawAmounts['1'] ?? 0n;
    if (zeroDelta < 0n || oneDelta < 0n) {
      throw new RangeError('liquidity mutations use non-negative raw amounts');
    }
    const zero =
      input.mutation === 'ADD'
        ? curve.reserveZeroRaw + zeroDelta
        : curve.reserveZeroRaw - zeroDelta;
    const one =
      input.mutation === 'ADD' ? curve.reserveOneRaw + oneDelta : curve.reserveOneRaw - oneDelta;
    if (zero <= 0n || one <= 0n) {
      throw new RangeError('liquidity mutation would exhaust the pool');
    }
    return {
      ...input.poolState,
      reserves: { '0': zero.toString(), '1': one.toString() },
    };
  }

  requiredAccounts(): readonly AccountRequirement[] {
    return [
      { accountFamily: 'Pool', required: true, purpose: 'reserves and fee configuration' },
      { accountFamily: 'Vault0', required: true, purpose: 'token-0 reserve balance' },
      { accountFamily: 'Vault1', required: true, purpose: 'token-1 reserve balance' },
      { accountFamily: 'Mint0', required: true, purpose: 'token-0 decimals/supply' },
      { accountFamily: 'Mint1', required: true, purpose: 'token-1 decimals/supply' },
    ];
  }
}
