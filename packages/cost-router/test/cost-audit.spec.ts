/**
 * Cost audit shaping and secret-redaction units (FR-COST-007, AC-100).
 *
 * Asserts:
 * - Shapes FR-COST-007 denial payloads: { candidate, caller, reason, alternative }.
 * - Typed fields mirror CostDenialRecordSchema.
 * - Never emits secrets (redacts API keys, credentials, private tokens).
 */
import { describe, expect, it } from 'bun:test';

describe('cost-audit payload shaping and secret redaction (FR-COST-007)', () => {
  it('shapes denial audit payload mirroring CostDenialRecordSchema fields', async () => {
    let AuditModule: Record<string, unknown>;
    try {
      AuditModule = (await import('../src/cost-audit.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('COST_AUDIT_NOT_IMPLEMENTED: src/cost-audit.ts missing');
    }

    const formatCostDenial = AuditModule.formatCostDenial as (input: {
      candidate: string;
      caller: string;
      reason: string;
      alternative: string;
      provider?: string;
      operation?: string;
    }) => Record<string, unknown>;

    const denial = formatCostDenial({
      candidate: 'So11111111111111111111111111111111111111112',
      caller: 'discovery-engine',
      reason: 'PAID_BLOCKED: paid operations prohibited in strict free',
      alternative: 'RETURN_CACHE',
      provider: 'coinglass',
      operation: 'liquidation_orderbook',
    });

    expect(denial.candidate).toBe('So11111111111111111111111111111111111111112');
    expect(denial.caller).toBe('discovery-engine');
    expect(denial.reason).toContain('PAID_BLOCKED');
    expect(denial.alternative).toBe('RETURN_CACHE');
  });

  it('redacts sensitive credentials and secrets from denial audit payloads', async () => {
    let AuditModule: Record<string, unknown>;
    try {
      AuditModule = (await import('../src/cost-audit.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('COST_AUDIT_NOT_IMPLEMENTED: src/cost-audit.ts missing');
    }

    const formatCostDenial = AuditModule.formatCostDenial as (input: {
      candidate: string;
      caller: string;
      reason: string;
      alternative: string;
      context?: Record<string, unknown>;
    }) => Record<string, unknown>;

    const denial = formatCostDenial({
      candidate: 'So11111111111111111111111111111111111111112',
      caller: 'discovery-engine',
      reason: 'UNKNOWN_COST: key=sk_live_secret12345 is invalid',
      alternative: 'DOWNGRADE_DEPTH',
      context: {
        apiKey: 'secret_key_abcdef1234567890',
        authorization: 'Bearer sensitive-token-987654',
      },
    });

    const serialized = JSON.stringify(denial);
    expect(serialized).not.toContain('secret_key_abcdef');
    expect(serialized).not.toContain('sensitive-token-987654');
    expect(serialized).not.toContain('sk_live_secret12345');
    expect(serialized).toContain('[REDACTED]');
  });
});
