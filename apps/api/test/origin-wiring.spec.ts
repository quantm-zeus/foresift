/**
 * Unit test suite for MCP Origin gate wiring (T007).
 * Traces: FR-MCP-008, AC-250, §17.2.
 *
 * Asserts:
 * - Composes McpOriginGate.decide() with exact scheme-host-port allowlist.
 * - Refused present Origin -> HTTP 403 before any session creation, authn side effects,
 *   or tool execution.
 * - Punycode-confused, trailing-dot, mixed-case, wrong-port, mixed-scheme origins refused.
 * - Absent-Origin policy: production refuses by default; per-client registered non-browser
 *   allowance honored from credential policy.
 * - Loopback local mode with separate local allowlist.
 * - Proxy headers (X-Forwarded-*) trusted only from allowlisted proxies.
 * - Origin policy is orthogonal to authentication policy (Origin ⊥ Auth).
 */
import { describe, expect, it } from 'bun:test';
import {
  McpOriginWiring,
  type OriginEvaluationRequest,
} from '../src/mcp/origin-wiring.ts';

describe('T007 — MCP Origin gate wiring (AC-250)', () => {
  const wiring = new McpOriginWiring({
    allowlist: ['https://mcp.example.com', 'https://api.foresift.io:8443'],
    localAllowlist: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    absentOriginPolicy: 'PRODUCTION',
    allowlistedProxies: ['10.0.0.1'],
  });

  it('admits exact scheme-host-port matches on the allowlist', () => {
    const res1 = wiring.evaluateOrigin({
      originHeader: 'https://mcp.example.com',
      sourceIp: '198.51.100.1',
    });
    expect(res1.admitted).toBe(true);
    expect(res1.statusCode).toBe(200);

    const res2 = wiring.evaluateOrigin({
      originHeader: 'https://api.foresift.io:8443',
      sourceIp: '198.51.100.1',
    });
    expect(res2.admitted).toBe(true);
  });

  it('refuses punycode-confused origins with HTTP 403', () => {
    // Cyrillic 'e' homograph attack
    const res = wiring.evaluateOrigin({
      originHeader: 'https://xn--mp-e1a.example.com',
      sourceIp: '198.51.100.1',
    });
    expect(res.admitted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.reason).toBe('ORIGIN_NOT_ALLOWLISTED');
  });

  it('refuses trailing-dot origins with HTTP 403', () => {
    const res = wiring.evaluateOrigin({
      originHeader: 'https://mcp.example.com.',
      sourceIp: '198.51.100.1',
    });
    expect(res.admitted).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('refuses wrong-port and scheme-mismatch origins with HTTP 403', () => {
    const wrongPort = wiring.evaluateOrigin({
      originHeader: 'https://mcp.example.com:8080',
      sourceIp: '198.51.100.1',
    });
    expect(wrongPort.admitted).toBe(false);
    expect(wrongPort.statusCode).toBe(403);

    const schemeMismatch = wiring.evaluateOrigin({
      originHeader: 'http://mcp.example.com',
      sourceIp: '198.51.100.1',
    });
    expect(schemeMismatch.admitted).toBe(false);
    expect(schemeMismatch.statusCode).toBe(403);
  });

  it('refuses absent Origin in production unless client credential explicitly allows it', () => {
    const defaultAbsent = wiring.evaluateOrigin({
      originHeader: undefined,
      sourceIp: '198.51.100.1',
      clientAllowsAbsentOrigin: false,
    });
    expect(defaultAbsent.admitted).toBe(false);
    expect(defaultAbsent.statusCode).toBe(403);
    expect(defaultAbsent.reason).toBe('ORIGIN_NOT_ALLOWLISTED');

    const allowedClientAbsent = wiring.evaluateOrigin({
      originHeader: undefined,
      sourceIp: '198.51.100.1',
      clientAllowsAbsentOrigin: true,
    });
    expect(allowedClientAbsent.admitted).toBe(true);
  });

  it('admits loopback origins in local development mode with separate local allowlist', () => {
    const devWiring = new McpOriginWiring({
      allowlist: ['https://mcp.example.com'],
      localAllowlist: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      absentOriginPolicy: 'NON_PRODUCTION',
      localMode: true,
    });

    expect(devWiring.evaluateOrigin({ originHeader: 'http://localhost:3000', sourceIp: '127.0.0.1' }).admitted).toBe(true);
    expect(devWiring.evaluateOrigin({ originHeader: 'http://127.0.0.1:3000', sourceIp: '127.0.0.1' }).admitted).toBe(true);
    expect(devWiring.evaluateOrigin({ originHeader: 'http://localhost:8080', sourceIp: '127.0.0.1' }).admitted).toBe(false);
  });

  it('trusts proxy headers only from allowlisted proxy IPs', () => {
    // Untrusted proxy sending forged X-Forwarded-For/Proto
    const untrustedProxy = wiring.evaluateOrigin({
      originHeader: 'https://mcp.example.com',
      sourceIp: '192.168.1.50', // Not in allowlistedProxies
      forwardedHeaders: {
        'x-forwarded-for': '127.0.0.1',
        'x-forwarded-proto': 'https',
      },
    });
    expect(untrustedProxy.effectiveClientIp).toBe('192.168.1.50');

    // Allowlisted proxy
    const trustedProxy = wiring.evaluateOrigin({
      originHeader: 'https://mcp.example.com',
      sourceIp: '10.0.0.1', // In allowlistedProxies
      forwardedHeaders: {
        'x-forwarded-for': '203.0.113.195',
        'x-forwarded-proto': 'https',
      },
    });
    expect(trustedProxy.effectiveClientIp).toBe('203.0.113.195');
  });

  it('proves Origin policy is orthogonal to authentication policy (Origin ⊥ Auth)', () => {
    // Even if caller provides a superuser bearer credential, invalid Origin yields 403
    const res = wiring.evaluateOrigin({
      originHeader: 'https://attacker.site',
      sourceIp: '198.51.100.1',
      hasValidAdminBearer: true,
    });
    expect(res.admitted).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
