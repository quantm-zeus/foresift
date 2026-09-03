import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as any;
const ALL_ACTOR_RESOLUTION_STATES = Domain.ALL_ACTOR_RESOLUTION_STATES ?? [];
const ALL_TRADE_SIDES = Domain.ALL_TRADE_SIDES ?? [];
const ActorResolutionState = Domain.ActorResolutionState ?? {};
const TradeSide = Domain.TradeSide ?? {};
const actorResolutionState = Domain.actorResolutionState;
const actorUncertaintyFactor = Domain.actorUncertaintyFactor;
const tradeSide = Domain.tradeSide;

describe('Trade vocabularies and actor uncertainty reduction (FR-TRD-003, FR-TRD-004, AC-133, AC-134, AC-136)', () => {
  it('declares the complete TradeSide vocabulary', () => {
    const expected = ['BUY', 'SELL', 'ROUND_TRIP', 'INVENTORY_NEUTRAL', 'UNKNOWN'].sort();
    expect([...ALL_TRADE_SIDES].sort()).toEqual(expected as any);
  });

  it('declares the ActorResolutionState vocabulary', () => {
    const expected = ['RESOLVED', 'PARTIAL', 'UNRESOLVED'].sort();
    expect([...ALL_ACTOR_RESOLUTION_STATES].sort()).toEqual(expected as any);
  });

  it('parses valid trade sides fail-closed', () => {
    expect(tradeSide('BUY')).toBe(TradeSide.BUY);
    expect(tradeSide('ROUND_TRIP')).toBe(TradeSide.ROUND_TRIP);
    expect(tradeSide('INVENTORY_NEUTRAL')).toBe(TradeSide.INVENTORY_NEUTRAL);
  });

  it('refuses unknown trade sides fail-closed', () => {
    expect(() => tradeSide('SWAP_TRANSFER_UNKNOWN_COMBO')).toThrow();
    expect(() => tradeSide('')).toThrow();
  });

  it('parses valid actor resolution states fail-closed', () => {
    expect(actorResolutionState('RESOLVED')).toBe(ActorResolutionState.RESOLVED);
    expect(actorResolutionState('PARTIAL')).toBe(ActorResolutionState.PARTIAL);
    expect(actorResolutionState('UNRESOLVED')).toBe(ActorResolutionState.UNRESOLVED);
  });

  it('computes pure deterministic actorUncertaintyFactor', () => {
    expect(actorUncertaintyFactor(ActorResolutionState.RESOLVED, 1.0)).toBe(1.0);
    expect(actorUncertaintyFactor(ActorResolutionState.RESOLVED, 0.8)).toBeCloseTo(0.8, 2);

    const partialFactor = actorUncertaintyFactor(ActorResolutionState.PARTIAL, 0.8);
    expect(partialFactor).toBeLessThan(0.8);
    expect(partialFactor).toBeGreaterThan(0.0);

    const unresolvedFactor = actorUncertaintyFactor(ActorResolutionState.UNRESOLVED, 0.0);
    expect(unresolvedFactor).toBe(0.0);
  });

  it('actorUncertaintyFactor obeys monotonicity across resolution states and confidence', () => {
    const res = actorUncertaintyFactor(ActorResolutionState.RESOLVED, 0.7);
    const part = actorUncertaintyFactor(ActorResolutionState.PARTIAL, 0.7);
    const unres = actorUncertaintyFactor(ActorResolutionState.UNRESOLVED, 0.7);

    expect(res).toBeGreaterThan(part);
    expect(part).toBeGreaterThanOrEqual(unres);
  });
});
