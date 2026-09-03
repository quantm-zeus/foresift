export const TradeSide = {
  BUY: 'BUY',
  SELL: 'SELL',
  ROUND_TRIP: 'ROUND_TRIP',
  INVENTORY_NEUTRAL: 'INVENTORY_NEUTRAL',
  UNKNOWN: 'UNKNOWN',
} as const;

export type TradeSide = (typeof TradeSide)[keyof typeof TradeSide];
export const ALL_TRADE_SIDES: readonly TradeSide[] = Object.values(TradeSide);

export function tradeSide(value: string): TradeSide {
  if (!(ALL_TRADE_SIDES as readonly string[]).includes(value)) {
    throw new RangeError(`unknown trade side: ${JSON.stringify(value)}`);
  }
  return value as TradeSide;
}

export const ActorResolutionState = {
  RESOLVED: 'RESOLVED',
  PARTIAL: 'PARTIAL',
  UNRESOLVED: 'UNRESOLVED',
} as const;

export type ActorResolutionState = (typeof ActorResolutionState)[keyof typeof ActorResolutionState];
export const ALL_ACTOR_RESOLUTION_STATES: readonly ActorResolutionState[] =
  Object.values(ActorResolutionState);

export function actorResolutionState(value: string): ActorResolutionState {
  if (!(ALL_ACTOR_RESOLUTION_STATES as readonly string[]).includes(value)) {
    throw new RangeError(`unknown actor resolution state: ${JSON.stringify(value)}`);
  }
  return value as ActorResolutionState;
}

const ACTOR_RESOLUTION_WEIGHTS: Readonly<Record<ActorResolutionState, number>> = {
  RESOLVED: 1,
  PARTIAL: 0.6,
  UNRESOLVED: 0.25,
};

export function actorUncertaintyFactor(state: ActorResolutionState, confidence: number): number {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError('actor confidence must lie in [0,1]');
  }
  return ACTOR_RESOLUTION_WEIGHTS[state] * confidence;
}
