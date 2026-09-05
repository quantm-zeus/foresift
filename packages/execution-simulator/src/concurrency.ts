/**
 * FR-EXEC-019 concurrent shadow-position aggregation (AC-236).
 *
 * Shadow positions sharing a pool, route, quote asset, liquidity source,
 * deployer cluster, or correlated exit window cannot each consume the same
 * depth in isolation. Aggregation groups positions by their sharing keys,
 * then runs a deterministic fill competition: requests are served in
 * lexicographic registration-id order against the pre-exit depth, each fill
 * moving the remaining depth, so the outcome is invariant to the order the
 * positions were submitted in (order-permutation determinism) and isolated
 * fills can never double-count shared depth.
 *
 * Traces: FR-EXEC-019, AC-236.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import type { ConcurrentShadowAggregate } from '@foresift/shared-schemas';

export type { ConcurrentShadowAggregate };

/** Sharing keys that force two shadow positions into one competition. */
export interface SharingKeys {
  readonly poolId: string;
  readonly routeId: string | null;
  readonly quoteAsset: string;
  readonly liquiditySourceId: string;
  readonly deployerClusterId: string | null;
  /** Correlated exit window identifier (e.g. slot-bucket key). */
  readonly exitWindowId: string;
}

export interface ShadowPositionRequest {
  /** Registration id — determines lexicographic fill priority. */
  readonly registrationId: string;
  readonly positionId: string;
  readonly keys: SharingKeys;
  /** Requested exit notional (USD decimal string). */
  readonly requestedExitUsd: string;
}

export interface ShadowPositionOutcome {
  readonly registrationId: string;
  readonly positionId: string;
  readonly requestedExitUsd: string;
  /** Notional actually filled after depth competition (USD decimal string). */
  readonly filledUsd: string;
  /** fillFraction = filled / requested (0 when requested is 0). */
  readonly fillFraction: number;
  /** True when the request could not fill at all (depth exhausted before it). */
  readonly rejected: boolean;
}

export interface ConcurrencyCompetitionResult {
  readonly aggregate: ConcurrentShadowAggregate;
  readonly outcomes: readonly ShadowPositionOutcome[];
  /** True when two or more positions contended for the same depth. */
  readonly depthCollisionDetected: boolean;
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function requireDecimal(value: string, label: string): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'CONCURRENCY_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'CONCURRENCY_FIELD_INVALID',
      field: label,
    });
  }
  return value;
}

/** Canonical grouping key over the sharing keys (deterministic ordering). */
export function sharingKeyOf(keys: SharingKeys): string {
  return [
    requireNonEmpty(keys.poolId, 'poolId'),
    keys.routeId ?? '',
    requireNonEmpty(keys.quoteAsset, 'quoteAsset'),
    requireNonEmpty(keys.liquiditySourceId, 'liquiditySourceId'),
    keys.deployerClusterId ?? '',
    requireNonEmpty(keys.exitWindowId, 'exitWindowId'),
  ].join('|');
}

/** Decimal string → scaled BigInt at the max scale of the inputs. */
function scaled(value: string, scale: number): bigint {
  const [i, f = ''] = value.split('.');
  return BigInt(i + f.padEnd(scale, '0').slice(0, Math.max(scale, f.length)));
}

function fromScaled(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  const fractionalPart = scale > 0 ? digits.slice(digits.length - scale).replace(/0+$/, '') : '';
  return fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;
}

/**
 * Run the deterministic depth competition for one sharing group. Requests
 * are served in lexicographic registration-id order; each fill reduces the
 * remaining pre-exit depth, so later positions compete against the depth
 * the earlier ones consumed.
 */
export function competeForDepth(input: {
  readonly aggregateId: string;
  /** Pre-exit depth available to the group (USD decimal string). */
  readonly preExitDepthUsd: string;
  /** Positions in the group (any submission order). */
  readonly positions: readonly ShadowPositionRequest[];
}): ConcurrencyCompetitionResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  const preExitDepthUsd = requireDecimal(input.preExitDepthUsd, 'preExitDepthUsd');
  if (!Array.isArray(input.positions) || input.positions.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'CONCURRENCY_POSITIONS_REQUIRED',
    });
  }
  const keys = new Set<string>();
  for (const position of input.positions) {
    if (position === null || typeof position !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'CONCURRENCY_POSITION_INVALID',
      });
    }
    requireNonEmpty(position.registrationId, 'registrationId');
    requireNonEmpty(position.positionId, 'positionId');
    requireDecimal(position.requestedExitUsd, 'requestedExitUsd');
    keys.add(sharingKeyOf(position.keys));
  }
  if (keys.size !== 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'CONCURRENCY_GROUP_MIXES_SHARING_KEYS',
    });
  }

  const scale = Math.max(
    preExitDepthUsd.includes('.') ? preExitDepthUsd.split('.')[1]?.length ?? 0 : 0,
    ...input.positions.map(
      (p) => (p.requestedExitUsd.includes('.') ? p.requestedExitUsd.split('.')[1]?.length ?? 0 : 0),
    ),
  );
  let remaining = scaled(preExitDepthUsd, scale);

  // Deterministic: lexicographic registration-id ordering, regardless of
  // the order positions arrived in.
  const ordered = [...input.positions].sort((a, b) =>
    a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0,
  );

  const outcomes: ShadowPositionOutcome[] = [];
  let filledTotal = 0n;
  let requestedTotal = 0n;
  let rejectedCount = 0;
  let collision = false;
  let priorConsumption = 0n;

  for (const position of ordered) {
    const requested = scaled(position.requestedExitUsd, scale);
    requestedTotal += requested;
    const filled = requested <= remaining ? requested : remaining;
    if (filled < requested && requested > 0n) {
      if (priorConsumption > 0n) collision = true;
      rejectedCount += filled === 0n ? 1 : 0;
    }
    if (priorConsumption > 0n && requested > 0n && filled < requested) collision = true;
    remaining -= filled;
    filledTotal += filled;
    const fillFraction =
      requested === 0n ? 0 : Number((filled * 10_000n) / requested) / 10_000;
    outcomes.push({
      registrationId: position.registrationId,
      positionId: position.positionId,
      requestedExitUsd: position.requestedExitUsd,
      filledUsd: fromScaled(filled, scale),
      fillFraction,
      rejected: filled === 0n && requested > 0n,
    });
    priorConsumption += filled;
  }

  const aggregatedFillFraction =
    requestedTotal === 0n ? 1 : Number((filledTotal * 10_000n) / requestedTotal) / 10_000;

  const groupKey = [...keys][0] ?? '';
  const [poolId = '', routeId, quoteAsset, liquiditySourceId, deployerClusterId, exitWindowId] =
    groupKey.split('|');
  void quoteAsset;
  void liquiditySourceId;
  void deployerClusterId;
  void exitWindowId;

  const aggregate: ConcurrentShadowAggregate = {
    aggregateId: input.aggregateId,
    poolId: poolId,
    routeId: routeId === '' ? null : (routeId ?? null),
    sharedLiquidityIdentifiers: [...keys],
    concurrentExitCount: input.positions.length,
    preExitDepthUsd,
    aggregatedRequestedExitsUsd: fromScaled(requestedTotal, scale),
    aggregatedFillFraction,
    rejectedExitCount: rejectedCount,
  };

  return { aggregate, outcomes, depthCollisionDetected: collision };
}
