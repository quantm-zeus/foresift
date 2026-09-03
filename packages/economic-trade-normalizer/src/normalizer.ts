import { createHash } from 'node:crypto';
import {
  ActorResolutionState,
  TradeSide,
  compareTimestamps,
  type UtcTimestamp,
} from '@foresift/domain';
import type {
  AuditableEconomicRouteLeg,
  EconomicTradeContext,
  NetActorDelta,
  NormalizedEconomicTradeEvent,
  PersistedEconomicLeg,
} from './types.ts';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`)
    .join(',')}}`;
}

function contentId(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
}

function rawInteger(value: string | undefined, field: string): bigint {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new RangeError(`${field} must be a canonical non-negative raw integer`);
  }
  return BigInt(value);
}

function maxTimestamp(values: readonly UtcTimestamp[]): UtcTimestamp {
  return values.reduce((latest, value) => (compareTimestamps(value, latest) > 0 ? value : latest));
}

function minTimestamp(values: readonly UtcTimestamp[]): UtcTimestamp {
  return values.reduce((earliest, value) =>
    compareTimestamps(value, earliest) < 0 ? value : earliest,
  );
}

function resolveAsset(asset: string, aliases: ReadonlyMap<string, string>): string {
  let current = asset;
  const visited = new Set<string>();
  while (aliases.has(current)) {
    if (visited.has(current)) throw new RangeError('cyclic asset migration mapping');
    visited.add(current);
    current = aliases.get(current)!;
  }
  return current;
}

function actorResolution(
  context: EconomicTradeContext,
  legs: readonly PersistedEconomicLeg[],
): ActorResolutionState {
  if (context.actorEntityId !== undefined && (context.actorAccounts?.length ?? 0) > 0) {
    return ActorResolutionState.RESOLVED;
  }
  const routers = new Set(context.knownRouterAccounts ?? []);
  const externalAccounts = new Set(
    legs.flatMap((leg) => [leg.fromAccount, leg.toAccount]).filter((a): a is string => !!a),
  );
  for (const router of routers) externalAccounts.delete(router);
  if (context.actorEntityId !== undefined || externalAccounts.size === 1) {
    return ActorResolutionState.PARTIAL;
  }
  return ActorResolutionState.UNRESOLVED;
}

