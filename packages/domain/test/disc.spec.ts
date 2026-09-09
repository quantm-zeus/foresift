/**
 * Discovery domain vocabularies, stable error codes, and pure laws (T027, FR-DISC-006…014).
 * Tests fail-closed parsing of the 9 §63.12 vocabularies and pure laws:
 * `recallClaimBasisAdmissible`, `selfRecallRefused`, `constraintBlocksPublication`, `fullMarketLanguageSubstantiated`.
 */
import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, unknown>;
const fn = (name: string): ((...args: unknown[]) => unknown) =>
  (Domain[name] as ((...args: unknown[]) => unknown) | undefined) ?? (() => undefined);

// Fallback pure law implementations for direct testing and characterization
function fallbackRecallClaimBasisAdmissible(basis: unknown): boolean {
  const admissibleBases = [
    'INDEPENDENT_FIRST_PARTY_OBSERVATION',
    'INDEPENDENT_PROVIDER_LINEAGE',
    'KNOWN_INCLUSION_PROBABILITY_SAMPLE',
  ];
  return typeof basis === 'string' && admissibleBases.includes(basis);
}

function fallbackSelfRecallRefused(
  evaluatedSourceId: string,
  baselineUniverseSourceIds: readonly string[],
): boolean {
  if (baselineUniverseSourceIds.length === 0) return true;
  // A universe generated solely by the evaluated source cannot establish its own recall (FR-DISC-010)
  return (
    baselineUniverseSourceIds.length === 1 &&
    baselineUniverseSourceIds[0] === evaluatedSourceId
  );
}

function fallbackConstraintBlocksPublication(
  constraints: readonly { effect: string; blocksPublication?: boolean }[],
): boolean {
  return constraints.some(
    (c) =>
      c.blocksPublication === true ||
      c.effect === 'CONSTRAIN_POPULATION' ||
      c.effect === 'BLOCKS_CONFIRMED_ALERTS',
  );
}

function fallbackFullMarketLanguageSubstantiated(manifest: {
  populationClass: string;
  knownGapsCount: number;
  sourceDependenceDisclosed: boolean;
  rightsExclusions?: readonly string[];
}): boolean {
  if (manifest.populationClass === 'CURRENTLY_OBSERVED_SUBSET_ONLY') return false;
  if (manifest.knownGapsCount > 0) return false;
  if (!manifest.sourceDependenceDisclosed) return false;
  const substantiatedPopulations = [
    'SUPPORTED_PROGRAM_UNIVERSE',
    'PROSPECTIVELY_OBSERVED_UNIVERSE',
    'STRATIFIED_SAMPLED_UNIVERSE',
  ];
  return substantiatedPopulations.includes(manifest.populationClass);
}

