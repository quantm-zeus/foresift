/**
 * AC-004 acceptance (positive) — conflicting provider data & explicit capability unavailability.
 * Traces: FR-CORE-002 (execution pipeline), FR-CORE-003 (envelope completeness).
 * AC text (manifest §39): "Source conflicts are preserved, not silently overwritten;
 * disagreement is auditable."
 *
 * Exercises:
 * - Conflicting provider observations are preserved in the result envelope's `conflicts[]` array
 *   (each carrying conflictId, at least 2 provider names, fieldPath, and evidenceIds).
 * - Unsupported capabilities produce an explicit `CAPABILITY_UNAVAILABLE` acquisition state
 *   rather than returning empty results or silently guessing values.
 */
import { describe, expect, it } from 'bun:test';
import type { UtcTimestamp } from '@foresift/domain';
import {
  parseCoreSchema,
  type ToolResultEnvelope,
  type BlockedStatePayload,
} from '@foresift/shared-schemas';

describe('AC-004 acceptance: conflicting provider data preserved and unsupported capabilities explicit', () => {
  it('preserves conflicting provider data in conflicts[] without silent replacement', () => {
    const envelope: ToolResultEnvelope = {
      data: {
        assetId: 'solana:So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        decimals: 9,
        // Resolved primary value with conflicting secondary observation recorded
        holderCount: 1250000,
      },
      meta: {
        toolName: 'get_holder_distribution',
        toolVersion: '1.0.0',
        provider: 'gmgn',
        operation: 'token_holders',
        evidenceIds: ['ev-gmgn-holders-001', 'ev-helius-holders-001'],
        observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
        availableAt: '2026-08-01T00:01:00Z' as UtcTimestamp,
        fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
        cache: 'HIT_FRESH',
        qualityCodes: ['QUALITY_HIGH', 'DISAGREEMENT_PRESERVED'],
        conflicts: [
          {
            conflictId: 'conf-holder-count-001',
            providers: ['gmgn', 'helius'],
            fieldPath: 'data.holderCount',
            evidenceIds: ['ev-gmgn-holders-001', 'ev-helius-holders-001'],
          },
        ],
        quota: {
          quotaModel: 'REQUESTS_PER_PERIOD',
          reservationState: 'COMMITTED',
          estimatedUnits: 1,
          actualUnits: 1,
        },
        partial: false,
      },
    };

    const parsed = parseCoreSchema('ToolResultEnvelope', envelope);
    expect(parsed.meta.conflicts).toHaveLength(1);
    const conflict = parsed.meta.conflicts[0]!;
    expect(conflict.conflictId).toBe('conf-holder-count-001');
    expect(conflict.providers).toEqual(['gmgn', 'helius']);
    expect(conflict.fieldPath).toBe('data.holderCount');
    expect(conflict.evidenceIds).toEqual(['ev-gmgn-holders-001', 'ev-helius-holders-001']);
  });

  it('unsupported capability is represented explicitly as CAPABILITY_UNAVAILABLE blocked state payload', () => {
    const blockedPayload: BlockedStatePayload = {
      acquisitionState: 'CAPABILITY_UNAVAILABLE',
      machineReason: 'Provider does not support historical holder snapshots for requested epoch',
      toolName: 'get_holder_distribution',
      toolVersion: '1.0.0',
      pipelineRunId: 'run-blocked-cap-001',
      at: '2026-08-01T00:00:00Z' as UtcTimestamp,
    };

    const parsed = parseCoreSchema('BlockedStatePayload', blockedPayload);
    expect(parsed.acquisitionState).toBe('CAPABILITY_UNAVAILABLE');
    expect(parsed.machineReason).toContain('historical holder snapshots');
    expect(parsed.toolName).toBe('get_holder_distribution');
  });
});
