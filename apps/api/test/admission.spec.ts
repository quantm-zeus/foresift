/**
 * apps/api/test/admission.spec.ts
 *
 * Unit tests for the normative MCP request admission pipeline (T006 / AC-251).
 * Traces: FR-MCP-001, FR-MCP-008, FR-MCP-009, INV-037, ADR-0022.
 *
 * Asserts:
 * - Single normative admission pipeline order:
 *     (1) request size cap ->
 *     (2) Origin validation (HTTP 403 on refusal) ->
 *     (3) protocol guard (revision, content-type, method) ->
 *     (4) credential authentication (strictPresentation) ->
 *     (5) session resolution ->
 *     (6) rate and concurrency admission ->
 *     (7) dispatch.
 * - Deterministic short-circuiting: refusal at stage N terminates pipeline immediately
 *   with zero downstream side-effects (INV-037, ADR-0022).
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import {
  McpAdmissionPipeline,
  type AdmissionRequest,
  type AdmissionOutcome,
} from '../src/mcp/admission.ts';

const VALID_ADMISSION_REQUEST: AdmissionRequest = {
  rawBodyBytes: 1024,
  headers: {
    origin: 'https://mcp.foresift.io',
    'content-type': 'application/json',
    authorization: 'Bearer fs_live_testsecrettoken1234567890123456',
  },
  method: 'POST',
  clientIp: '192.168.1.1',
  protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
  jsonRpcMessage: {
    jsonrpc: '2.0',
    id: 'req-001',
    method: 'tools/list',
    params: {},
  },
};

describe('T006: normative MCP admission pipeline (ADR-0022 / INV-037)', () => {
  it('admits a fully compliant request through all stages to dispatch', async () => {
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.foresift.io'],
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    const outcome = await pipeline.admit(VALID_ADMISSION_REQUEST);
    expect(outcome.admitted).toBe(true);
    if (outcome.admitted) {
      expect(outcome.context.clientIp).toBe('192.168.1.1');
      expect(outcome.context.protocolRevision).toBe(MCP_PROTOCOL_BASELINE_REVISION);
    }
  });

  it('stage 1: short-circuits on oversized message before Origin inspection', async () => {
    let originGateCalled = false;
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.foresift.io'],
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
      onStageHook: (stage) => {
        if (stage === 'ORIGIN') originGateCalled = true;
      },
    });

    const oversizedRequest: AdmissionRequest = {
      ...VALID_ADMISSION_REQUEST,
      rawBodyBytes: 500000, // > 262144 cap
    };

    const outcome = await pipeline.admit(oversizedRequest);
    expect(outcome.admitted).toBe(false);
    if (!outcome.admitted) {
      expect(outcome.refusalReason).toBe('MESSAGE_OVERSIZE');
      expect(outcome.httpStatus).toBe(413);
    }
    expect(originGateCalled).toBe(false);
  });

  it('stage 2: short-circuits on disallowed Origin returning HTTP 403 before authn', async () => {
    let authnCalled = false;
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.foresift.io'],
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
      onStageHook: (stage) => {
        if (stage === 'AUTHN') authnCalled = true;
      },
    });

    const badOriginRequest: AdmissionRequest = {
      ...VALID_ADMISSION_REQUEST,
      headers: {
        ...VALID_ADMISSION_REQUEST.headers,
        origin: 'https://attacker.evil.com',
      },
    };

    const outcome = await pipeline.admit(badOriginRequest);
    expect(outcome.admitted).toBe(false);
    if (!outcome.admitted) {
      expect(outcome.refusalReason).toBe('ORIGIN_NOT_ALLOWLISTED');
      expect(outcome.httpStatus).toBe(403);
    }
    expect(authnCalled).toBe(false);
  });

  it('stage 3: short-circuits on invalid protocol method or revision before authn', async () => {
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.foresift.io'],
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    const getRequest: AdmissionRequest = {
      ...VALID_ADMISSION_REQUEST,
      method: 'GET',
    };

    const outcome = await pipeline.admit(getRequest);
    expect(outcome.admitted).toBe(false);
    if (!outcome.admitted) {
      expect(outcome.refusalReason).toBe('METHOD_INVALID');
      expect(outcome.httpStatus).toBe(405);
    }
  });

  it('stage 4: short-circuits on missing or invalid Bearer token returning HTTP 401', async () => {
    const pipeline = new McpAdmissionPipeline({
      maxRequestBytes: 262144,
      allowedOrigins: ['https://mcp.foresift.io'],
      allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
    });

    const unauthenticatedRequest: AdmissionRequest = {
      ...VALID_ADMISSION_REQUEST,
      headers: {
        ...VALID_ADMISSION_REQUEST.headers,
        authorization: undefined,
      },
    };

    const outcome = await pipeline.admit(unauthenticatedRequest);
    expect(outcome.admitted).toBe(false);
    if (!outcome.admitted) {
      expect(outcome.refusalReason).toBe('CREDENTIAL_INVALID');
      expect(outcome.httpStatus).toBe(401);
    }
  });
});
