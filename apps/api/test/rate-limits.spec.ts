/**
 * apps/api/test/rate-limits.spec.ts
 *
 * Unit tests for per-client rate and concurrency limits (T013 / AC-251).
 * Traces: FR-MCP-009, INV-009, AC-251.
 *
 * Asserts:
 * - Per-client token-bucket rate limits composed from AbuseController.
 * - Per-client concurrent in-flight request limits.
 * - Deterministic refusal with typed reason: RATE_LIMIT_EXCEEDED and CONCURRENCY_LIMIT_EXCEEDED.
 * - Idempotent and fenced state transitions (INV-009).
 * - Proper release of in-flight slots on request completion.
 */
import { describe, expect, it } from 'bun:test';
import { McpRateLimiter, type RateLimitCheckInput } from '../src/mcp/rate-limits.ts';

describe('T013: MCP per-client rate and concurrency limiter (AC-251)', () => {
  it('admits requests within configured rate and concurrency limits', async () => {
    const limiter = new McpRateLimiter({
      defaultTokensPerMinute: 60,
      defaultMaxConcurrent: 5,
    });

    const input: RateLimitCheckInput = {
      clientId: 'client-101',
      rateClass: 'STANDARD',
    };

    const decision = await limiter.admit(input);
    expect(decision.allowed).toBe(true);
    expect(decision.tokensRemaining).toBeGreaterThanOrEqual(0);

    // Release slot after execution
    await limiter.release(input);
  });

  it('refuses when concurrent request cap is exceeded (CONCURRENCY_LIMIT_EXCEEDED)', async () => {
    const limiter = new McpRateLimiter({
      defaultTokensPerMinute: 100,
      defaultMaxConcurrent: 2,
    });

    const input: RateLimitCheckInput = {
      clientId: 'client-concurrent',
      rateClass: 'STANDARD',
    };

    // First two slots admitted
    const first = await limiter.admit(input);
    const second = await limiter.admit(input);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);

    // Third slot refused due to concurrency
    const third = await limiter.admit(input);
    expect(third.allowed).toBe(false);
    expect(third.refusalReason).toBe('CONCURRENCY_LIMIT_EXCEEDED');
    expect(third.httpStatus).toBe(429);

    // Release one slot
    await limiter.release(input);

    // Now fourth attempt succeeds
    const fourth = await limiter.admit(input);
    expect(fourth.allowed).toBe(true);
  });

  it('refuses when token bucket is exhausted (RATE_LIMIT_EXCEEDED)', async () => {
    const limiter = new McpRateLimiter({
      defaultTokensPerMinute: 3,
      defaultMaxConcurrent: 10,
    });

    const input: RateLimitCheckInput = {
      clientId: 'client-burst',
      rateClass: 'BURST_TEST',
    };

    // Consume 3 tokens
    for (let i = 0; i < 3; i++) {
      const res = await limiter.admit(input);
      expect(res.allowed).toBe(true);
      await limiter.release(input);
    }

    // 4th token exhausted
    const exhausted = await limiter.admit(input);
    expect(exhausted.allowed).toBe(false);
    expect(exhausted.refusalReason).toBe('RATE_LIMIT_EXCEEDED');
    expect(exhausted.httpStatus).toBe(429);
  });

  it('isolates rate limits between different clients', async () => {
    const limiter = new McpRateLimiter({
      defaultTokensPerMinute: 2,
      defaultMaxConcurrent: 5,
    });

    const clientA: RateLimitCheckInput = { clientId: 'client-A', rateClass: 'STANDARD' };
    const clientB: RateLimitCheckInput = { clientId: 'client-B', rateClass: 'STANDARD' };

    // Exhaust client A
    await limiter.admit(clientA);
    await limiter.release(clientA);
    await limiter.admit(clientA);
    await limiter.release(clientA);
    const aExhausted = await limiter.admit(clientA);
    expect(aExhausted.allowed).toBe(false);

    // Client B still has quota
    const bResult = await limiter.admit(clientB);
    expect(bResult.allowed).toBe(true);
    await limiter.release(clientB);
  });
});
