/**
 * Unit test suite for MCP normative admission pipeline (T006).
 * Traces: FR-MCP-001, AC-251, INV-037, ADR-0022.
 *
 * Asserts:
 * - Single normative admission pipeline executes stages in exact fixed order:
 *   1. Size cap check (request <= 262144 bytes)
 *   2. Origin verification (exact allowlist check)
 *   3. Protocol inspection (revision, method, content-type, correlation)
 *   4. Credential authentication (bearer auth, presentation context)
 *   5. Session resolution (binding match, active lifecycle)
 *   6. Rate & concurrency limits (token-bucket rate, in-flight concurrency)
 *   7. Dispatch (ToolCore execution)
 * - Short-circuits typed deterministic refusals with no downstream effect.
 * - Stage N failure guarantees stages N+1..7 are never evaluated.
 */
import { describe, expect, it } from 'bun:test';
import {
  McpAdmissionPipeline,
  type AdmissionRequestContext,
  type AdmissionStageResult,
} from '../src/mcp/admission.ts';

function createMockRequestContext(overrides?: Partial<AdmissionRequestContext>): AdmissionRequestContext {
  return {
    rawBytes: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'ping' })),
    headers: {
      origin: 'https://mcp.example.com',
      'content-type': 'application/json',
      authorization: 'Bearer sk-mcp-test-valid-key',
    },
    method: 'POST',
    sourceIp: '192.168.1.100',
    protocolRevision: '2025-11-25',
    ...overrides,
  };
}

describe('T006 — MCP normative admission pipeline (AC-251)', () => {
  it('admits a fully compliant request through all stages to dispatch', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext();
    const verdict = await pipeline.admit(ctx);

    expect(verdict.decision).toBe('ADMIT');
    expect(executedStages).toEqual([
      'SIZE_CAP',
      'ORIGIN_GATE',
      'PROTOCOL_GUARD',
      'CREDENTIAL_AUTH',
      'SESSION_RESOLUTION',
      'RATE_ADMISSION',
      'DISPATCH',
    ]);
  });

  it('stage 1: short-circuits on oversized payload before checking Origin or Auth', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 100,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext({
      rawBytes: Buffer.alloc(1000), // Oversized
      headers: {
        origin: 'https://evil.unauthorized.com', // Would fail origin if reached
      },
    });

    const verdict = await pipeline.admit(ctx);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict.reason).toBe('MESSAGE_OVERSIZE');
    expect(verdict.statusCode).toBe(413);
    expect(executedStages).toEqual(['SIZE_CAP']);
  });

  it('stage 2: short-circuits on invalid Origin before protocol guard or credential auth', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext({
      headers: {
        origin: 'https://evil.attacker.com',
        'content-type': 'application/xml', // Invalid content type, but should not be reached
      },
    });

    const verdict = await pipeline.admit(ctx);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict.reason).toBe('ORIGIN_NOT_ALLOWLISTED');
    expect(verdict.statusCode).toBe(403);
    expect(executedStages).toEqual(['SIZE_CAP', 'ORIGIN_GATE']);
  });

  it('stage 3: short-circuits on unsupported protocol revision before credential auth', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext({
      protocolRevision: '2026-draft',
    });

    const verdict = await pipeline.admit(ctx);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict.reason).toBe('REVISION_UNSUPPORTED');
    expect(verdict.statusCode).toBe(400);
    expect(executedStages).toEqual(['SIZE_CAP', 'ORIGIN_GATE', 'PROTOCOL_GUARD']);
  });

  it('stage 4: short-circuits on invalid/missing bearer credential before session resolution', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext({
      headers: {
        origin: 'https://mcp.example.com',
        'content-type': 'application/json',
        authorization: 'Bearer invalid-token',
      },
    });

    const verdict = await pipeline.admit(ctx);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict.reason).toBe('CREDENTIAL_INVALID');
    expect(verdict.statusCode).toBe(401);
    expect(executedStages).toEqual(['SIZE_CAP', 'ORIGIN_GATE', 'PROTOCOL_GUARD', 'CREDENTIAL_AUTH']);
  });

  it('stage 5: short-circuits on session binding mismatch before rate admission', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext({
      sessionId: 'foreign-session-123',
    });

    const verdict = await pipeline.admit(ctx);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict.reason).toBe('SESSION_BINDING_INVALID');
    expect(verdict.statusCode).toBe(404);
    expect(executedStages).toEqual([
      'SIZE_CAP',
      'ORIGIN_GATE',
      'PROTOCOL_GUARD',
      'CREDENTIAL_AUTH',
      'SESSION_RESOLUTION',
    ]);
  });

  it('stage 6: short-circuits on rate limit exhaustion before dispatch', async () => {
    const executedStages: string[] = [];
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.example.com'],
      allowedRevisions: ['2025-11-25'],
      simulateRateExhausted: true,
      onStage: (stage) => executedStages.push(stage),
    });

    const ctx = createMockRequestContext();
    const verdict = await pipeline.admit(ctx);
    expect(verdict.decision).toBe('REFUSE');
    expect(verdict.reason).toBe('RATE_LIMIT_EXCEEDED');
    expect(verdict.statusCode).toBe(429);
    expect(executedStages).toEqual([
      'SIZE_CAP',
      'ORIGIN_GATE',
      'PROTOCOL_GUARD',
      'CREDENTIAL_AUTH',
      'SESSION_RESOLUTION',
      'RATE_ADMISSION',
    ]);
  });
});
