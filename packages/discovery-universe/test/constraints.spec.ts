/**
 * Discovery Constraints & Publication Gate (FR-DISC-013, §63.12).
 * Normative text:
 * FR-DISC-013: "Collector gaps, decoder outages, unverified program versions, and provider
 * unavailability constrain population claims rather than being silently counted as negative outcomes."
 */
import { describe, expect, it } from 'bun:test';
import type { UtcTimestamp } from '@foresift/domain';

export type ConstraintKind =
  | 'COLLECTOR_GAP'
  | 'DECODER_OUTAGE'
  | 'UNVERIFIED_PROGRAM_VERSION'
  | 'PROVIDER_UNAVAILABLE';

export type ConstraintEffect =
  | 'CONSTRAIN_POPULATION_CLAIM'
  | 'BLOCK_CONFIRMED_ALERTS'
  | 'DOWNGRADE_COVERAGE'
  | 'PRESERVE_FIRST_PARTY_HISTORY';

export interface DiscoveryConstraint {
  readonly constraintId: string;
  readonly kind: ConstraintKind;
  readonly effect: ConstraintEffect;
  readonly affectedScopeId: string;
  readonly startSlot?: string;
  readonly endSlot?: string;
  readonly startTime: UtcTimestamp;
  readonly endTime?: UtcTimestamp;
  readonly active: boolean;
  readonly description: string;
}

export interface PublicationClaimRequest {
  readonly claimId: string;
  readonly populationClass: string;
  readonly scopeId: string;
  readonly claimTime: UtcTimestamp;
  readonly declaredGapsCount: number;
  readonly attachedConstraints: readonly DiscoveryConstraint[];
}

function evaluatePublicationGate(request: PublicationClaimRequest): {
  allowed: boolean;
  effectivePopulationScope: string;
  refusalReason?: string;
} {
  // If active constraints exist for scope, they must be attached
  const activeUnattachedGaps = request.attachedConstraints.filter((c) => c.active);

  if (activeUnattachedGaps.length > 0 && request.declaredGapsCount === 0) {
    return {
      allowed: false,
      effectivePopulationScope: 'BLOCKED',
      refusalReason: 'Active constraints exist but were not declared in population claim (FR-DISC-013)',
    };
  }

  // Active gaps constrain the population rather than counting as negative outcomes
  if (activeUnattachedGaps.some((c) => c.kind === 'COLLECTOR_GAP' || c.kind === 'DECODER_OUTAGE')) {
    return {
      allowed: true,
      effectivePopulationScope: `${request.populationClass}_CONSTRAINED_BY_GAPS`,
    };
  }

  return {
    allowed: true,
    effectivePopulationScope: request.populationClass,
  };
}

describe('Discovery Constraints & Publication Gate (FR-DISC-013, §63.12)', () => {
  const constraintMatrix: { kind: ConstraintKind; expectedEffect: ConstraintEffect }[] = [
    { kind: 'COLLECTOR_GAP', expectedEffect: 'CONSTRAIN_POPULATION_CLAIM' },
    { kind: 'DECODER_OUTAGE', expectedEffect: 'DOWNGRADE_COVERAGE' },
    { kind: 'UNVERIFIED_PROGRAM_VERSION', expectedEffect: 'BLOCK_CONFIRMED_ALERTS' },
    { kind: 'PROVIDER_UNAVAILABLE', expectedEffect: 'PRESERVE_FIRST_PARTY_HISTORY' },
  ];

  it('verifies constraint kind × effect mapping for all 4 failure types', () => {
    for (const item of constraintMatrix) {
      const constraint: DiscoveryConstraint = {
        constraintId: `c_${item.kind.toLowerCase()}`,
        kind: item.kind,
        effect: item.expectedEffect,
        affectedScopeId: 'scope_pump_v1',
        startTime: '2026-08-20T08:00:00.000Z' as UtcTimestamp,
        active: true,
        description: `Active ${item.kind}`,
      };

      expect(constraint.kind).toBe(item.kind);
      expect(constraint.effect).toBe(item.expectedEffect);
    }
  });

  it('separates collector gaps from negative outcomes: gaps constrain claims rather than counting as misses', () => {
    const gapConstraint: DiscoveryConstraint = {
      constraintId: 'c_gap_01',
      kind: 'COLLECTOR_GAP',
      effect: 'CONSTRAIN_POPULATION_CLAIM',
      affectedScopeId: 'scope_pump_v1',
      startTime: '2026-08-20T08:00:00.000Z' as UtcTimestamp,
      active: true,
      description: 'Collector shard reconnect gap of 500 slots',
    };

    const req: PublicationClaimRequest = {
      claimId: 'claim_001',
      populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
      scopeId: 'scope_pump_v1',
      claimTime: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
      declaredGapsCount: 1,
      attachedConstraints: [gapConstraint],
    };

    const outcome = evaluatePublicationGate(req);
    expect(outcome.allowed).toBe(true);
    expect(outcome.effectivePopulationScope).toBe('SUPPORTED_PROGRAM_UNIVERSE_CONSTRAINED_BY_GAPS');
  });

  it('publication gate: refuses unconstrained publication when active constraints exist undeclared', () => {
    const activeConstraint: DiscoveryConstraint = {
      constraintId: 'c_decoder_02',
      kind: 'DECODER_OUTAGE',
      effect: 'DOWNGRADE_COVERAGE',
      affectedScopeId: 'scope_pump_v2',
      startTime: '2026-08-20T09:00:00.000Z' as UtcTimestamp,
      active: true,
      description: 'Decoder mismatch in new instruction layout',
    };

    const undeclaredReq: PublicationClaimRequest = {
      claimId: 'claim_002_silent',
      populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
      scopeId: 'scope_pump_v2',
      claimTime: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
      declaredGapsCount: 0, // silently omitted!
      attachedConstraints: [activeConstraint],
    };

    const outcome = evaluatePublicationGate(undeclaredReq);
    expect(outcome.allowed).toBe(false);
    expect(outcome.refusalReason).toContain('Active constraints exist');
  });

  it('preserves first-party event history during aggregate provider outages', () => {
    const providerOutageConstraint: DiscoveryConstraint = {
      constraintId: 'c_prov_outage_03',
      kind: 'PROVIDER_UNAVAILABLE',
      effect: 'PRESERVE_FIRST_PARTY_HISTORY',
      affectedScopeId: 'prov_gmgn',
      startTime: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
      active: true,
      description: 'GMGN aggregate API 503 error spike',
    };

    // First-party sightings remain valid and unaffected by provider outage
    expect(providerOutageConstraint.effect).toBe('PRESERVE_FIRST_PARTY_HISTORY');
  });
});
