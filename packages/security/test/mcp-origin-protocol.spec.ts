// MCP origin decision engine (T113, AC-250) and protocol guard (T115,
// AC-251): exact-match allowlisting with hygiene checks that fire BEFORE
// authentication processing, absent-origin deployment policy,
// revision/content-type/method/size/session/cursor refusals.
import { describe, expect, it } from 'bun:test';
import { McpOriginGate } from '../src/mcp-origin.ts';
import { McpProtocolGuard } from '../src/mcp-protocol-guard.ts';

const PROD_GATE = new McpOriginGate({
  allowlist: ['https://mcp.example.com'],
  absentOriginPolicy: 'PRODUCTION',
});

describe('mcp origin decisions (AC-250)', () => {
  it('admits an exact allowlist hit (default port implied)', () => {
    expect(PROD_GATE.decide('https://mcp.example.com')).toEqual({
      decision: 'ALLOW',
      origin: 'https://mcp.example.com',
    });
    expect(PROD_GATE.decide('https://mcp.example.com:443').decision).toBe('ALLOW');
  });

  it('refuses punycode-confused hosts BEFORE allowlist consultation', () => {
    const verdict = PROD_GATE.decide('https://xn--mc-xja.example.com');
    expect(verdict).toMatchObject({ decision: 'REFUSE', reason: 'PUNYCODE_CONFUSED' });
  });

  it('refuses trailing-dot hostnames', () => {
    expect(PROD_GATE.decide('https://mcp.example.com.')).toMatchObject({
      decision: 'REFUSE',
      reason: 'TRAILING_DOT',
    });
  });

  it('refuses mixed-scheme lookalikes (http vs https on the same host)', () => {
    expect(PROD_GATE.decide('http://mcp.example.com')).toMatchObject({
      decision: 'REFUSE',
      reason: 'MIXED_SCHEME',
    });
  });

  it('refuses wrong port and wrong host with typed verdicts', () => {
    expect(PROD_GATE.decide('https://mcp.example.com:8443')).toMatchObject({
      decision: 'REFUSE',
      reason: 'WRONG_PORT',
    });
    expect(PROD_GATE.decide('https://evil.example.com')).toMatchObject({
      decision: 'REFUSE',
      reason: 'WRONG_HOST',
    });
    expect(PROD_GATE.decide('https://unrelated.org')).toMatchObject({
      decision: 'REFUSE',
      reason: 'NOT_ALLOWLISTED',
    });
  });

  it('refuses malformed and userinfo-bearing origins', () => {
    expect(PROD_GATE.decide('not an origin')).toMatchObject({
      decision: 'REFUSE',
      reason: 'MALFORMED',
    });
    expect(PROD_GATE.decide('https://user@mcp.example.com')).toMatchObject({
      decision: 'REFUSE',
      reason: 'MALFORMED',
    });
  });

  it('applies the ABSENT-origin policy per deployment mode', () => {
    expect(PROD_GATE.decide(undefined)).toMatchObject({
      decision: 'REFUSE',
      reason: 'ABSENT_POLICY_REFUSES',
    });
    const dev = new McpOriginGate({
      allowlist: ['https://mcp.example.com'],
      absentOriginPolicy: 'NON_PRODUCTION',
    });
    expect(dev.decide(undefined).decision).toBe('ALLOW');
    // Production policy is fail-closed by default even for a fresh gate.
  });

  it('requireAllowed raises typed errors for transport wiring (403 path)', () => {
    expect(() => PROD_GATE.requireAllowed('https://evil.example.com')).toThrow(
      /WRONG_HOST|refused/,
    );
    expect(() => PROD_GATE.requireAllowed('https://mcp.example.com')).not.toThrow();
  });
});

const GUARD = new McpProtocolGuard({ maxMessageBytes: 1024 * 1024 });

describe('mcp protocol guard (AC-251)', () => {
  const okInput = {
    protocolRevision: '2025-11-25',
    contentType: 'application/json; charset=utf-8',
    method: 'POST',
    messageBytes: 4096,
  };

  it('allows a well-formed baseline-revision request', () => {
    expect(GUARD.inspect(okInput)).toEqual({ decision: 'ALLOW' });
  });

  it('refuses unsupported revisions — later revisions are opt-in only', () => {
    expect(GUARD.inspect({ ...okInput, protocolRevision: '2099-01-01' })).toMatchObject({
      decision: 'REFUSE',
      reason: 'REVISION_UNSUPPORTED',
    });
    expect(GUARD.inspect({ ...okInput, protocolRevision: undefined })).toMatchObject({
      decision: 'REFUSE',
      reason: 'REVISION_UNSUPPORTED',
    });
  });

  it('validates content type and HTTP method', () => {
    expect(GUARD.inspect({ ...okInput, contentType: 'text/plain' })).toMatchObject({
      decision: 'REFUSE',
      reason: 'CONTENT_TYPE_INVALID',
    });
    expect(GUARD.inspect({ ...okInput, method: 'GET' })).toMatchObject({
      decision: 'REFUSE',
      reason: 'METHOD_INVALID',
    });
  });

  it('enforces message-size caps deterministically', () => {
    expect(GUARD.inspect({ ...okInput, messageBytes: 2 * 1024 * 1024 })).toMatchObject({
      decision: 'REFUSE',
      reason: 'MESSAGE_OVERSIZE',
    });
  });

  it('REFUSES ABSENT dimensions instead of skipping them (M17)', () => {
    // Omission may never skip a guard dimension: absent method/byte-count/
    // session evidence is unverifiable, and unverifiable refuses.
    expect(GUARD.inspect({ ...okInput, method: undefined })).toMatchObject({
      decision: 'REFUSE',
      reason: 'METHOD_INVALID',
    });
    expect(GUARD.inspect({ ...okInput, messageBytes: undefined })).toMatchObject({
      decision: 'REFUSE',
      reason: 'MESSAGE_OVERSIZE',
    });
    expect(GUARD.inspect({ ...okInput, messageBytes: -1 })).toMatchObject({
      decision: 'REFUSE',
      reason: 'MESSAGE_OVERSIZE',
    });
    // Claims without a session cannot be bound — refused, not skipped.
    expect(GUARD.inspect({ ...okInput, requestClaims: {} })).toMatchObject({
      decision: 'REFUSE',
      reason: 'SESSION_BINDING_INVALID',
    });
  });

  it('binds sessions across actor/profile/origin/revision claims', () => {
    const session = {
      actor: 'admin@example.com',
      profileId: 'profile-1',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
    };
    expect(GUARD.inspect({ ...okInput, session, requestClaims: {} })).toEqual({
      decision: 'ALLOW',
    });
    for (const claims of [
      { actor: 'someone-else@example.com' },
      { profileId: 'profile-2' },
      { origin: 'https://evil.example.com' },
      { protocolRevision: '2024-06-01' },
    ]) {
      expect(GUARD.inspect({ ...okInput, session, requestClaims: claims })).toMatchObject({
        decision: 'REFUSE',
        reason: 'SESSION_BINDING_INVALID',
      });
    }
  });

  it('refuses unauthorized resumable-cursor replay', () => {
    expect(
      GUARD.inspect({ ...okInput, resumableCursor: { cursor: 'c-1', authorized: false } }),
    ).toMatchObject({ decision: 'REFUSE', reason: 'CURSOR_UNAUTHORIZED' });
    expect(
      GUARD.inspect({ ...okInput, resumableCursor: { cursor: 'c-1', authorized: true } }),
    ).toEqual({ decision: 'ALLOW' });
  });
});
