/**
 * Direct-Chain / Indexer Access Gate & Capacity Incident Law (FR-DISC-008).
 * Normative text:
 * FR-DISC-008: "Direct-chain/indexer access is selective verification/backfill by default
 * and cannot silently become broad paid ingestion."
 */
import { describe, expect, it } from 'bun:test';

export type ChainAccessIntent =
  | 'SELECTIVE_VERIFICATION'
  | 'BOUNDED_BACKFILL'
  | 'BROAD_INGESTION_ATTEMPT';

export interface ChainAccessRequest {
  readonly requestId: string;
  readonly intent: ChainAccessIntent;
  readonly candidateId?: string;
  readonly slotRange?: { startSlot: bigint; endSlot: bigint };
  readonly estimatedCredits: number;
  readonly maxCreditAllowance: number;
  readonly broadScanningRequested: boolean;
}

export interface AccessGateResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly incidentTriggered: boolean;
  readonly incidentType?: string;
}

function evaluateChainAccessGate(
  request: ChainAccessRequest,
  currentUsageCredits: number,
  budgetCapCredits: number,
): AccessGateResult {
  // Broad ingestion requests are strictly refused
  if (request.broadScanningRequested || request.intent === 'BROAD_INGESTION_ATTEMPT') {
    return {
      allowed: false,
      reason: 'Direct chain access cannot be used for broad paid ingestion (FR-DISC-008)',
      incidentTriggered: true,
      incidentType: 'CHAIN_ACCESS_BROAD_INGESTION_POLICY_BREACH',
    };
  }

  // Selective verification requires a specific candidate ID
  if (request.intent === 'SELECTIVE_VERIFICATION' && !request.candidateId) {
    return {
      allowed: false,
      reason: 'Selective verification requires explicit candidateId',
      incidentTriggered: false,
    };
  }

  // Bounded backfill requires a finite slot range within max limits
  if (request.intent === 'BOUNDED_BACKFILL') {
    if (!request.slotRange) {
      return {
        allowed: false,
        reason: 'Bounded backfill requires explicit slotRange',
        incidentTriggered: false,
      };
    }
    const slotSpan = request.slotRange.endSlot - request.slotRange.startSlot;
    if (slotSpan > 10_000n) {
      return {
        allowed: false,
        reason: 'Backfill slot range exceeds maximum bound (10,000 slots)',
        incidentTriggered: true,
        incidentType: 'CHAIN_ACCESS_BACKFILL_BOUND_EXCEEDED',
      };
    }
  }

  // Check budget capacity
  if (currentUsageCredits + request.estimatedCredits > budgetCapCredits) {
    return {
      allowed: false,
      reason: 'Direct chain access credit consumption exceeds budget cap',
      incidentTriggered: true,
      incidentType: 'CHAIN_ACCESS_CREDIT_CAP_BREACH',
    };
  }

  return {
    allowed: true,
    incidentTriggered: false,
  };
}

describe('Direct-Chain / Indexer Access Gate (FR-DISC-008)', () => {
  it('allows selective verification of promoted candidates within credit budget', () => {
    const validVerification: ChainAccessRequest = {
      requestId: 'req_verif_001',
      intent: 'SELECTIVE_VERIFICATION',
      candidateId: 'cand_promoted_001',
      estimatedCredits: 5,
      maxCreditAllowance: 20,
      broadScanningRequested: false,
    };

    const result = evaluateChainAccessGate(validVerification, 100, 500);
    expect(result.allowed).toBe(true);
    expect(result.incidentTriggered).toBe(false);
  });

  it('allows bounded backfill for finite slot windows within 10,000 slots', () => {
    const validBackfill: ChainAccessRequest = {
      requestId: 'req_backfill_002',
      intent: 'BOUNDED_BACKFILL',
      slotRange: { startSlot: 300100000n, endSlot: 300100500n },
      estimatedCredits: 50,
      maxCreditAllowance: 100,
      broadScanningRequested: false,
    };

    const result = evaluateChainAccessGate(validBackfill, 100, 500);
    expect(result.allowed).toBe(true);
    expect(result.incidentTriggered).toBe(false);
  });

  it('blocks broad ingestion attempt and creates a policy breach incident (FR-DISC-008)', () => {
    const broadIngestion: ChainAccessRequest = {
      requestId: 'req_broad_003',
      intent: 'BROAD_INGESTION_ATTEMPT',
      estimatedCredits: 5000,
      maxCreditAllowance: 100,
      broadScanningRequested: true,
    };

    const result = evaluateChainAccessGate(broadIngestion, 100, 500);
    expect(result.allowed).toBe(false);
    expect(result.incidentTriggered).toBe(true);
    expect(result.incidentType).toBe('CHAIN_ACCESS_BROAD_INGESTION_POLICY_BREACH');
    expect(result.reason).toContain('broad paid ingestion');
  });

  it('triggers capacity incident when access request exceeds budget cap', () => {
    const overBudgetReq: ChainAccessRequest = {
      requestId: 'req_overbudget_004',
      intent: 'SELECTIVE_VERIFICATION',
      candidateId: 'cand_004',
      estimatedCredits: 450,
      maxCreditAllowance: 500,
      broadScanningRequested: false,
    };

    const result = evaluateChainAccessGate(overBudgetReq, 100, 500); // 100 + 450 = 550 > 500
    expect(result.allowed).toBe(false);
    expect(result.incidentTriggered).toBe(true);
    expect(result.incidentType).toBe('CHAIN_ACCESS_CREDIT_CAP_BREACH');
  });
});
