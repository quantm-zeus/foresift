// AC-251 (negative): unsupported MCP protocol version, invalid content type/
// method, oversized message, foreign session ID, or unauthorized resumable
// cursor fails DETERMINISTICALLY without tool execution.
import { describe, expect, it } from 'bun:test';
import { McpProtocolGuard } from '../../packages/security/src/mcp-protocol-guard.ts';

const GUARD = new McpProtocolGuard({ maxMessageBytes: 1024 * 1024 });

const okInput = {
  protocolRevision: '2025-11-25',
  contentType: 'application/json; charset=utf-8',
  method: 'POST',
  messageBytes: 4096,
};

const session = {
  actor: 'admin@example.com',
  profileId: 'profile-1',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
};

describe('AC-251 negative: every malformed transport dimension refuses', () => {
  it('refuses UNSUPPORTED future revisions', () => {
    expect(GUARD.inspect({ ...okInput, protocolRevision: '2099-01-01' })).toMatchObject({
      decision: 'REFUSE',
    });
  });

  it('refuses MISSING revisions', () => {
    expect(GUARD.inspect({ ...okInput, protocolRevision: undefined }).decision).toBe('REFUSE');
  });

  it('refuses non-JSON content types', () => {
    expect(GUARD.inspect({ ...okInput, contentType: 'text/plain' }).decision).toBe('REFUSE');
  });

  it('refuses GET as a message carrier', () => {
    expect(GUARD.inspect({ ...okInput, method: 'GET' }).decision).toBe('REFUSE');
  });

  it('refuses oversized messages before any parse or dispatch', () => {
    expect(GUARD.inspect({ ...okInput, messageBytes: 2 * 1024 * 1024 })).toMatchObject({
      decision: 'REFUSE',
      reason: 'MESSAGE_OVERSIZE',
    });
  });

  it('refuses FOREIGN session claims on ANY bound dimension', () => {
    for (const claims of [
      { actor: 'someone-else@example.com' },
      { profileId: 'profile-2' },
      { origin: 'https://evil.example.com' },
      { protocolRevision: '2024-06-01' },
    ]) {
      expect(
        GUARD.inspect({ ...okInput, session, requestClaims: claims }),
        JSON.stringify(claims),
      ).toMatchObject({ decision: 'REFUSE', reason: 'SESSION_BINDING_INVALID' });
    }
  });

  it('refuses UNAUTHORIZED resumable cursors deterministically', () => {
    expect(
      GUARD.inspect({ ...okInput, resumableCursor: { cursor: 'c-1', authorized: false } }),
    ).toMatchObject({ decision: 'REFUSE', reason: 'CURSOR_UNAUTHORIZED' });
    expect(
      GUARD.inspect({ ...okInput, resumableCursor: { cursor: 'c-1', authorized: true } }),
    ).toEqual({ decision: 'ALLOW' });
  });
});
