// AC-251 (acceptance): well-formed MCP transport requests — supported
// revision, admissible content type and method, in-cap message, bound
// session, authorized resumable cursor — are ADMITTED deterministically.
// Transport wiring itself belongs to the mcp-surface package.
import { describe, expect, it } from 'vitest';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';

const GUARD = new McpProtocolGuard({ maxMessageBytes: 1024 * 1024 });

const okInput = {
  protocolRevision: '2025-11-25',
  contentType: 'application/json; charset=utf-8',
  method: 'POST',
  messageBytes: 4096,
};

describe('AC-251: valid transport requests admit cleanly', () => {
  it('admits a well-formed baseline-revision request', () => {
    expect(GUARD.inspect(okInput)).toEqual({ decision: 'ALLOW' });
  });

  it('admits messages comfortably inside the size cap', () => {
    expect(GUARD.inspect({ ...okInput, messageBytes: 64 }).decision).toBe('ALLOW');
    expect(GUARD.inspect({ ...okInput, messageBytes: 1024 * 1024 - 1 }).decision).toBe('ALLOW');
  });

  it('admits HEAD-less POST variants of the admissible content type', () => {
    expect(GUARD.inspect({ ...okInput, contentType: 'application/json' }).decision).toBe('ALLOW');
  });

  it('admits a fully BOUND session with matching claims', () => {
    const session = {
      actor: 'admin@example.com',
      profileId: 'profile-1',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
    };
    expect(GUARD.inspect({ ...okInput, session, requestClaims: {} })).toEqual({
      decision: 'ALLOW',
    });
  });

  it('admits AUTHORIZED resumable cursors', () => {
    expect(
      GUARD.inspect({ ...okInput, resumableCursor: { cursor: 'c-1', authorized: true } }),
    ).toEqual({ decision: 'ALLOW' });
  });
});
