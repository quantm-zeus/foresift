/**
 * apps/api/test/origin-wiring.spec.ts
 *
 * Unit tests for MCP Origin wiring and decision middleware (T007 / AC-250).
 * Traces: FR-MCP-008, §17.2, ADR-055, AC-250.
 *
 * Asserts:
 * - Exact scheme-host-port allowlist matching.
 * - Refused present Origin returns HTTP 403 BEFORE session creation, authn, tool/resource access.
 * - Punycode lookalike, trailing dot, wrong port, mixed scheme return typed 403 verdicts.
 * - Absent-Origin policy: production refuses; registered non-browser clients admitted if credential flags it.
 * - Loopback local mode with separate local allowlist.
 * - Proxy headers trusted ONLY from allowlisted proxies.
 * - Origin policy is orthogonal to authentication policy (even valid auth fails if Origin is refused).
 */
import { describe, expect, it } from 'bun:test';
import {
  McpOriginMiddleware,
  handleOriginGate,
  type OriginCheckInput,
  type OriginGateVerdict,
} from '../src/mcp/origin-wiring.ts';

const ALLOWED_ORIGINS = ['https://mcp.foresift.io', 'https://desktop.claude.ai'];
const LOCAL_ALLOWLIST = ['http://localhost:3000', 'http://127.0.0.1:3000'];

describe('T007: MCP Origin wiring (FR-MCP-008 / AC-250)', () => {
  it('admits an exact allowlisted origin with implied or explicit port', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    const verdict = gate.check({ origin: 'https://mcp.foresift.io' });
    expect(verdict.allowed).toBe(true);
    expect(verdict.httpStatus).toBe(200);

    const explicitPortVerdict = gate.check({ origin: 'https://mcp.foresift.io:443' });
    expect(explicitPortVerdict.allowed).toBe(true);
  });

  it('refuses present non-allowlisted origins with HTTP 403', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    const verdict = gate.check({ origin: 'https://unauthorized.external.com' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.httpStatus).toBe(403);
    expect(verdict.refusalReason).toBe('NOT_ALLOWLISTED');
  });

  it('refuses punycode lookalikes, trailing dots, wrong ports, and mixed schemes with HTTP 403', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    // Punycode lookalike
    expect(gate.check({ origin: 'https://xn--mcp-9o0a.foresift.io' })).toMatchObject({
      allowed: false,
      httpStatus: 403,
      refusalReason: 'PUNYCODE_CONFUSED',
    });

    // Trailing dot
    expect(gate.check({ origin: 'https://mcp.foresift.io.' })).toMatchObject({
      allowed: false,
      httpStatus: 403,
      refusalReason: 'TRAILING_DOT',
    });

    // Wrong port
    expect(gate.check({ origin: 'https://mcp.foresift.io:8443' })).toMatchObject({
      allowed: false,
      httpStatus: 403,
      refusalReason: 'WRONG_PORT',
    });

    // Mixed scheme
    expect(gate.check({ origin: 'http://mcp.foresift.io' })).toMatchObject({
      allowed: false,
      httpStatus: 403,
      refusalReason: 'MIXED_SCHEME',
    });
  });

  it('refuses absent Origin in PRODUCTION policy by default', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    const verdict = gate.check({ origin: undefined });
    expect(verdict.allowed).toBe(false);
    expect(verdict.httpStatus).toBe(403);
    expect(verdict.refusalReason).toBe('ABSENT_POLICY_REFUSES');
  });

  it('honors registered non-browser client allowance for absent origin', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    const verdict = gate.check({
      origin: undefined,
      clientCredentialPolicy: { allowAbsentOriginForRegisteredNonBrowser: true },
    });
    expect(verdict.allowed).toBe(true);
  });

  it('supports loopback local mode with separate local allowlist', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      localAllowlist: LOCAL_ALLOWLIST,
      isLocalMode: true,
      absentOriginPolicy: 'NON_PRODUCTION',
    });

    expect(gate.check({ origin: 'http://localhost:3000' }).allowed).toBe(true);
    expect(gate.check({ origin: 'http://127.0.0.1:3000' }).allowed).toBe(true);
    expect(gate.check({ origin: 'http://192.168.1.100:3000' }).allowed).toBe(false);
  });

  it('trusts forwarded headers ONLY from allowlisted reverse proxies', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      trustedProxies: ['10.0.0.1', '127.0.0.1'],
      absentOriginPolicy: 'PRODUCTION',
    });

    // Request direct from untrusted client with spoofed X-Forwarded-For
    const untrusted = gate.resolveClientOrigin({
      directRemoteIp: '203.0.113.50',
      headers: {
        origin: 'https://mcp.foresift.io',
        'x-forwarded-for': '10.0.0.1',
      },
    });
    expect(untrusted.isTrustedProxy).toBe(false);

    // Request through trusted proxy
    const trusted = gate.resolveClientOrigin({
      directRemoteIp: '10.0.0.1',
      headers: {
        origin: 'https://mcp.foresift.io',
        'x-forwarded-for': '203.0.113.50',
      },
    });
    expect(trusted.isTrustedProxy).toBe(true);
  });

  it('enforces that Origin policy is strictly orthogonal to authentication policy', () => {
    const gate = new McpOriginMiddleware({
      allowedOrigins: ALLOWED_ORIGINS,
      absentOriginPolicy: 'PRODUCTION',
    });

    // Even if caller possesses a valid bearer token, bad origin is rejected with 403
    const verdict = gate.check({
      origin: 'https://attacker.evil.com',
      hasValidBearerToken: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.httpStatus).toBe(403);
  });
});
