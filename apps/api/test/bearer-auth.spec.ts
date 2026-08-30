/**
 * T010: Bearer Authentication & Client Context suite (FR-MCP-005, §17.5, AC-052, AC-053).
 * Tests apps/api/src/auth/bearer.ts and apps/api/src/auth/client-context.ts for strict presentation,
 * HMAC-SHA256 keyed hash, pepper isolation, prefix-only identification, and client context resolution.
 */
import { describe, expect, it } from 'bun:test';
import {
  EXPIRED_CREDENTIAL,
  REVOKED_CREDENTIAL,
  STANDARD_DISCOVERY_CREDENTIAL,
  TEST_MCP_PEPPER,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadBearerAuthModule() {
  return await import('../src/auth/bearer.ts');
}

async function loadClientContextModule() {
  return await import('../src/auth/client-context.ts');
}

describe('T010: MCP Bearer authentication & client context (AC-052, AC-053)', () => {
  const validPresentation = {
    presentedSecret: STANDARD_DISCOVERY_CREDENTIAL.rawSecret,
    sourceIp: '127.0.0.1',
    origin: 'https://mcp.example.com',
    requestedScopes: ['tools:read', 'tools:execute'],
  };

  it('authenticates valid bearer token and resolves full ClientContext', async () => {
    const { authenticateBearerToken } = await loadBearerAuthModule();
    const { buildClientContext } = await loadClientContextModule();

    const authResult = await authenticateBearerToken(validPresentation, {
      pepper: TEST_MCP_PEPPER,
    });

    expect(authResult.authenticated).toBe(true);
    expect(authResult.credentialId).toBe(STANDARD_DISCOVERY_CREDENTIAL.credentialId);

    const context = buildClientContext(authResult);
    expect(context.credentialId).toBe(STANDARD_DISCOVERY_CREDENTIAL.credentialId);
    expect(context.scopes).toContain('tools:read');
    expect(context.toolBounds).toContain('discover_candidates');
    expect(context.rateLimitClass).toBe('STANDARD_FREE');
  });

  it('enforces strict presentation: refuses when sourceIp, origin, or requestedScopes is withheld', async () => {
    const { authenticateBearerToken } = await loadBearerAuthModule();

    // Withheld sourceIp
    const noIp = await authenticateBearerToken(
      { ...validPresentation, sourceIp: undefined as unknown as string },
      { pepper: TEST_MCP_PEPPER },
    );
    expect(noIp.authenticated).toBe(false);
    expect(noIp.refusalReason).toBe('ORIGIN_MISMATCH');

    // Withheld origin
    const noOrigin = await authenticateBearerToken(
      { ...validPresentation, origin: undefined as unknown as string },
      { pepper: TEST_MCP_PEPPER },
    );
    expect(noOrigin.authenticated).toBe(false);

    // Withheld requestedScopes
    const noScopes = await authenticateBearerToken(
      { ...validPresentation, requestedScopes: undefined as unknown as string[] },
      { pepper: TEST_MCP_PEPPER },
    );
    expect(noScopes.authenticated).toBe(false);
  });

  it('refuses expired or revoked bearer credentials', async () => {
    const { authenticateBearerToken } = await loadBearerAuthModule();

    // Expired
    const expiredResult = await authenticateBearerToken(
      { ...validPresentation, presentedSecret: EXPIRED_CREDENTIAL.rawSecret },
      { pepper: TEST_MCP_PEPPER },
    );
    expect(expiredResult.authenticated).toBe(false);
    expect(expiredResult.refusalReason).toBe('CREDENTIAL_EXPIRED');

    // Revoked
    const revokedResult = await authenticateBearerToken(
      { ...validPresentation, presentedSecret: REVOKED_CREDENTIAL.rawSecret },
      { pepper: TEST_MCP_PEPPER },
    );
    expect(revokedResult.authenticated).toBe(false);
    expect(revokedResult.refusalReason).toBe('CREDENTIAL_REVOKED');
  });

  it('refuses when requested scopes exceed granted credential scopes', async () => {
    const { authenticateBearerToken } = await loadBearerAuthModule();

    const scopeExceededResult = await authenticateBearerToken(
      {
        ...validPresentation,
        requestedScopes: ['tools:read', 'admin:write_privileges', 'wallet:transfer'],
      },
      { pepper: TEST_MCP_PEPPER },
    );
    expect(scopeExceededResult.authenticated).toBe(false);
    expect(scopeExceededResult.refusalReason).toBe('SCOPE_EXCEEDED');
  });

  it('preserves prefix-only identification and never leaks raw secret into logs or context', async () => {
    const { authenticateBearerToken } = await loadBearerAuthModule();
    const { buildClientContext } = await loadClientContextModule();

    const authResult = await authenticateBearerToken(validPresentation, {
      pepper: TEST_MCP_PEPPER,
    });
    const context = buildClientContext(authResult);

    // Context carries credentialId / prefix, never the secret
    expect((context as Record<string, unknown>).secret).toBeUndefined();
    expect((context as Record<string, unknown>).rawSecret).toBeUndefined();
    expect((context as Record<string, unknown>).pepper).toBeUndefined();
    expect(JSON.stringify(context)).not.toContain(STANDARD_DISCOVERY_CREDENTIAL.rawSecret);
  });
});
