/**
 * T013: Per-Client Rate Limits & Concurrency Admission suite (FR-MCP-009, INV-009, AC-251).
 * Tests apps/api/src/mcp/rate-limits.ts for token-bucket rate admission, concurrent request caps,
 * deterministic refusal, and fenced idempotent state transitions.
 */
import { describe, expect, it } from 'bun:test';

async function loadRateLimitsModule() {
  return await import('../src/mcp/rate-limits.ts');
}

describe('T013: MCP per-client rate limits and concurrency (AC-251, INV-009)', () => {
  it('admits requests within token-bucket budget and increments in-flight concurrency', async () => {
    const { McpRateLimiter } = await loadRateLimitsModule();
    const limiter = new McpRateLimiter({
      defaultCapacity: 10,
      refillPerSecond: 1,
      concurrencyLimit: 5,
    });

    const admission = await limiter.admit({
      credentialId: 'cred_standard_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 1,
    });

    expect(admission.admitted).toBe(true);
    expect(admission.remainingTokens).toBeLessThan(10);
    expect(admission.currentInFlight).toBe(1);

    // Release in-flight slot on request completion
    await limiter.release({
      credentialId: 'cred_standard_001',
      rateLimitClass: 'STANDARD_FREE',
    });
    const state = await limiter.getState('cred_standard_001', 'STANDARD_FREE');
    expect(state.inFlight).toBe(0);
  });

  it('refuses requests when token-bucket capacity is exhausted', async () => {
    const { McpRateLimiter } = await loadRateLimitsModule();
    const limiter = new McpRateLimiter({
      defaultCapacity: 2,
      refillPerSecond: 0.1,
      concurrencyLimit: 10,
    });

    // Consume all tokens
    await limiter.admit({
      credentialId: 'cred_rate_exhaust_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 2,
    });

    // Next request must be refused
    const refused = await limiter.admit({
      credentialId: 'cred_rate_exhaust_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 1,
    });
    expect(refused.admitted).toBe(false);
    expect(refused.refusalReason).toBe('RATE_LIMIT_EXCEEDED');
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refuses requests when concurrency limit is reached', async () => {
    const { McpRateLimiter } = await loadRateLimitsModule();
    const limiter = new McpRateLimiter({
      defaultCapacity: 100,
      refillPerSecond: 10,
      concurrencyLimit: 2,
    });

    // 2 in-flight requests
    await limiter.admit({
      credentialId: 'cred_concurrent_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 1,
    });
    await limiter.admit({
      credentialId: 'cred_concurrent_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 1,
    });

    // 3rd concurrent request refused
    const refused = await limiter.admit({
      credentialId: 'cred_concurrent_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 1,
    });
    expect(refused.admitted).toBe(false);
    expect(refused.refusalReason).toBe('CONCURRENCY_LIMIT_EXCEEDED');
  });

  it('fences state transitions and ensures idempotent releases (INV-009)', async () => {
    const { McpRateLimiter } = await loadRateLimitsModule();
    const limiter = new McpRateLimiter({
      defaultCapacity: 10,
      refillPerSecond: 1,
      concurrencyLimit: 5,
    });

    await limiter.admit({
      credentialId: 'cred_fenced_001',
      rateLimitClass: 'STANDARD_FREE',
      cost: 1,
    });

    // Multiple release calls should not cause in_flight to go below 0
    await limiter.release({ credentialId: 'cred_fenced_001', rateLimitClass: 'STANDARD_FREE' });
    await limiter.release({ credentialId: 'cred_fenced_001', rateLimitClass: 'STANDARD_FREE' });

    const state = await limiter.getState('cred_fenced_001', 'STANDARD_FREE');
    expect(state.inFlight).toBe(0);
  });
});
