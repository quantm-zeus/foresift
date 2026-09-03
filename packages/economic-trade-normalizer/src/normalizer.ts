import {
  EconomicTradeClassification,
  actorResolutionQualityCodes,
  actorUncertaintyFactor,
  type ActorResolution,
  type EconomicTradeEvent,
  type NetActorDelta,
  type RawEconomicLegAudit,
  utcTimestamp,
} from '@foresift/domain';
import { contentHashEventIdentity } from './hash.ts';
import type { DoubleCountGuardResult, NormalizerOptions, PersistedTradeLeg } from './types.ts';

const DIGITS = /^(0|[1-9][0-9]*)$/;

const groupKey = (leg: PersistedTradeLeg): string =>
  leg.economicTransactionId ?? `${leg.chainId}:${leg.transactionHash}`;

export function groupEconomicTransactionLegs(
  legs: readonly PersistedTradeLeg[],
): ReadonlyMap<string, readonly PersistedTradeLeg[]> {
  const grouped = new Map<string, PersistedTradeLeg[]>();
  for (const leg of legs) {
    validateLeg(leg);
    const key = groupKey(leg);
    const group = grouped.get(key) ?? [];
    group.push(leg);
    grouped.set(key, group);
  }
  return new Map(
    [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => [key, [...group].sort(compareLegs)]),
  );
}

/** De-duplicate provider copies and launch/migrated-pool mirrors before summing. */
export function applyDoubleCountGuards(
  legs: readonly PersistedTradeLeg[],
): DoubleCountGuardResult {
  const seenObservation = new Set<string>();
  const seenMigration = new Set<string>();
  const retained: PersistedTradeLeg[] = [];
  const blockedLegIds: string[] = [];
  for (const leg of [...legs].sort(compareLegs)) {
    const migrationKey = leg.migrationEquivalenceKey;
    if (
      seenObservation.has(leg.observationId) ||
      (migrationKey !== undefined && seenMigration.has(migrationKey))
    ) {
      blockedLegIds.push(leg.legId);
      continue;
    }
    seenObservation.add(leg.observationId);
    if (migrationKey !== undefined) seenMigration.add(migrationKey);
    retained.push(leg);
  }
  return { retained, blockedLegIds: blockedLegIds.sort() };
}

export function resolveEconomicActor(
  economicTransactionId: string,
  legs: readonly PersistedTradeLeg[],
  options: NormalizerOptions = {},
): ActorResolution {
  const routers = new Set([...(options.knownRouterAddresses ?? [])].map(normalizeAddress));
  const explicit = options.actorByTransaction?.[economicTransactionId];
  if (explicit !== undefined) {
    return resolution('RESOLVED', normalizeAddress(explicit), routers, 1, 'EXPLICIT_TRANSACTION_ACTOR');
  }
  const signers = unique(
    legs.map((leg) => leg.signerAddress).filter((v): v is string => v !== undefined),
  ).filter((address) => !routers.has(normalizeAddress(address)));
  if (signers.length === 1) {
    return resolution('RESOLVED', normalizeAddress(signers[0]!), routers, 0.95, 'UNIQUE_SIGNER');
  }
  const initiators = unique(
    legs.map((leg) => leg.initiatorAddress).filter((v): v is string => v !== undefined),
  ).filter((address) => !routers.has(normalizeAddress(address)));
  if (initiators.length === 1) {
    return resolution(
      'ROUTER_RESOLVED',
      normalizeAddress(initiators[0]!),
      routers,
      0.8,
      'ROUTER_UNWRAPPED_INITIATOR',
    );
  }
  const endpoints = unique(
    legs.flatMap((leg) => [leg.fromAddress, leg.toAddress]).map(normalizeAddress),
  ).filter(
    (address) =>
      !routers.has(address) &&
      !legs.some((leg) => leg.poolId !== undefined && normalizeAddress(leg.poolId) === address),
  );
  if (endpoints.length === 1) {
    return resolution('PARTIALLY_RESOLVED', endpoints[0]!, routers, 0.5, 'UNIQUE_NON_ROUTER_ENDPOINT');
  }
  return resolution('UNRESOLVED', null, routers, 0, 'AMBIGUOUS_ENDPOINTS');
}

export function computeNetActorDeltas(
  legs: readonly PersistedTradeLeg[],
  actorAddress: string | null,
): readonly NetActorDelta[] {
  if (actorAddress === null) return [];
  const actor = normalizeAddress(actorAddress);
  const totals = new Map<string, bigint>();
  for (const leg of legs) {
    const amount = BigInt(leg.rawAmount);
    let delta = 0n;
    if (normalizeAddress(leg.fromAddress) === actor) delta -= amount;
    if (normalizeAddress(leg.toAddress) === actor) delta += amount;
    if (delta !== 0n) totals.set(leg.assetId, (totals.get(leg.assetId) ?? 0n) + delta);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount !== 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assetId, amount]) => ({ assetId, rawAmount: amount.toString() }));
}

