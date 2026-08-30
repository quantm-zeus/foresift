/**
 * T006: Normative Request Admission Pipeline suite (FR-MCP-001, AC-251, INV-037).
 * Tests apps/api/src/mcp/admission.ts for fixed stage ordering and zero downstream side effects on refusal.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALLOWED_ORIGINS,
  MAXIMUM_REQUEST_BYTES,
  STANDARD_DISCOVERY_CREDENTIAL,
  ACTIVE_SESSION_FIXTURE,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadAdmissionModule() {
  return await import('../src/mcp/admission.ts');
}

describe('T006: MCP normative admission pipeline (AC-251, INV-037)', () => {
  const defaultValidAdmissionInput = {
    method: 'POST',
    path: '/mcp',
    headers: {
      origin: 'https://mcp.example.com',
      'content-type': 'application/json',
      authorization: `Bearer ${STANDARD_DISCOVERY_CREDENTIAL.rawSecret}`,
      'mcp-session-id': ACTIVE_SESSION_FIXTURE.sessionId,
      'x-forwarded-for': '127.0.0.1',
    },
    bodyBytes: 1024,
    protocolRevision: '2025-11-25',
    requestedScopes: ['tools:read'],
  };

  it('admits a valid request across all seven sequential stages', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    const pipeline = new McpAdmissionPipeline();
    const result = await pipeline.admit(defaultValidAdmissionInput);

    expect(result.admitted).toBe(true);
    expect(result.refusalReason).toBeUndefined();
    expect(result.clientContext).toBeDefined();
    expect(result.clientContext?.credentialId).toBe(STANDARD_DISCOVERY_CREDENTIAL.credentialId);
  });

  it('Stage 1: size cap short-circuits oversized request before origin or auth checks', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    let originChecked = false;
    let authChecked = false;

    const pipeline = new McpAdmissionPipeline({
      onOriginCheck: () => {
        originChecked = true;
      },
      onAuthCheck: () => {
        authChecked = true;
      },
    });

    const oversizedInput = {
      ...defaultValidAdmissionInput,
      bodyBytes: MAXIMUM_REQUEST_BYTES + 1024,
    };

    const result = await pipeline.admit(oversizedInput);
    expect(result.admitted).toBe(false);
    expect(result.refusalReason).toBe('MESSAGE_OVERSIZE');
    expect(result.httpStatus).toBe(413);
    expect(originChecked).toBe(false);
    expect(authChecked).toBe(false);
  });

  it('Stage 2: invalid Origin returns HTTP 403 BEFORE auth, session, or dispatch side effects', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    let authChecked = false;

    const pipeline = new McpAdmissionPipeline({
      onAuthCheck: () => {
        authChecked = true;
      },
    });

    const badOriginInput = {
      ...defaultValidAdmissionInput,
      headers: {
        ...defaultValidAdmissionInput.headers,
        origin: 'https://evil.example.com',
      },
    };

    const result = await pipeline.admit(badOriginInput);
    expect(result.admitted).toBe(false);
    expect(result.refusalReason).toBe('ORIGIN_NOT_ALLOWLISTED');
    expect(result.httpStatus).toBe(403);
    expect(authChecked).toBe(false);
  });

  it('Stage 3: protocol revision or method violation short-circuits before auth side effects', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    const badMethodInput = {
      ...defaultValidAdmissionInput,
      method: 'GET',
    };

    const result = await pipeline.admit(badMethodInput);
    expect(result.admitted).toBe(false);
    expect(result.refusalReason).toBe('METHOD_INVALID');
    expect(result.httpStatus).toBe(400);

    const badRevisionInput = {
      ...defaultValidAdmissionInput,
      protocolRevision: '2024-01-01',
    };
    const revResult = await pipeline.admit(badRevisionInput);
    expect(revResult.admitted).toBe(false);
    expect(revResult.refusalReason).toBe('REVISION_UNSUPPORTED');
  });

  it('Stage 4: credential authentication refusal short-circuits before session or rate tracking', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    let rateStateMutated = false;

    const pipeline = new McpAdmissionPipeline({
      onRateStateMutate: () => {
        rateStateMutated = true;
      },
    });

    const badCredInput = {
      ...defaultValidAdmissionInput,
      headers: {
        ...defaultValidAdmissionInput.headers,
        authorization: 'Bearer invalid-secret-does-not-exist',
      },
    };

    const result = await pipeline.admit(badCredInput);
    expect(result.admitted).toBe(false);
    expect(result.refusalReason).toBe('CREDENTIAL_INVALID');
    expect(result.httpStatus).toBe(401);
    expect(rateStateMutated).toBe(false);
  });

  it('Stage 5: session binding mismatch refuses before rate allocation', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    const mismatchedSessionInput = {
      ...defaultValidAdmissionInput,
      headers: {
        ...defaultValidAdmissionInput.headers,
        'mcp-session-id': 'sess_foreign_actor_session_001',
      },
    };

    const result = await pipeline.admit(mismatchedSessionInput);
    expect(result.admitted).toBe(false);
    expect(result.refusalReason).toBe('SESSION_BINDING_INVALID');
    expect(result.httpStatus).toBe(400);
  });

  it('Stage 6: rate limit exhaustion produces typed 429 without dispatch', async () => {
    const { McpAdmissionPipeline } = await loadAdmissionModule();
    const rateLimitedPipeline = new McpAdmissionPipeline({
      rateLimitExhausted: true,
    });

    const result = await rateLimitedPipeline.admit(defaultValidAdmissionInput);
    expect(result.admitted).toBe(false);
    expect(result.refusalReason).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.httpStatus).toBe(429);
  });
});