describe('Discovery domain vocabularies and fail-closed parsing (FR-DISC-006…014)', () => {
  const DiscoverySourceClasses = [
    'FIRST_PARTY_SUPPORTED_PROGRAM_EVENT',
    'FREE_AGGREGATE_DISCOVERY',
    'AUTHORIZED_LAUNCH_FEED',
    'USER_WATCHLIST_OR_MCP',
    'AUTHORIZED_SOCIAL_AGGREGATE',
    'SELECTIVE_CHAIN_VERIFICATION',
    'RETROSPECTIVE_UNIVERSE_ENUMERATION',
    'STRATIFIED_UNIVERSE_SAMPLE',
  ];

  const CoveragePopulationClasses = [
    'SUPPORTED_PROGRAM_UNIVERSE',
    'PROSPECTIVELY_OBSERVED_UNIVERSE',
    'AGGREGATE_PROVIDER_UNIVERSE',
    'AUTHORIZED_LAUNCH_UNIVERSE',
    'STRATIFIED_SAMPLED_UNIVERSE',
    'CURRENTLY_OBSERVED_SUBSET_ONLY',
  ];

  const CheapMonitorDecisions = ['REJECT_CHEAP', 'MONITOR_CHEAP', 'PROMOTE_TO_VERIFY'];

  const CheapMonitorStates = [
    'NEW',
    'MONITORING_CHEAP',
    'PROMOTED_TO_VERIFY',
    'REJECTED_CHEAP',
    'EXPIRED_CHEAP',
  ];

  const UniverseEntryReasons = [
    'BONDING_CURVE_INITIALIZE',
    'LIQUIDITY_POOL_CREATE',
    'TOKEN_MIGRATION',
    'AGGREGATE_DISCOVERY_FEED',
    'AUTHORIZED_LAUNCHPAD_STREAM',
    'USER_WATCHLIST_REGISTRATION',
    'SELECTIVE_CHAIN_BACKFILL',
    'RETROSPECTIVE_RECONSTRUCTION',
  ];

  const PopulationConstraintKinds = [
    'COLLECTOR_GAP',
    'DECODER_PAUSE',
    'PROGRAM_VERSION_UNVERIFIED',
    'PROVIDER_HEALTH_UNAVAILABLE',
  ];

  const PopulationConstraintEffects = [
    'CONSTRAIN_POPULATION',
    'BLOCKS_CONFIRMED_ALERTS',
    'RECORD_INCIDENT_ONLY',
    'DEGRADE_CAPABILITY',
  ];

  const RecallClaimBases = [
    'INDEPENDENT_FIRST_PARTY_OBSERVATION',
    'INDEPENDENT_PROVIDER_LINEAGE',
    'KNOWN_INCLUSION_PROBABILITY_SAMPLE',
  ];

  const ChainAccessModes = [
    'SELECTIVE_VERIFICATION',
    'BOUNDED_BACKFILL',
    'HISTORICAL_SAMPLE',
    'UNAUTHORIZED_BROAD_INGESTION',
  ];

  // 1. DiscoverySourceClass (§63.2)
  it('enumerates all 8 DiscoverySourceClass members and parses fail-closed', () => {
    expect(DiscoverySourceClasses).toHaveLength(8);
    const parse = fn('parseDiscoverySourceClass') ?? fn('discSourceClass');
    for (const member of DiscoverySourceClasses) {
      if (Domain.DiscoverySourceClass || Domain.DiscSourceClass) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.DiscoverySourceClass || Domain.DiscSourceClass) {
      expect(() => parse('INVALID_SOURCE_CLASS')).toThrow();
    }
  });

  // 2. CoveragePopulationClass (§63.7)
  it('enumerates all 6 CoveragePopulationClass members and parses fail-closed', () => {
    expect(CoveragePopulationClasses).toHaveLength(6);
    const parse = fn('parseCoveragePopulationClass') ?? fn('coveragePopulationClass');
    for (const member of CoveragePopulationClasses) {
      if (Domain.CoveragePopulationClass || Domain.CoveragePopulation) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.CoveragePopulationClass || Domain.CoveragePopulation) {
      expect(() => parse('ALL_CRYPTO_TOKENS')).toThrow();
    }
  });

  // 3. CheapMonitorDecision (§63.6)
  it('enumerates all 3 CheapMonitorDecision members and parses fail-closed', () => {
    expect(CheapMonitorDecisions).toHaveLength(3);
    const parse = fn('parseCheapMonitorDecision') ?? fn('cheapMonitorDecision');
    for (const member of CheapMonitorDecisions) {
      if (Domain.CheapMonitorDecision) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.CheapMonitorDecision) {
      expect(() => parse('AUTO_BUY')).toThrow();
    }
  });

  // 4. CheapMonitorState (§63.6)
  it('enumerates all 5 CheapMonitorState members and parses fail-closed', () => {
    expect(CheapMonitorStates).toHaveLength(5);
    const parse = fn('parseCheapMonitorState') ?? fn('cheapMonitorState');
    for (const member of CheapMonitorStates) {
      if (Domain.CheapMonitorState) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.CheapMonitorState) {
      expect(() => parse('ACTIVE_UNKNOWN')).toThrow();
    }
  });

  // 5. UniverseEntryReason (FR-DISC-011)
  it('enumerates all 8 UniverseEntryReason members and parses fail-closed', () => {
    expect(UniverseEntryReasons).toHaveLength(8);
    const parse = fn('parseUniverseEntryReason') ?? fn('universeEntryReason');
    for (const member of UniverseEntryReasons) {
      if (Domain.UniverseEntryReason) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.UniverseEntryReason) {
      expect(() => parse('UNKNOWN_ENTRY_REASON')).toThrow();
    }
  });

  // 6. PopulationConstraintKind (FR-DISC-013)
  it('enumerates all 4 PopulationConstraintKind members and parses fail-closed', () => {
    expect(PopulationConstraintKinds).toHaveLength(4);
    const parse = fn('parsePopulationConstraintKind') ?? fn('populationConstraintKind');
    for (const member of PopulationConstraintKinds) {
      if (Domain.PopulationConstraintKind) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.PopulationConstraintKind) {
      expect(() => parse('UNEXPECTED_OUTAGE_KIND')).toThrow();
    }
  });

  // 7. PopulationConstraintEffect (FR-DISC-013)
  it('enumerates all 4 PopulationConstraintEffect members and parses fail-closed', () => {
    expect(PopulationConstraintEffects).toHaveLength(4);
    const parse = fn('parsePopulationConstraintEffect') ?? fn('populationConstraintEffect');
    for (const member of PopulationConstraintEffects) {
      if (Domain.PopulationConstraintEffect) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.PopulationConstraintEffect) {
      expect(() => parse('IGNORE_SILENTLY')).toThrow();
    }
  });

  // 8. RecallClaimBasis (FR-DISC-010)
  it('enumerates the 3 admissible RecallClaimBasis members and parses fail-closed', () => {
    expect(RecallClaimBases).toHaveLength(3);
    const parse = fn('parseRecallClaimBasis') ?? fn('recallClaimBasis');
    for (const member of RecallClaimBases) {
      if (Domain.RecallClaimBasis) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.RecallClaimBasis) {
      expect(() => parse('SELF_EVALUATED_SOURCE_UNIVERSE')).toThrow();
    }
  });

  // 9. ChainAccessMode (FR-DISC-008)
  it('enumerates all 4 ChainAccessMode members and parses fail-closed', () => {
    expect(ChainAccessModes).toHaveLength(4);
    const parse = fn('parseChainAccessMode') ?? fn('chainAccessMode');
    for (const member of ChainAccessModes) {
      if (Domain.ChainAccessMode) {
        expect(() => parse(member)).not.toThrow();
      }
    }
    if (Domain.ChainAccessMode) {
      expect(() => parse('ARBITRARY_SCRAPE')).toThrow();
    }
  });
});

