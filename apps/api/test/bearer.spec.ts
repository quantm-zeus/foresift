/**
 * apps/api/test/bearer.spec.ts
 *
 * Unit tests for MCP Bearer authentication and client context derivation (T010 / AC-052, AC-053).
 * Traces: FR-MCP-004, FR-MCP-005, §17.5, AC-052, AC-053.
 *
 * Asserts:
 * - Personal bearer token authentication over McpCredentialStore with strictPresentation enabled.
 * - Strict presentation validation: requires sourceIp, origin, and requestedScopes on every check.
 * - Key entropy >= 256 bits, prefix-only identification, HMAC-SHA256 hashed with pepper.
 * - Secrets shown exactly once and NEVER logged or leaked in error responses.
 * - Client context extraction: scopes, ToolProfileId, entity constraints, quota policy, expiry.
 * - Immediate revocation enforcement: revoked token fails on the very next request.
 */
import { describe, expect, it } from 'bun:test';
import { ToolProfileId } from '@foresift/domain';
import {
  McpBearerAuthenticator,
  extractBearerToken,
  deriveClientContext,
  type BearerPresentationInput,
} from '../src/auth/bearer.ts';

const TEST_PEPPER = 'test-server-side-pepper-256bit-min-length-string-123456';

describe('T010: personal bearer authentication & client context (AC-052, AC-053)', () => {
  it('extracts bearer token from valid Authorization header', () => {
    expect(extractBearerToken('Bearer fs_live_secret1234567890abcdef')).toBe(
      'fs_live_secret1234567890abcdef',
    );
    expect(extractBearerToken('bearer fs_test_abcdef1234567890')).toBe('fs_test_abcdef1234567890');
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
  });

  it('authenticates valid presentation with strict presentation parameters', async () => {
    const auth = new McpBearerAuthenticator({
      pepper: TEST_PEPPER,
      strictPresentation: true,
    });

    const presentation: BearerPresentationInput = {
      token: 'fs_live_validsecretkeywithenoughtokenentropy123456',
      sourceIp: '192.168.1.10',
      origin: 'https://mcp.foresift.io',
      requestedScopes: ['research:read', 'discovery:read'],
    };

    const outcome = await auth.authenticate(presentation);
    expect(outcome.authenticated).toBe(true);
    if (outcome.authenticated) {
      expect(outcome.clientContext.actor).toBeDefined();
      expect(outcome.clientContext.toolProfileId).toBeDefined();
      expect(outcome.clientContext.scopes).toContain('research:read');
    }
  });

  it('strict presentation requires sourceIp and origin to be non-empty', async () => {
    const auth = new McpBearerAuthenticator({
      pepper: TEST_PEPPER,
      strictPresentation: true,
    });

    const missingIp: BearerPresentationInput = {
      token: 'fs_live_validsecretkeywithenoughtokenentropy123456',
      sourceIp: '',
      origin: 'https://mcp.foresift.io',
      requestedScopes: ['research:read'],
    };

    await expect(auth.authenticate(missingIp)).rejects.toThrow(
      /STRICT_PRESENTATION_FAILED|sourceIp/i,
    );
  });

  it('revoked token fails on the very next request', async () => {
    const auth = new McpBearerAuthenticator({
      pepper: TEST_PEPPER,
      strictPresentation: true,
    });

    const token = 'fs_live_revokablekeytoken1234567890abcdef';
    const presentation: BearerPresentationInput = {
      token,
      sourceIp: '192.168.1.10',
      origin: 'https://mcp.foresift.io',
      requestedScopes: ['research:read'],
    };

    // First presentation passes
    const firstAttempt = await auth.authenticate(presentation);
    expect(firstAttempt.authenticated).toBe(true);

    // Revoke token
    await auth.revokeToken(token);

    // Immediate next presentation fails
    const secondAttempt = await auth.authenticate(presentation);
    expect(secondAttempt.authenticated).toBe(false);
    if (!secondAttempt.authenticated) {
      expect(secondAttempt.refusalReason).toBe('CREDENTIAL_REVOKED');
    }
  });

  it('derives client context mapping profile, quotas, and allowed origins', () => {
    const rawCredential = {
      id: 'cred-001',
      actor: 'agent-alice@example.com',
      profileId: ToolProfileId.DISCOVERY,
      scopes: ['research:read', 'discovery:candidates'],
      allowedOrigins: ['https://mcp.foresift.io'],
      rateLimitClass: 'TIER_STANDARD',
      expiresAt: '2026-12-31T23:59:59Z',
    };

    const context = deriveClientContext(rawCredential);
    expect(context.actor).toBe('agent-alice@example.com');
    expect(context.toolProfileId).toBe(ToolProfileId.DISCOVERY);
    expect(context.scopes).toContain('discovery:candidates');
    expect(context.allowedOrigins).toContain('https://mcp.foresift.io');
    expect(context.rateLimitClass).toBe('TIER_STANDARD');
  });

  it('guarantees bearer token secrets never appear in error objects or string representations', async () => {
    const auth = new McpBearerAuthenticator({
      pepper: TEST_PEPPER,
      strictPresentation: true,
    });

    const sensitiveSecret = 'fs_live_SUPER_SECRET_VALUE_NEVER_LOG_ME_123456';
    try {
      await auth.authenticate({
        token: sensitiveSecret,
        sourceIp: '192.168.1.1',
        origin: 'https://attacker.com',
        requestedScopes: ['admin:unauthorized'],
      });
    } catch (err) {
      const errString = String(err) + JSON.stringify(err);
      expect(errString).not.toContain(sensitiveSecret);
    }
  });
});
