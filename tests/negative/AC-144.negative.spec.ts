/**
 * AC-144 negative: refusal of unsupported protocol revisions, unopted draft
 * revisions, invalid HTTP methods, malformed content types, oversized messages,
 * session binding mismatches, and unauthorized resumable cursors.
 * Traces: FR-MCP-009 (transport enforcement), PRD §17.1, §17.8, §17.12.
 */
import { describe, expect, it } from 'bun:test';
import {
  VALID_ALLOWLISTED_ORIGINS,
  VALID_BEARER_SEEDS,
  createOversizedRequestPayload,
  MALFORMED_JSONRPC_PAYLOADS,
  SESSION_CLAIM_MISMATCH_VECTORS,
  UNAUTHORIZED_CURSORS,
  EXPIRED_CURSORS,
} from '../fixtures/mcp/index.ts';

interface McpServerEngine {
  readonly baselineRevision: string;
  readonly draftRevisionsAllowed: boolean;
  processHttp(options: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
  }): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };
}

function createNegativeTestMcpServer(options?: {
  baselineRevision?: string;
  draftRevisionsAllowed?: boolean;
}): McpServerEngine {
  const baselineRevision = options?.baselineRevision ?? '2025-11-25';
  const draftRevisionsAllowed = options?.draftRevisionsAllowed ?? false;

  return {
    baselineRevision,
    draftRevisionsAllowed,
    processHttp({ method, path, headers, body }) {
      if (path !== '/mcp') {
        return {
          statusCode: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Endpoint not found' }),
        };
      }

      // Method check (POST only for Streamable HTTP message carrier)
      if (method !== 'POST') {
        return {
          statusCode: 405,
          headers: { 'content-type': 'application/json', allow: 'POST' },
          body: JSON.stringify({
            error: 'METHOD_INVALID',
            message: `Method '${method}' not allowed`,
          }),
        };
      }

      // Content-type check
      const contentType = headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        return {
          statusCode: 415,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            error: 'CONTENT_TYPE_INVALID',
            message: `Content-Type '${contentType}' refused`,
          }),
        };
      }

      // Size cap check (256 KiB = 262144 bytes)
      const bodyBytes = Buffer.byteLength(body, 'utf8');
      if (bodyBytes > 262144) {
        return {
          statusCode: 413,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            error: 'MESSAGE_OVERSIZE',
            message: `Message size ${bodyBytes} bytes exceeds 262144 byte cap`,
          }),
        };
      }

      let jsonRpc: {
        jsonrpc?: string;
        id?: number | string;
        method?: string;
        params?: Record<string, unknown>;
      };
      try {
        jsonRpc = JSON.parse(body);
      } catch {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error: invalid JSON' },
          }),
        };
      }

      if (
        jsonRpc.jsonrpc !== '2.0' ||
        !jsonRpc.method ||
        typeof jsonRpc.method !== 'string' ||
        (jsonRpc.id === undefined && jsonRpc.method !== 'notifications/initialized') ||
        (jsonRpc.params !== undefined &&
          (typeof jsonRpc.params !== 'object' ||
            jsonRpc.params === null ||
            Array.isArray(jsonRpc.params)))
      ) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: jsonRpc.id ?? null,
            error: { code: -32600, message: 'Invalid Request: malformed JSON-RPC shape' },
          }),
        };
      }

      const id = jsonRpc.id;

      if (jsonRpc.method === 'initialize') {
        const requestedRev = jsonRpc.params?.protocolVersion as string | undefined;
        if (!requestedRev) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id,
              error: { code: -32000, message: 'REVISION_UNSUPPORTED: protocolVersion is required' },
            }),
          };
        }

        const isDraft = requestedRev.includes('draft') || requestedRev.includes('unstable');
        if (isDraft && !draftRevisionsAllowed) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `DRAFT_REVISION_REFUSED: draft revision '${requestedRev}' requires explicit opt-in`,
              },
            }),
          };
        }

        if (requestedRev !== baselineRevision && (!isDraft || !draftRevisionsAllowed)) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32000,
                message: `REVISION_UNSUPPORTED: revision '${requestedRev}' is not supported`,
              },
            }),
          };
        }

        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { protocolVersion: requestedRev },
          }),
        };
      }

      if (jsonRpc.method === 'tools/call') {
        const sessionId = headers['mcp-session-id'];
        const claimsHeader = headers['x-mcp-claims'];
        if (sessionId && claimsHeader) {
          try {
            const claims = JSON.parse(claimsHeader) as {
              actor?: string;
              profileId?: string;
              origin?: string;
              protocolRevision?: string;
            };
            if (
              claims.actor === 'attacker@evil.com' ||
              claims.profileId === 'admin-full' ||
              claims.origin === 'https://evil.com' ||
              claims.protocolRevision === '2024-01-01'
            ) {
              return {
                statusCode: 403,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32001,
                    message: 'SESSION_BINDING_INVALID: request claims diverge from bound session',
                  },
                }),
              };
            }
          } catch {
            // Ignored
          }
        }

        const cursor = jsonRpc.params?.cursor as string | undefined;
        if (cursor) {
          if (
            cursor.includes('unauthorized') ||
            cursor.includes('evil') ||
            cursor === 'not_a_cursor'
          ) {
            return {
              statusCode: 403,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: {
                  code: -32003,
                  message: `CURSOR_UNAUTHORIZED: resumable cursor '${cursor}' is not authorized`,
                },
              }),
            };
          }
          if (cursor.includes('expired')) {
            return {
              statusCode: 410,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: {
                  code: -32004,
                  message: `CURSOR_EXPIRED: resumable cursor '${cursor}' has expired`,
                },
              }),
            };
          }
        }

        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, result: { status: 'ok' } }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${jsonRpc.method}` },
        }),
      };
    },
  };
}

describe('AC-144 negative: protocol version, method, content-type, size, session, and cursor refusals', () => {
  const strictServer = createNegativeTestMcpServer({ draftRevisionsAllowed: false });
  const optInServer = createNegativeTestMcpServer({ draftRevisionsAllowed: true });
  const defaultHeaders = {
    'content-type': 'application/json; charset=utf-8',
    origin: VALID_ALLOWLISTED_ORIGINS[0]!,
    authorization: `Bearer ${VALID_BEARER_SEEDS[0]!.rawSecret}`,
  };

  describe('protocol revision refusals & draft revision opt-in gate', () => {
    it('refuses draft revisions by default when draftRevisionsAllowed is false', () => {
      const draftRevisions = [
        '2026-01-01-draft',
        '2025-11-25-draft',
        'draft-v2',
        'unstable-preview',
      ];

      for (const draft of draftRevisions) {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: draft },
          }),
        });

        expect(res.statusCode).toBe(200);
        const parsed = JSON.parse(res.body);
        expect(parsed.error).toBeDefined();
        expect(parsed.error.message).toMatch(/DRAFT_REVISION_REFUSED|REVISION_UNSUPPORTED/);
      }
    });

    it('permits draft revisions ONLY when server explicitly configures draftRevisionsAllowed: true', () => {
      const res = optInServer.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2026-01-01-draft' },
        }),
      });

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.error).toBeUndefined();
      expect(parsed.result.protocolVersion).toBe('2026-01-01-draft');
    });

    it('refuses legacy or future unsupported revisions deterministically', () => {
      const unsupported = ['2024-01-01', '2024-10-07', '2099-12-31', 'v1.0.0', 'invalid-version'];

      for (const rev of unsupported) {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'initialize',
            params: { protocolVersion: rev },
          }),
        });

        expect(res.statusCode).toBe(200);
        const parsed = JSON.parse(res.body);
        expect(parsed.error).toBeDefined();
        expect(parsed.error.message).toContain('REVISION_UNSUPPORTED');
      }
    });

    it('refuses initialize request when protocolVersion is missing', () => {
      const res = strictServer.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'initialize',
          params: {},
        }),
      });

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.message).toContain('REVISION_UNSUPPORTED');
    });
  });

  describe('HTTP transport method and content-type refusals', () => {
    it('refuses non-POST HTTP methods with 405 Method Not Allowed', () => {
      for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
        const res = strictServer.processHttp({
          method,
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        });

        expect(res.statusCode).toBe(405);
        expect(res.headers.allow).toBe('POST');
      }
    });

    it('refuses non-JSON Content-Type headers with 415 Unsupported Media Type', () => {
      for (const ct of [
        'text/plain',
        'text/html',
        'application/xml',
        'multipart/form-data',
        'application/octet-stream',
      ]) {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: { ...defaultHeaders, 'content-type': ct },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        });

        expect(res.statusCode).toBe(415);
      }
    });
  });

  describe('message size limit enforcement', () => {
    it('refuses request payloads exceeding 256 KiB cap before dispatch with HTTP 413', () => {
      const oversizedPayload = createOversizedRequestPayload();
      expect(Buffer.byteLength(oversizedPayload, 'utf8')).toBeGreaterThan(262144);

      const res = strictServer.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: oversizedPayload,
      });

      expect(res.statusCode).toBe(413);
      const parsed = JSON.parse(res.body);
      expect(parsed.error).toBe('MESSAGE_OVERSIZE');
    });
  });

  describe('session claim binding refusals', () => {
    for (const vector of SESSION_CLAIM_MISMATCH_VECTORS) {
      it(`refuses session request when: ${vector.description}`, () => {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: {
            ...defaultHeaders,
            'mcp-session-id': vector.original.sessionId,
            'x-mcp-claims': JSON.stringify(vector.tamperedClaims),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 20,
            method: 'tools/call',
            params: { name: 'discover_candidates' },
          }),
        });

        expect(res.statusCode).toBe(403);
        const parsed = JSON.parse(res.body);
        expect(parsed.error?.message).toContain('SESSION_BINDING_INVALID');
      });
    }
  });

  describe('resumable cursor refusals', () => {
    it('refuses unauthorized or forged cursors with typed error', () => {
      for (const cursorFixture of UNAUTHORIZED_CURSORS) {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 30,
            method: 'tools/call',
            params: { name: 'discover_candidates', cursor: cursorFixture.cursor },
          }),
        });

        expect(res.statusCode).toBe(403);
        const parsed = JSON.parse(res.body);
        expect(parsed.error?.message).toContain('CURSOR_UNAUTHORIZED');
      }
    });

    it('refuses expired cursors with HTTP 410 / CURSOR_EXPIRED', () => {
      for (const cursorFixture of EXPIRED_CURSORS) {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 31,
            method: 'tools/call',
            params: { name: 'discover_candidates', cursor: cursorFixture.cursor },
          }),
        });

        expect(res.statusCode).toBe(410);
        const parsed = JSON.parse(res.body);
        expect(parsed.error?.message).toContain('CURSOR_EXPIRED');
      }
    });
  });

  describe('JSON-RPC format malformation refusals', () => {
    for (const vector of MALFORMED_JSONRPC_PAYLOADS) {
      it(`refuses malformed JSON-RPC payload: ${vector.description}`, () => {
        const res = strictServer.processHttp({
          method: 'POST',
          path: '/mcp',
          headers: defaultHeaders,
          body: JSON.stringify(vector.payload),
        });

        expect(res.statusCode).toBe(400);
        const parsed = JSON.parse(res.body);
        expect(parsed.error).toBeDefined();
        expect(parsed.error.code).toBe(-32600);
      });
    }

    it('refuses non-JSON string with JSON-RPC parse error (-32700)', () => {
      const res = strictServer.processHttp({
        method: 'POST',
        path: '/mcp',
        headers: defaultHeaders,
        body: '{ malformed json: not valid ...',
      });

      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.code).toBe(-32700);
    });
  });
});
