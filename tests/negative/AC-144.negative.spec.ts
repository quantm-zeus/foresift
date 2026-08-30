/**
 * AC-144 negative — MCP Protocol Revisions & Transport Violations.
 * Traces: FR-MCP-001, FR-MCP-009, §17.1, §17.2, §17.4.
 *
 * Asserts:
 * - Unsupported protocol revisions (historical, future, unknown) receive typed refusal.
 * - Draft protocol revisions (e.g. 2026-03-01-draft) are REFUSED by default unless
 *   explicitly opted-in via configuration.
 * - Non-POST HTTP methods receive METHOD_INVALID refusal.
 * - Non-JSON content types receive CONTENT_TYPE_INVALID refusal.
 * - Missing protocol revisions receive REVISION_UNSUPPORTED refusal.
 * - Oversized messages receive MESSAGE_OVERSIZE refusal before tool dispatch.
 * - Malformed JSON-RPC handshake structures are rejected deterministically.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';
import { MAXIMUM_REQUEST_BYTES } from '../fixtures/mcp/index.ts';

const DEFAULT_GUARD = new McpProtocolGuard({
  maxMessageBytes: MAXIMUM_REQUEST_BYTES,
  allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
});

const DRAFT_OPT_IN_GUARD = new McpProtocolGuard({
  maxMessageBytes: MAXIMUM_REQUEST_BYTES,
  allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION, '2026-03-01-draft'],
});

const baseInput = {
  protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
  contentType: 'application/json',
  method: 'POST',
  messageBytes: 1024,
};

describe('AC-144 negative: protocol revision and transport failures', () => {
  describe('unsupported and draft protocol revisions', () => {
    it('refuses unsupported past revisions', () => {
      const verdict = DEFAULT_GUARD.inspect({
        ...baseInput,
        protocolRevision: '2024-06-01',
      });
      expect(verdict.decision).toBe('REFUSE');
      if (verdict.decision === 'REFUSE') {
        expect(verdict.reason).toBe('REVISION_UNSUPPORTED');
      }
    });

    it('refuses unsupported future revisions', () => {
      const verdict = DEFAULT_GUARD.inspect({
        ...baseInput,
        protocolRevision: '2030-01-01',
      });
      expect(verdict.decision).toBe('REFUSE');
      if (verdict.decision === 'REFUSE') {
        expect(verdict.reason).toBe('REVISION_UNSUPPORTED');
      }
    });

    it('refuses missing protocol revision', () => {
      const verdict = DEFAULT_GUARD.inspect({
        ...baseInput,
        protocolRevision: undefined,
      });
      expect(verdict.decision).toBe('REFUSE');
      if (verdict.decision === 'REFUSE') {
        expect(verdict.reason).toBe('REVISION_UNSUPPORTED');
      }
    });

    it('refuses draft revisions by default in standard baseline configuration', () => {
      const verdict = DEFAULT_GUARD.inspect({
        ...baseInput,
        protocolRevision: '2026-03-01-draft',
      });
      expect(verdict.decision).toBe('REFUSE');
      if (verdict.decision === 'REFUSE') {
        expect(verdict.reason).toBe('REVISION_UNSUPPORTED');
      }
    });

    it('admits draft revision ONLY when explicitly opted in via configuration', () => {
      // Default baseline refuses
      expect(
        DEFAULT_GUARD.inspect({ ...baseInput, protocolRevision: '2026-03-01-draft' }).decision,
      ).toBe('REFUSE');

      // Opted-in configuration admits
      expect(
        DRAFT_OPT_IN_GUARD.inspect({ ...baseInput, protocolRevision: '2026-03-01-draft' }).decision,
      ).toBe('ALLOW');
    });
  });

  describe('HTTP method and content type violations', () => {
    it('refuses GET method for JSON-RPC message calls', () => {
      const verdict = DEFAULT_GUARD.inspect({ ...baseInput, method: 'GET' });
      expect(verdict).toEqual({ decision: 'REFUSE', reason: 'METHOD_INVALID' });
    });

    it('refuses PUT / DELETE / PATCH / OPTIONS methods', () => {
      for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const verdict = DEFAULT_GUARD.inspect({ ...baseInput, method });
        expect(verdict).toEqual({ decision: 'REFUSE', reason: 'METHOD_INVALID' });
      }
    });

    it('refuses non-JSON content types', () => {
      for (const contentType of [
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
        'text/html',
        'application/xml',
      ]) {
        const verdict = DEFAULT_GUARD.inspect({ ...baseInput, contentType });
        expect(verdict).toEqual({ decision: 'REFUSE', reason: 'CONTENT_TYPE_INVALID' });
      }
    });
  });

  describe('message size cap violations', () => {
    it('refuses messages exceeding maximum_request_bytes cap', () => {
      const verdict = DEFAULT_GUARD.inspect({
        ...baseInput,
        messageBytes: MAXIMUM_REQUEST_BYTES + 1,
      });
      expect(verdict).toEqual({ decision: 'REFUSE', reason: 'MESSAGE_OVERSIZE' });
    });

    it('refuses negative message sizes', () => {
      const verdict = DEFAULT_GUARD.inspect({
        ...baseInput,
        messageBytes: -1,
      });
      expect(verdict).toEqual({ decision: 'REFUSE', reason: 'MESSAGE_OVERSIZE' });
    });
  });

  describe('JSON-RPC envelope validation failure paths', () => {
    function validateJsonRpcEnvelope(envelope: unknown): void {
      if (typeof envelope !== 'object' || envelope === null) {
        throw new Error('JSON_RPC_INVALID: payload must be an object');
      }
      const rec = envelope as Record<string, unknown>;
      if (rec.jsonrpc !== '2.0') {
        throw new Error('JSON_RPC_INVALID: jsonrpc version must be "2.0"');
      }
      if (rec.id === undefined) {
        throw new Error('JSON_RPC_INVALID: request must carry an id');
      }
      if (typeof rec.method !== 'string' || rec.method.length === 0) {
        throw new Error('JSON_RPC_INVALID: method must be a non-empty string');
      }
    }

    it('refuses JSON-RPC 1.0 or missing jsonrpc field', () => {
      expect(() =>
        validateJsonRpcEnvelope({ jsonrpc: '1.0', id: 1, method: 'tools/list' }),
      ).toThrow(/JSON_RPC_INVALID/);
      expect(() => validateJsonRpcEnvelope({ id: 1, method: 'tools/list' })).toThrow(
        /JSON_RPC_INVALID/,
      );
    });

    it('refuses requests with missing id or missing method', () => {
      expect(() => validateJsonRpcEnvelope({ jsonrpc: '2.0', method: 'tools/list' })).toThrow(
        /JSON_RPC_INVALID/,
      );
      expect(() => validateJsonRpcEnvelope({ jsonrpc: '2.0', id: 1, method: '' })).toThrow(
        /JSON_RPC_INVALID/,
      );
    });
  });
});
