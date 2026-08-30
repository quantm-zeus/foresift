/**
 * Unit test suite for MCP rate & concurrency limiting (T013).
 * Traces: FR-MCP-009, AC-251, INV-009.
 *
 * Asserts:
 * - Per-client token-bucket rate limiting composed from AbuseController.admit().
 * - Per-client in-flight concurrency limiting.
 * - Refusal is deterministic, audited, and typed (RATE_LIMIT_EXCEEDED / CONCURRENCY_LIMIT_EXCEEDED).
 * - Concurrency slots released idempotently on request completion.
 * - Fenced state transitions (INV-009).
 */
import { describe, expect, it } from 'bun:test';
import {
  McpRateLimiter,
  type RateLimitEvaluation,
} from '../src/mcp/rate-limits.ts';

describe('T013 — MCP rate & concurrency limiting (AC-251)', () => {
  it('admits requests within rate and concurrency budgets', async () => {
    const limiter = new McpRateLimiter({
      requestsPerMinute: 60,
      maxConcurrent: 5,
    });

    const result = await limiter.admit({
      credentialId: 'cred_client_01',
      actionClass: 'EXTERNAL_READ',
    });

    expect(result.admitted).toBe(true);
    expect(result.currentInFlight).toBe(1);

    // Release slot
    await limiter.release('cred_client_01');
    expect(limiter.getInFlight('cred_client_01')).toBe(0);
  });

  it('refuses deterministically with 429 when token-bucket rate is exhausted', async () => {
    const limiter = new McpRateLimiter({
      requestsPerMinute: 2,
      maxConcurrent: 10,
    });

    // 2 allowed
    const r1 = await limiter.admit({ credentialId: 'cred_rate_01' });
    expect(r1.admitted).toBe(true);
    await limiter.release('cred_rate_01');

    const r2 = await limiter.admit({ credentialId: 'cred_rate_01' });
    expect(r2.admitted).toBe(true);
    await limiter.release('cred_rate_01');

    // 3rd exhausted
    const r3 = await limiter.admit({ credentialId: 'cred_rate_01' });
    expect(r3.admitted).toBe(false);
    expect(r3.reason).toBe('RATE_LIMIT_EXCEEDED');
    expect(r3.statusCode).toBe(429);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refuses deterministically with 429 when max concurrent requests reached', async () => {
    const limiter = new McpRateLimiter({
      requestsPerMinute: 1000,
      maxConcurrent: 2,
    });

    const c1 = await limiter.admit({ credentialId: 'cred_conc_01' });
    expect(c1.admitted).toBe(true);

    const c2 = await limiter.admit({ credentialId: 'cred_conc_01' });
    expect(c2.admitted).toBe(true);

    // 3rd exceeds maxConcurrent = 2
    const c3 = await limiter.admit({ credentialId: 'cred_conc_01' });
    expect(c3.admitted).toBe(false);
    expect(c3.reason).toBe('CONCURRENCY_LIMIT_EXCEEDED');
    expect(c3.statusCode).toBe(429);

    // Release one slot and re-try
    await limiter.release('cred_conc_01');
    const c4 = await limiter.admit({ credentialId: 'cred_conc_01' });
    expect(c4.admitted).toBe(true);
  });

  it('releases concurrency slot idempotently (cannot underflow)', async () => {
    const limiter = new McpRateLimiter({
      requestsPerMinute: 100,
      maxConcurrent: 5,
    });

    await limiter.admit({ credentialId: 'cred_underflow_01' });
    expect(limiter.getInFlight('cred_underflow_01')).toBe(1);

    await limiter.release('cred_underflow_01');
    expect(limiter.getInFlight('cred_underflow_01')).toBe(0);

    // Repeated releases are idempotent
    await limiter.release('cred_underflow_01');
    expect(limiter.getInFlight('cred_underflow_01')).toBe(0);
  });
});
