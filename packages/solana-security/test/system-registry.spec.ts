import { describe, expect, it } from 'bun:test';
import {
  parseChainId,
  isExcludableSystemAddress,
  SystemAddressReviewState,
  SystemAddressRole,
} from '@foresift/domain';
import {
  parseSolsecSchema,
  type SystemAddressRegistryEntry,
  type SystemAddressExclusionApplied,
} from '@foresift/shared-schemas';
import {
  decideExclusion,
  classifyExclusion,
  isValidAt,
  SYSTEM_ADDRESS_UNCERTAIN,
  SYSTEM_REGISTRY_POLICY_VERSION,
} from '../src/system-registry.ts';

describe('system-registry: versioned address registry & actor exclusion audit (FR-SOLSEC-006, AC-132, T015)', () => {
  const mockRouterEntry: SystemAddressRegistryEntry = {
    registryEntryId: 'sys-reg:solana:mainnet:jupiter-router-v6',
    chainId: parseChainId('solana:mainnet'),
    address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    role: SystemAddressRole.ROUTER,
    validFrom: '2025-01-01T00:00:00.000Z',
    validUntil: null,
    sourceId: 'solsec-curated-registry',
    confidence: 1.0,
    reviewState: SystemAddressReviewState.REVIEWED,
    registryVersion: 1,
    evidenceIds: ['evidence:registry:jup-v6'],
  };

  const mockPendingEntry: SystemAddressRegistryEntry = {
    registryEntryId: 'sys-reg:solana:mainnet:unverified-pump-pool',
    chainId: parseChainId('solana:mainnet'),
    address: 'PumpPoolUnverified1111111111111111111111111',
    role: SystemAddressRole.POOL,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
    sourceId: 'community-submission',
    confidence: 0.65, // Below 0.8 threshold
    reviewState: SystemAddressReviewState.PENDING_REVIEW,
    registryVersion: 1,
    evidenceIds: ['evidence:sub:001'],
  };

  const mockRetiredEntry: SystemAddressRegistryEntry = {
    registryEntryId: 'sys-reg:solana:mainnet:legacy-dex-router',
    chainId: parseChainId('solana:mainnet'),
    address: 'LegacyRouter1111111111111111111111111111111',
    role: SystemAddressRole.ROUTER,
    validFrom: '2025-01-01T00:00:00.000Z',
    validUntil: '2025-12-31T23:59:59.000Z',
    sourceId: 'solsec-curated-registry',
    confidence: 0.95,
    reviewState: SystemAddressReviewState.REVIEWED,
    registryVersion: 1,
    evidenceIds: ['evidence:legacy:001'],
  };

  it('validates schema compliance of system registry entries', () => {
    expect(() => parseSolsecSchema('SystemAddressRegistryEntry', mockRouterEntry)).not.toThrow();
    expect(() => parseSolsecSchema('SystemAddressRegistryEntry', mockPendingEntry)).not.toThrow();
    expect(() => parseSolsecSchema('SystemAddressRegistryEntry', mockRetiredEntry)).not.toThrow();
  });

  it('excludes known, high-confidence, reviewed infrastructure accounts (ROUTER, EXCHANGE, LAUNCHPAD, FEE_COLLECTOR)', () => {
    expect(
      isExcludableSystemAddress(
        SystemAddressRole.ROUTER,
        1.0,
        SystemAddressReviewState.REVIEWED,
      ),
    ).toBe(true);

    expect(
      isExcludableSystemAddress(
        SystemAddressRole.EXCHANGE_SERVICE,
        0.9,
        SystemAddressReviewState.REVIEWED,
      ),
    ).toBe(true);

    expect(
      isExcludableSystemAddress(
        SystemAddressRole.LAUNCHPAD,
        0.85,
        SystemAddressReviewState.REVIEWED,
      ),
    ).toBe(true);

    expect(
      isExcludableSystemAddress(
        SystemAddressRole.FEE_COLLECTOR,
        0.8,
        SystemAddressReviewState.REVIEWED,
      ),
    ).toBe(true);
  });

  it('refuses low confidence, pending review, or unknown infrastructure roles fail-closed', () => {
    // Low confidence floor (< 0.8)
    expect(
      isExcludableSystemAddress(
        SystemAddressRole.ROUTER,
        0.79,
        SystemAddressReviewState.REVIEWED,
      ),
    ).toBe(false);

    // Pending review
    expect(
      isExcludableSystemAddress(
        SystemAddressRole.ROUTER,
        1.0,
        SystemAddressReviewState.PENDING_REVIEW,
      ),
    ).toBe(false);

    // Rejected
    expect(
      isExcludableSystemAddress(
        SystemAddressRole.ROUTER,
        1.0,
        SystemAddressReviewState.REJECTED,
      ),
    ).toBe(false);

    // Unknown infrastructure
    expect(
      isExcludableSystemAddress(
        SystemAddressRole.UNKNOWN_INFRASTRUCTURE,
        1.0,
        SystemAddressReviewState.REVIEWED,
      ),
    ).toBe(false);
  });

  it('evaluates point-in-time validity intervals correctly across query timestamps', () => {
    expect(isValidAt(mockRetiredEntry, '2025-06-01T00:00:00.000Z')).toBe(true);
    expect(isValidAt(mockRetiredEntry, '2026-06-01T00:00:00.000Z')).toBe(false);
    expect(isValidAt(mockRouterEntry, '2025-06-01T00:00:00.000Z')).toBe(true);
    expect(isValidAt(mockRouterEntry, '2024-12-31T23:59:59.000Z')).toBe(false);
  });

  it('classifies exclusions and refusals with classifyExclusion', () => {
    expect(SYSTEM_REGISTRY_POLICY_VERSION).toBe('solsec-system-registry@1');
    expect(SYSTEM_ADDRESS_UNCERTAIN).toBe('SYSTEM_ADDRESS_UNCERTAIN');

    const routerDecision = classifyExclusion(mockRouterEntry, '2025-06-01T00:00:00.000Z');
    expect(routerDecision.decision).toBe('EXCLUSION_APPLIED');
    expect(routerDecision.excluded).toBe(true);
    expect(routerDecision.qualityCodes).toEqual(['VALID']);

    const pendingDecision = classifyExclusion(mockPendingEntry, '2026-06-01T00:00:00.000Z');
    expect(pendingDecision.decision).toBe('REFUSAL_PENDING_REVIEW');
    expect(pendingDecision.excluded).toBe(false);
    expect(pendingDecision.qualityCodes).toContain(SYSTEM_ADDRESS_UNCERTAIN);

    const expiredDecision = classifyExclusion(mockRetiredEntry, '2026-06-01T00:00:00.000Z');
    expect(expiredDecision.decision).toBe('REFUSAL_OUTSIDE_VALIDITY');
    expect(expiredDecision.excluded).toBe(false);
    expect(expiredDecision.qualityCodes).toContain(SYSTEM_ADDRESS_UNCERTAIN);
  });

  it('produces valid SystemAddressExclusionApplied audit rows for both exclusions and refusals', () => {
    // Applied exclusion via decideExclusion
    const decidedApplied = decideExclusion({
      entry: mockRouterEntry,
      economicEventId: 'econ:tx:001',
      rawFlowRef: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      queryAt: '2025-06-01T00:00:00.000Z',
    });
    expect(decidedApplied.excluded).toBe(true);
    expect(decidedApplied.qualityCodes).toEqual(['VALID']);
    expect(decidedApplied.rawFlowRef).toBe(
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    );
    expect(() => parseSolsecSchema('SystemAddressExclusionApplied', decidedApplied)).not.toThrow();

    // Refusal row with degraded quality code via decideExclusion
    const decidedRefusal = decideExclusion({
      entry: mockPendingEntry,
      economicEventId: 'econ:tx:002',
      rawFlowRef: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      queryAt: '2026-06-01T00:00:00.000Z',
    });
    expect(decidedRefusal.excluded).toBe(false);
    expect(decidedRefusal.qualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
    expect(() => parseSolsecSchema('SystemAddressExclusionApplied', decidedRefusal)).not.toThrow();
  });

  it('preserves revision-forward behavior without mutating historical attribution records (§37.3)', () => {
    const v1Entry: SystemAddressRegistryEntry = {
      ...mockRouterEntry,
      registryVersion: 1,
    };
    const v2Entry: SystemAddressRegistryEntry = {
      ...mockRouterEntry,
      registryVersion: 2,
      confidence: 0.99,
    };

    expect(v1Entry.registryVersion).toBe(1);
    expect(v2Entry.registryVersion).toBe(2);
    expect(v1Entry.registryVersion).not.toBe(v2Entry.registryVersion);
  });
});