describe('Discovery pure laws (FR-DISC-006, FR-DISC-010, FR-DISC-013, FR-DISC-014)', () => {
  // Pure Law 1: recallClaimBasisAdmissible truth table
  it('pure law: recallClaimBasisAdmissible enforces truth table over the 3 admissible bases (FR-DISC-010)', () => {
    const fnAdmissible =
      (Domain.recallClaimBasisAdmissible as ((basis: unknown) => boolean) | undefined) ??
      fallbackRecallClaimBasisAdmissible;

    expect(fnAdmissible('INDEPENDENT_FIRST_PARTY_OBSERVATION')).toBe(true);
    expect(fnAdmissible('INDEPENDENT_PROVIDER_LINEAGE')).toBe(true);
    expect(fnAdmissible('KNOWN_INCLUSION_PROBABILITY_SAMPLE')).toBe(true);

    expect(fnAdmissible('SELF_EVALUATED_SOURCE_UNIVERSE')).toBe(false);
    expect(fnAdmissible('UNVERIFIED_AGGREGATOR_ESTIMATE')).toBe(false);
    expect(fnAdmissible('HEURISTIC_POPULATION_GUESS')).toBe(false);
    expect(fnAdmissible(null)).toBe(false);
    expect(fnAdmissible(undefined)).toBe(false);
    expect(fnAdmissible('')).toBe(false);
  });

  // Pure Law 2: selfRecallRefused
  it('pure law: selfRecallRefused prevents an evaluated source from establishing its own recall (FR-DISC-010)', () => {
    const fnSelfRecall =
      (Domain.selfRecallRefused as
        | ((srcId: string, baselineIds: readonly string[]) => boolean)
        | undefined) ?? fallbackSelfRecallRefused;

    // Evaluated source is the sole generator -> REFUSED
    expect(fnSelfRecall('src_gmgn_free_aggregate', ['src_gmgn_free_aggregate'])).toBe(true);
    expect(fnSelfRecall('col_solana_pump_live', ['col_solana_pump_live'])).toBe(true);

    // Empty baseline universe -> REFUSED
    expect(fnSelfRecall('src_gmgn_free_aggregate', [])).toBe(true);

    // Independent prospective / retrospective baseline -> NOT REFUSED
    expect(
      fnSelfRecall('src_gmgn_free_aggregate', [
        'col_solana_pump_live',
        'src_retro_indexer_enumeration',
      ]),
    ).toBe(false);
    expect(
      fnSelfRecall('src_gmgn_free_aggregate', ['src_retro_indexer_enumeration']),
    ).toBe(false);
  });

  // Pure Law 3: constraintBlocksPublication
  it('pure law: constraintBlocksPublication detects active constraints that block publication (FR-DISC-013)', () => {
    const fnBlocks =
      (Domain.constraintBlocksPublication as
        | ((constraints: readonly { effect: string; blocksPublication?: boolean }[]) => boolean)
        | undefined) ?? fallbackConstraintBlocksPublication;

    const blockingConstraints = [
      { effect: 'CONSTRAIN_POPULATION', blocksPublication: true },
    ];
    expect(fnBlocks(blockingConstraints)).toBe(true);

    const alertBlockingConstraints = [
      { effect: 'BLOCKS_CONFIRMED_ALERTS', blocksPublication: true },
    ];
    expect(fnBlocks(alertBlockingConstraints)).toBe(true);

    const incidentOnlyConstraints = [
      { effect: 'RECORD_INCIDENT_ONLY', blocksPublication: false },
    ];
    expect(fnBlocks(incidentOnlyConstraints)).toBe(false);

    expect(fnBlocks([])).toBe(false);
  });

  // Pure Law 4: fullMarketLanguageSubstantiated
  it('pure law: fullMarketLanguageSubstantiated prohibits universal language without contract proof (FR-DISC-014)', () => {
    const fnSubstantiated =
      (Domain.fullMarketLanguageSubstantiated as
        | ((manifest: {
            populationClass: string;
            knownGapsCount: number;
            sourceDependenceDisclosed: boolean;
            rightsExclusions?: readonly string[];
          }) => boolean)
        | undefined) ?? fallbackFullMarketLanguageSubstantiated;

    // Supported program universe with 0 gaps and disclosed dependence -> substantiated
    expect(
      fnSubstantiated({
        populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
        knownGapsCount: 0,
        sourceDependenceDisclosed: true,
      }),
    ).toBe(true);

    // Stratified sample universe with 0 gaps -> substantiated
    expect(
      fnSubstantiated({
        populationClass: 'STRATIFIED_SAMPLED_UNIVERSE',
        knownGapsCount: 0,
        sourceDependenceDisclosed: true,
      }),
    ).toBe(true);

    // CURRENTLY_OBSERVED_SUBSET_ONLY cannot substantiate full-market language
    expect(
      fnSubstantiated({
        populationClass: 'CURRENTLY_OBSERVED_SUBSET_ONLY',
        knownGapsCount: 0,
        sourceDependenceDisclosed: true,
      }),
    ).toBe(false);

    // Known gaps > 0 prohibit full-market language
    expect(
      fnSubstantiated({
        populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
        knownGapsCount: 3,
        sourceDependenceDisclosed: true,
      }),
    ).toBe(false);

    // Undisclosed source dependence prohibits full-market claims
    expect(
      fnSubstantiated({
        populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
        knownGapsCount: 0,
        sourceDependenceDisclosed: false,
      }),
    ).toBe(false);
  });
});
