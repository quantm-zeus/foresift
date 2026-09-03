import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule;
const ALL_PROVIDER_CONFLICT_CLASSES = Domain.ALL_PROVIDER_CONFLICT_CLASSES ?? [];
const ProviderConflictClass = Domain.ProviderConflictClass;
const classifyConflict = Domain.classifyConflict;
const providerConflictClass = Domain.providerConflictClass;

describe('Provider conflict classification (FR-DATA-016, AC-245)', () => {
  it('declares the exact four provider conflict classes', () => {
    const expected = [
      'BENIGN_LATENCY_ROUNDING_VARIANCE',
      'COMMON_UPSTREAM_DUPLICATION',
      'MATERIAL_DISAGREEMENT',
      'UNRESOLVED_DECISION_CRITICAL',
    ].sort();
    expect([...ALL_PROVIDER_CONFLICT_CLASSES].sort()).toEqual(expected as never);
  });

  it('parses valid conflict classes fail-closed', () => {
    expect(providerConflictClass('BENIGN_LATENCY_ROUNDING_VARIANCE')).toBe(
      ProviderConflictClass.BENIGN_LATENCY_ROUNDING_VARIANCE,
    );
    expect(providerConflictClass('MATERIAL_DISAGREEMENT')).toBe(
      ProviderConflictClass.MATERIAL_DISAGREEMENT,
    );
  });

  it('refuses unknown conflict classes fail-closed', () => {
    expect(() => providerConflictClass('IGNORE_AND_OVERWRITE')).toThrow();
    expect(() => providerConflictClass('')).toThrow();
  });

  it('classifies benign rounding/latency variance', () => {
    const conflict = classifyConflict({
      obsA: { value: '100.000001', fetchedAt: '2026-05-01T12:00:00.100Z' },
      obsB: { value: '100.000002', fetchedAt: '2026-05-01T12:00:00.150Z' },
      latencyDeltaMs: 50,
      roundingFingerprintMatch: true,
      sharedUpstream: false,
      affectsDecisionThreshold: false,
    });
    expect(conflict).toBe(ProviderConflictClass.BENIGN_LATENCY_ROUNDING_VARIANCE);
  });

  it('classifies common upstream duplication', () => {
    const conflict = classifyConflict({
      obsA: {
        value: '100.50',
        fetchedAt: '2026-05-01T12:00:00Z',
        upstreamLineage: 'src/node-main',
      },
      obsB: {
        value: '100.50',
        fetchedAt: '2026-05-01T12:00:01Z',
        upstreamLineage: 'src/node-main',
      },
      latencyDeltaMs: 1000,
      roundingFingerprintMatch: true,
      sharedUpstream: true,
      affectsDecisionThreshold: false,
    });
    expect(conflict).toBe(ProviderConflictClass.COMMON_UPSTREAM_DUPLICATION);
  });

  it('classifies material disagreement', () => {
    const conflict = classifyConflict({
      obsA: { value: '100.00', fetchedAt: '2026-05-01T12:00:00Z' },
      obsB: { value: '150.00', fetchedAt: '2026-05-01T12:00:00Z' },
      latencyDeltaMs: 0,
      roundingFingerprintMatch: false,
      sharedUpstream: false,
      affectsDecisionThreshold: false,
    });
    expect(conflict).toBe(ProviderConflictClass.MATERIAL_DISAGREEMENT);
  });

  it('classifies unresolved decision-critical conflict when threshold is affected', () => {
    const conflict = classifyConflict({
      obsA: { value: '99.00', fetchedAt: '2026-05-01T12:00:00Z' },
      obsB: { value: '101.00', fetchedAt: '2026-05-01T12:00:00Z' },
      latencyDeltaMs: 0,
      roundingFingerprintMatch: false,
      sharedUpstream: false,
      affectsDecisionThreshold: true,
    });
    expect(conflict).toBe(ProviderConflictClass.UNRESOLVED_DECISION_CRITICAL);
  });
});
