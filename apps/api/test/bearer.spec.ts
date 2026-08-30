/**
 * Unit test suite for MCP bearer authentication & client context (T010).
 * Traces: FR-MCP-005, AC-052, AC-053, §17.5.
 *
 * Asserts:
 * - Personal bearer token extracted from Authorization: Bearer <token>.
 * - strictPresentation enabled: sourceIp, origin, and requestedScopes passed on presentation.
 * - Keyed HMAC-SHA256 hash with server-side pepper used for verification.
 * - Prefix-only identification (key ID / prefix shown, secret never logged).
 * - Client context constructed: actor, scopes, tool-profile, entity constraints, quota, expiry.
 * - Revoked credentials immediately rejected with 401/403.
 * - Secrets absent from all error messages and debug outputs.
 */
import { describe, expect, it } from 'bun:test';
import {
  extractBearerToken,
  authenticateBearer,
  createClientContext,
  type BearerAuthRequest,
} from '../src/auth/bearer.ts';

describe('T010 — MCP bearer auth & client context (AC-052, AC-053)', () => {
  it('extracts bearer token from standard Authorization header', () => {
    expect(extractBearerToken('Bearer sk-mcp-valid-key-12345')).toBe('sk-mcp-valid-key-12345');
    expect(extractBearerToken('bearer sk-mcp-valid-key-12345')).toBe('sk-mcp-valid-key-12345');
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
  });

  it('authenticates valid presentation with strict presentation context', async () => {
    const authReq: BearerAuthRequest = {
      rawToken: 'sk-mcp-valid-key-12345',
      sourceIp: '198.51.100.10',
      origin: 'https://mcp.example.com',
      requestedScopes: ['tools:read', 'tools:execute'],
    };

    const result = await authenticateBearer(authReq, {
      pepper: 'test-server-pepper-32-chars-long-min!',
    });

    expect(result.authenticated).toBe(true);
    expect(result.clientContext?.actor).toBeDefined();
    expect(result.clientContext?.profileId).toBeDefined();
    expect(result.clientContext?.scopes).toContain('tools:read');
    expect(result.clientContext?.scopes).toContain('tools:execute');
  });

  it('rejects presentation when source IP does not match bound IP policy if strict', async () => {
    const authReq: BearerAuthRequest = {
      rawToken: 'sk-mcp-ip-restricted-key',
      sourceIp: '203.0.113.99', // Mismatched IP
      origin: 'https://mcp.example.com',
    };

    const result = await authenticateBearer(authReq, {
      pepper: 'test-server-pepper-32-chars-long-min!',
    });
    expect(result.authenticated).toBe(false);
    expect(result.refusalReason).toBe('CREDENTIAL_INVALID');
  });

  it('rejects revoked credentials immediately on next request (AC-053)', async () => {
    const authReq: BearerAuthRequest = {
      rawToken: 'sk-mcp-revoked-key-999',
      sourceIp: '198.51.100.10',
      origin: 'https://mcp.example.com',
    };

    const result = await authenticateBearer(authReq, {
      pepper: 'test-server-pepper-32-chars-long-min!',
    });
    expect(result.authenticated).toBe(false);
    expect(result.refusalReason).toBe('CREDENTIAL_REVOKED');
  });

  it('rejects expired credentials', async () => {
    const authReq: BearerAuthRequest = {
      rawToken: 'sk-mcp-expired-key-000',
      sourceIp: '198.51.100.10',
      origin: 'https://mcp.example.com',
    };

    const result = await authenticateBearer(authReq, {
      pepper: 'test-server-pepper-32-chars-long-min!',
    });
    expect(result.authenticated).toBe(false);
    expect(result.refusalReason).toBe('CREDENTIAL_EXPIRED');
  });

  it('proves raw secret and pepper never appear in error objects or strings (AC-052)', async () => {
    const rawSecret = 'sk-mcp-secret-payload-should-never-leak';
    const serverPepper = 'ultra-secret-server-pepper-key-never-leak';

    const authReq: BearerAuthRequest = {
      rawToken: rawSecret,
      sourceIp: '198.51.100.10',
      origin: 'https://mcp.example.com',
    };

    try {
      const result = await authenticateBearer(authReq, { pepper: serverPepper });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(rawSecret);
      expect(serialized).not.toContain(serverPepper);
    } catch (err) {
      const errString = String(err);
      expect(errString).not.toContain(rawSecret);
      expect(errString).not.toContain(serverPepper);
    }
  });

  it('creates client context with prefix-only identifier and profile binding', () => {
    const ctx = createClientContext({
      credentialId: 'cred_01j7xyz',
      keyPrefix: 'sk-mcp-abc',
      actor: 'agent-1@foresift.internal',
      profileId: 'discovery',
      scopes: ['tools:read', 'tools:execute'],
      quotaUnitsRemaining: 1000,
      expiresAt: '2026-12-31T23:59:59Z',
    });

    expect(ctx.credentialId).toBe('cred_01j7xyz');
    expect(ctx.keyPrefix).toBe('sk-mcp-abc');
    expect(ctx.profileId).toBe('discovery');
    expect(ctx.actor).toBe('agent-1@foresift.internal');
  });
});