/** Normalize exactly one chain transaction; no network or construction capability exists here. */
export function normalizeEconomicTrade(
  sourceLegs: readonly PersistedEconomicLeg[],
  context: EconomicTradeContext,
): NormalizedEconomicTradeEvent {
  if (sourceLegs.length === 0) throw new RangeError('economic transaction requires raw legs');
  const legs = [...sourceLegs].sort(
    (a, b) => a.legIndex - b.legIndex || a.observationId.localeCompare(b.observationId),
  );
  const chainId = legs[0]!.chainId;
  const transactionHash = legs[0]!.transactionHash;
  if (legs.some((leg) => leg.chainId !== chainId || leg.transactionHash !== transactionHash)) {
    throw new RangeError('all economic legs must belong to one chain transaction');
  }
  const observationIds = new Set(legs.map((leg) => leg.observationId));
  const uniqueLegs = legs.filter((leg) => {
    if (leg.duplicateOfObservationId === undefined) return true;
    if (!observationIds.has(leg.duplicateOfObservationId)) {
      throw new RangeError('duplicate guard references an observation outside the transaction');
    }
    return false;
  });
  const aliases = new Map<string, string>();
  for (const leg of uniqueLegs) {
    if (leg.kind !== 'MIGRATION') continue;
    const from = leg.migrationFromAssetId ?? leg.tokenIn;
    const to = leg.migrationToAssetId ?? leg.tokenOut;
    if (from === undefined || to === undefined || from === to) {
      throw new RangeError('migration leg requires distinct old and new asset representations');
    }
    aliases.set(from, to);
  }

  const deltas = new Map<string, bigint>();
  const touchedAsInput = new Set<string>();
  const touchedAsOutput = new Set<string>();
  const add = (asset: string, delta: bigint): void => {
    const canonicalAsset = resolveAsset(asset, aliases);
    deltas.set(canonicalAsset, (deltas.get(canonicalAsset) ?? 0n) + delta);
  };
  for (const leg of uniqueLegs) {
    if (leg.kind === 'MIGRATION') continue; // representation change, never trade volume
    if (leg.tokenIn !== undefined || leg.tokenOut !== undefined) {
      if (leg.tokenIn === undefined || leg.tokenOut === undefined) {
        throw new RangeError('swap-shaped leg requires both tokenIn and tokenOut');
      }
      const tokenIn = resolveAsset(leg.tokenIn, aliases);
      const tokenOut = resolveAsset(leg.tokenOut, aliases);
      add(tokenIn, -rawInteger(leg.amountIn, 'amountIn'));
      add(tokenOut, rawInteger(leg.amountOut, 'amountOut'));
      touchedAsInput.add(tokenIn);
      touchedAsOutput.add(tokenOut);
      continue;
    }
    if (leg.assetRepresentationId === undefined) {
      throw new RangeError('transfer leg requires an asset representation');
    }
    const actorAccounts = new Set(context.actorAccounts ?? []);
    const amount = rawInteger(leg.amountRaw, 'amountRaw');
    if (leg.fromAccount !== undefined && actorAccounts.has(leg.fromAccount))
      add(leg.assetRepresentationId, -amount);
    if (leg.toAccount !== undefined && actorAccounts.has(leg.toAccount))
      add(leg.assetRepresentationId, amount);
  }

  const target = resolveAsset(context.targetAssetRepresentationId, aliases);
  const targetDelta = deltas.get(target) ?? 0n;
  const targetRoundTrip = touchedAsInput.has(target) && touchedAsOutput.has(target);
  let side: TradeSide;
  if (targetRoundTrip) {
    side = targetDelta === 0n ? TradeSide.ROUND_TRIP : TradeSide.INVENTORY_NEUTRAL;
  } else if (targetDelta === 0n) side = TradeSide.INVENTORY_NEUTRAL;
  else side = targetDelta > 0n ? TradeSide.BUY : TradeSide.SELL;

  const state = actorResolution(context, uniqueLegs);
  const quality = new Set(uniqueLegs.flatMap((leg) => [...(leg.qualityCodes ?? ['VALID'])]));
  if (state === ActorResolutionState.PARTIAL) quality.add('PARTIAL');
  if (state === ActorResolutionState.UNRESOLVED) quality.add('SYSTEM_ADDRESS_UNCERTAIN');
  const routeLegs: AuditableEconomicRouteLeg[] = uniqueLegs.map((leg) => ({
    routeLegId: leg.routeLegId ?? contentId({ transactionHash, observationId: leg.observationId }),
    legIndex: leg.legIndex,
    kind: leg.kind,
    ...(leg.fromAccount === undefined ? {} : { fromAccount: leg.fromAccount }),
    ...(leg.toAccount === undefined ? {} : { toAccount: leg.toAccount }),
    assetRepresentationIds: [leg.tokenIn, leg.tokenOut, leg.assetRepresentationId].filter(
      (asset): asset is string => asset !== undefined,
    ),
    rawObservationIds: [leg.observationId],
    eventAt: leg.eventAt,
    availableAt: leg.availableAt,
    qualityCodes: [...(leg.qualityCodes ?? ['VALID'])],
  }));
  const netActorDeltas: NetActorDelta[] = [...deltas]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assetRepresentationId, delta]) => ({
      assetRepresentationId,
      deltaRaw: delta.toString(),
    }));
  const identity = {
    chainId,
    transactionHash,
    actorEntityId: context.actorEntityId ?? null,
    actorResolutionState: state,
    targetAssetRepresentationId: target,
    rawObservationIds: uniqueLegs.map((leg) => leg.observationId).sort(),
    netActorDeltas,
    side,
  };
  return {
    eventId: contentId(identity),
    chainId,
    transactionHash,
    ...(context.actorEntityId === undefined ? {} : { actorEntityId: context.actorEntityId }),
    actorResolutionState: state,
    assetRepresentationId: target,
    netAssetDeltaRaw: targetDelta.toString(),
    side,
    routeLegIds: routeLegs.map((leg) => leg.routeLegId),
    classificationConfidence: Math.max(0, Math.min(1, context.classificationConfidence ?? 1)),
    eventAt: minTimestamp(uniqueLegs.map((leg) => leg.eventAt)),
    availableAt: maxTimestamp(uniqueLegs.map((leg) => leg.availableAt)),
    qualityCodes: [...quality].sort(),
    netActorDeltas,
    rawLegs: routeLegs,
    isOrganicDemand: side === TradeSide.BUY || side === TradeSide.SELL,
    doubleCountPrevented:
      uniqueLegs.length > 1 || uniqueLegs.length !== sourceLegs.length || aliases.size > 0,
  };
}

/** Deterministically group a persisted leg stream by chain + transaction. */
export function normalizeEconomicTransactions(
  legs: readonly PersistedEconomicLeg[],
  contextFor: (chainId: string, transactionHash: string) => EconomicTradeContext,
): readonly NormalizedEconomicTradeEvent[] {
  const groups = new Map<string, PersistedEconomicLeg[]>();
  for (const leg of legs) {
    const key = `${leg.chainId}\u0000${leg.transactionHash}`;
    const group = groups.get(key) ?? [];
    group.push(leg);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) =>
      normalizeEconomicTrade(group, contextFor(group[0]!.chainId, group[0]!.transactionHash)),
    );
}
