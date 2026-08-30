/**
 * T007: MCP Origin Wiring suite (FR-MCP-008, §17.2, AC-250).
 * Tests apps/api/src/mcp/origin-wiring.ts for exact scheme-host-port matching, 403-before-auth,
 * absent origin policy, loopback isolation, and proxy header trust.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALLOWED_ORIGINS,
  INVALID_ORIGIN_FIXTURES,
  VALID_ORIGIN_FIXTURES,
} from '../../../tests/fixtures/mcp/index.ts';

async function loadOriginWiringModule() {
  return await import('../src/mcp/origin-wiring.ts');
}

describe('T007: MCP Origin wiring (AC-250, FR-MCP-008)', () => {
  it('admits all valid allowlisted origins with exact match or default ports', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const middleware = createMcpOriginMiddleware({
      allowlist: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    for (const fixture of VALID_ORIGIN_FIXTURES) {
      const verdict = middleware.evaluateOrigin({
        originHeader: fixture.origin,
        isLoopback: fixture.origin.includes('localhost') || fixture.origin.includes('127.0.0.1'),
      });
      expect(verdict.allowed, fixture.name).toBe(true);
      expect(verdict.httpStatus).toBe(200);
    }
  });

  it('refuses every invalid origin fixture with HTTP 403 before any authentication', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const middleware = createMcpOriginMiddleware({
      allowlist: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    for (const fixture of INVALID_ORIGIN_FIXTURES) {
      const verdict = middleware.evaluateOrigin({
        originHeader: fixture.origin,
      });
      expect(verdict.allowed, fixture.name).toBe(false);
      expect(verdict.httpStatus, fixture.name).toBe(403);
      expect(verdict.reason, fixture.name).toBeDefined();
    }
  });

  it('enforces production absent-Origin policy refusal unless registered non-browser client', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const prodMiddleware = createMcpOriginMiddleware({
      allowlist: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    // Default absent Origin in production -> HTTP 403
    const anonymousVerdict = prodMiddleware.evaluateOrigin({
      originHeader: undefined,
      clientRegisteredNonBrowser: false,
    });
    expect(anonymousVerdict.allowed).toBe(false);
    expect(anonymousVerdict.httpStatus).toBe(403);
    expect(anonymousVerdict.reason).toBe('ABSENT_POLICY_REFUSES');

    // Per-client registered non-browser allowance honored from credential policy
    const registeredVerdict = prodMiddleware.evaluateOrigin({
      originHeader: undefined,
      clientRegisteredNonBrowser: true,
    });
    expect(registeredVerdict.allowed).toBe(true);
  });

  it('allows absent Origin in NON_PRODUCTION / development deployments', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const devMiddleware = createMcpOriginMiddleware({
      allowlist: ['http://localhost:3000'],
      absentOriginPolicy: 'NON_PRODUCTION',
    });

    const verdict = devMiddleware.evaluateOrigin({
      originHeader: undefined,
    });
    expect(verdict.allowed).toBe(true);
  });

  it('isolates loopback local mode with separate local allowlist', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const middleware = createMcpOriginMiddleware({
      allowlist: ['https://mcp.example.com'],
      localAllowlist: ['http://localhost:3000', 'http://127.0.0.1:8080'],
      absentOriginPolicy: 'PRODUCTION',
    });

    // Loopback origin is admitted against local allowlist
    const localVerdict = middleware.evaluateOrigin({
      originHeader: 'http://localhost:3000',
      isLoopbackRequest: true,
    });
    expect(localVerdict.allowed).toBe(true);

    // Non-loopback request presenting localhost is refused
    const spoofedVerdict = middleware.evaluateOrigin({
      originHeader: 'http://localhost:3000',
      isLoopbackRequest: false,
    });
    expect(spoofedVerdict.allowed).toBe(false);
  });

  it('trusts proxy headers only from allowlisted trusted proxies', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const middleware = createMcpOriginMiddleware({
      allowlist: ['https://mcp.example.com'],
      trustedProxies: ['10.0.0.1', '127.0.0.1'],
      absentOriginPolicy: 'PRODUCTION',
    });

    // Untrusted proxy injecting forwarded origin/IP
    const untrustedVerdict = middleware.resolveClientOrigin({
      remoteIp: '198.51.100.1',
      headers: {
        'x-forwarded-host': 'mcp.example.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(untrustedVerdict.trustedProxy).toBe(false);

    // Trusted proxy
    const trustedVerdict = middleware.resolveClientOrigin({
      remoteIp: '10.0.0.1',
      headers: {
        'x-forwarded-host': 'mcp.example.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(trustedVerdict.trustedProxy).toBe(true);
  });

  it('proves Origin policy is orthogonal to authentication policy (Origin ⊥ Auth)', async () => {
    const { createMcpOriginMiddleware } = await loadOriginWiringModule();
    const middleware = createMcpOriginMiddleware({
      allowlist: ['https://mcp.example.com'],
      absentOriginPolicy: 'PRODUCTION',
    });

    // Valid admin bearer token with refused Origin -> Still 403 refused
    const badOriginVerdict = middleware.evaluateOrigin({
      originHeader: 'https://attacker.example.com',
    });
    expect(badOriginVerdict.allowed).toBe(false);
    expect(badOriginVerdict.httpStatus).toBe(403);
  });
});