export function classifyEconomicActivity(
  legs: readonly PersistedTradeLeg[],
  deltas: readonly NetActorDelta[],
): EconomicTradeEvent['classification'] {
  if (deltas.length === 0) {
    const repeatedAsset = new Set(legs.map((leg) => leg.assetId)).size < legs.length;
    return repeatedAsset
      ? EconomicTradeClassification.SAME_TRANSACTION_ROUND_TRIP
      : EconomicTradeClassification.INVENTORY_NEUTRAL;
  }
  const values = deltas.map((delta) => BigInt(delta.rawAmount));
  if (legs.length >= 2 && values.some((v) => v > 0n) && !values.some((v) => v < 0n)) {
    return EconomicTradeClassification.ARBITRAGE;
  }
  return EconomicTradeClassification.ORGANIC_DEMAND;
}

export function normalizeEconomicTrade(
  economicTransactionId: string,
  rawLegs: readonly PersistedTradeLeg[],
  options: NormalizerOptions = {},
): EconomicTradeEvent {
  if (rawLegs.length === 0) throw new Error('economic transaction requires at least one persisted leg');
  rawLegs.forEach(validateLeg);
  const guarded = applyDoubleCountGuards(rawLegs);
  const first = guarded.retained[0];
  if (first === undefined) throw new Error('all economic transaction legs were duplicates');
  if (guarded.retained.some((leg) => leg.chainId !== first.chainId || leg.transactionHash !== first.transactionHash))
    throw new Error('economic transaction cannot cross chain or transaction hash');
  const actorResolution = resolveEconomicActor(economicTransactionId, guarded.retained, options);
  const netActorDeltas = computeNetActorDeltas(guarded.retained, actorResolution.actorAddress);
  const classification = classifyEconomicActivity(guarded.retained, netActorDeltas);
  const uncertaintyFactor = actorUncertaintyFactor(
    actorResolution.state,
    actorResolution.confidence,
  );
  const contributionCap = options.maximumContributionFactor ?? 1;
  if (!Number.isFinite(contributionCap) || contributionCap < 0 || contributionCap > 1)
    throw new RangeError('maximumContributionFactor must lie in [0,1]');
  const availableAt = latest(guarded.retained.map((leg) => leg.availableAt));
  const retainedAuditLegs: RawEconomicLegAudit[] = guarded.retained.map(toAuditLeg);
  // Audit preservation is deliberately wider than calculation input: blocked
  // mirrors remain inspectable even though they cannot inflate net volume.
  const auditLegs: RawEconomicLegAudit[] = [...rawLegs].sort(compareLegs).map(toAuditLeg);
  const identityMaterial = {
    economicTransactionId,
    chainId: first.chainId,
    transactionHash: first.transactionHash,
    actorResolution,
    netActorDeltas,
    classification,
    rawLegs: retainedAuditLegs,
  };
  return {
    eventId: contentHashEventIdentity(identityMaterial),
    economicTransactionId,
    chainId: first.chainId,
    transactionHash: first.transactionHash,
    eventAt: first.eventAt,
    availableAt,
    actorResolution,
    actorResolutionState: actorResolution.state,
    netActorDeltas,
    classification,
    rawLegs: auditLegs,
    blockedDuplicateLegIds: guarded.blockedLegIds,
    qualityCodes: actorResolutionQualityCodes(actorResolution.state),
    actorUncertaintyFactor: uncertaintyFactor,
    cappedContributionFactor: Math.min(uncertaintyFactor, contributionCap),
  };
}

export function normalizeEconomicTrades(
  legs: readonly PersistedTradeLeg[],
  options: NormalizerOptions = {},
): readonly EconomicTradeEvent[] {
  return [...groupEconomicTransactionLegs(legs)].map(([id, group]) =>
    normalizeEconomicTrade(id, group, options),
  );
}

function validateLeg(leg: PersistedTradeLeg): void {
  if (!DIGITS.test(leg.rawAmount)) throw new Error(`leg ${leg.legId} rawAmount must be digits`);
  if (leg.chainId.length === 0 || leg.transactionHash.length === 0 || leg.observationId.length === 0)
    throw new Error(`leg ${leg.legId} lacks persisted identity`);
}

function compareLegs(a: PersistedTradeLeg, b: PersistedTradeLeg): number {
  return (a.routeIndex ?? Number.MAX_SAFE_INTEGER) - (b.routeIndex ?? Number.MAX_SAFE_INTEGER) ||
    a.legId.localeCompare(b.legId);
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeAddress))].sort();
}

function resolution(
  state: ActorResolution['state'],
  actorAddress: string | null,
  routers: ReadonlySet<string>,
  confidence: number,
  method: string,
): ActorResolution {
  return { state, actorAddress, routerAddresses: [...routers].sort(), confidence, method };
}

function latest(values: readonly string[]): ReturnType<typeof utcTimestamp> {
  return utcTimestamp([...values].sort((a, b) => Date.parse(b) - Date.parse(a))[0]!);
}

function toAuditLeg(leg: PersistedTradeLeg): RawEconomicLegAudit {
  return {
    legId: leg.legId,
    observationId: leg.observationId,
    kind: leg.kind,
    fromAddress: leg.fromAddress,
    toAddress: leg.toAddress,
    assetId: leg.assetId,
    rawAmount: leg.rawAmount,
    ...(leg.poolId === undefined ? {} : { poolId: leg.poolId }),
    ...(leg.routeIndex === undefined ? {} : { routeIndex: leg.routeIndex }),
    ...(leg.migrationEquivalenceKey === undefined
      ? {}
      : { migrationEquivalenceKey: leg.migrationEquivalenceKey }),
  };
}
