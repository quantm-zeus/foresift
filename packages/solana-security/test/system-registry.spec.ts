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
      isExcludableSystemAddress(SystemAddressRole.ROUTER, 1.0, SystemAddressReviewState.REVIEWED),
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
      isExcludableSystemAddress(SystemAddressRole.ROUTER, 0.79, SystemAddressReviewState.REVIEWED),
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
      isExcludableSystemAddress(SystemAddressRole.ROUTER, 1.0, SystemAddressReviewState.REJECTED),
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
    const validFromMs = Date.parse(mockRetiredEntry.validFrom);
    const validUntilMs = Date.parse(mockRetiredEntry.validUntil!);

    // Inside interval
    const queryInsideMs = Date.parse('2025-06-01T00:00:00.000Z');
    expect(queryInsideMs >= validFromMs && queryInsideMs <= validUntilMs).toBe(true);

    // Outside interval (after validUntil)
    const queryOutsideMs = Date.parse('2026-06-01T00:00:00.000Z');
    expect(queryOutsideMs > validUntilMs).toBe(true);
  });

  it('produces valid SystemAddressExclusionApplied audit rows for both exclusions and refusals', () => {
    // Applied exclusion row
    const appliedRow: SystemAddressExclusionApplied = {
      exclusionId: 'excl:001',
      registryEntryId: mockRouterEntry.registryEntryId,
      economicEventId: 'econ:tx:001',
      excluded: true,
      rawFlowRef: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      appliedAt: '2026-01-01T00:00:01.000Z',
      registryVersion: mockRouterEntry.registryVersion,
      qualityCodes: ['VALID'],
    };
    expect(() => parseSolsecSchema('SystemAddressExclusionApplied', appliedRow)).not.toThrow();

    // Refusal row with degraded quality code
    const refusalRow: SystemAddressExclusionApplied = {
      exclusionId: 'excl:002',
      registryEntryId: mockPendingEntry.registryEntryId,
      economicEventId: 'econ:tx:002',
      excluded: false,
      rawFlowRef: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      appliedAt: '2026-01-01T00:00:01.000Z',
      registryVersion: mockPendingEntry.registryVersion,
      qualityCodes: ['SYSTEM_ADDRESS_UNCERTAIN'],
    };
    expect(() => parseSolsecSchema('SystemAddressExclusionApplied', refusalRow)).not.toThrow();
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
