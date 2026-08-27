// AC-253 (acceptance): OAuth token-binding validators admit fully-bound
// grants — PKCE present, exact registered redirect URI, audience/resource
// binding, live expiry, narrowed scopes. OAuth server wiring itself lands
// with the mcp-surface package.
import { describe, expect, it } from 'bun:test';
import { OAuthBindingGuard } from '../../packages/security/src/oauth-binding.ts';

const NOW_MS = Date.parse('2026-08-01T00:00:00Z');
const at = (s: string) => s as import('@foresift/domain').UtcTimestamp;

const GUARD = new OAuthBindingGuard(() => NOW_MS);

function goodBinding() {
  return {
    subject: 'user-1',
    clientId: 'mcp-client',
    redirectUri: 'https://mcp.example.com/callback',
    audience: 'foresift-mcp',
    resourceIndicator: 'https://foresift.example.com/mcp',
    scopes: ['tools:read'],
    expiresAt: at('2026-08-01T01:00:00Z'),
    pkceRequired: true as const,
  };
}

const VALIDATION = () => ({
  candidate: goodBinding(),
  registeredRedirectUris: ['https://mcp.example.com/callback'],
  registeredScopes: ['tools:read', 'tools:write'],
  expectedAudience: 'foresift-mcp',
  expectedResourceIndicator: 'https://foresift.example.com/mcp',
});

describe('AC-253: fully-bound OAuth grants admit', () => {
  it('admits a grant satisfying every binding dimension', () => {
    const parsed = GUARD.validateTokenBinding(VALIDATION());
    expect(parsed.subject).toBe('user-1');
    expect(parsed.clientId).toBe('mcp-client');
  });

  it('admits scope NARROWING inside the registered set', () => {
    const input = { ...VALIDATION(), candidate: { ...goodBinding(), scopes: ['tools:write'] } };
    expect(GUARD.validateTokenBinding(input).subject).toBe('user-1');
  });

  it('admits grants whose expiry is still in the future against the clock', () => {
    const input = {
      ...VALIDATION(),
      candidate: { ...goodBinding(), expiresAt: at('2026-08-01T00:00:01Z') },
    };
    expect(GUARD.validateTokenBinding(input).subject).toBe('user-1');
  });

  it('admits the exact registered redirect among SEVERAL registered URIs', () => {
    const input = {
      ...VALIDATION(),
      registeredRedirectUris: ['https://mcp.example.com/alt', 'https://mcp.example.com/callback'],
    };
    expect(GUARD.validateTokenBinding(input).subject).toBe('user-1');
  });
});
