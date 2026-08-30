/**
 * MCP Origin test fixtures (FR-MCP-008, AC-250, PRD §17.2).
 * Valid, invalid, punycode-confused, trailing-dot, mixed-case, wrong-port,
 * IPv6, mixed-scheme, and absent-origin test sets.
 */

export interface OriginTestCase {
  readonly origin: string | undefined;
  readonly expectedDecision: 'ALLOW' | 'REFUSE';
  readonly reason?: string;
  readonly description: string;
}

export const VALID_ALLOWLISTED_ORIGINS = [
  'https://mcp.example.com',
  'https://api.foresift.io',
  'https://agent.foresift.internal:8443',
  'https://dashboard.foresift.dev',
] as const;

export const LOOPBACK_LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
] as const;

export const PUNYCODE_ATTACK_ORIGINS = [
  'https://xn--mc-xja.example.com',
  'https://xn--e1aybc.example.com',
  'https://xn--foresft-7ya.io',
  'https://mcp.xn--exmple-e1a.com',
] as const;

export const TRAILING_DOT_ORIGINS = [
  'https://mcp.example.com.',
  'https://api.foresift.io.',
  'https://dashboard.foresift.dev.',
] as const;

export const MIXED_SCHEME_ORIGINS = [
  'http://mcp.example.com',
  'http://api.foresift.io',
  'ws://mcp.example.com',
  'wss://mcp.example.com',
  'ftp://mcp.example.com',
] as const;

export const WRONG_PORT_ORIGINS = [
  'https://mcp.example.com:8080',
  'https://mcp.example.com:8443',
  'https://mcp.example.com:3000',
  'https://api.foresift.io:80',
] as const;

export const MALFORMED_ORIGINS = [
  'not an origin',
  'https://user@mcp.example.com',
  'https://user:password@mcp.example.com',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'null',
  '',
  '   ',
  'https://',
  'https://mcp.example.com/path',
  'https://mcp.example.com?query=1',
  'https://mcp.example.com#hash',
] as const;

export const FOREIGN_UNREGISTERED_ORIGINS = [
  'https://evil.example.com',
  'https://attacker.org',
  'https://example.com',
  'https://subdomain.mcp.example.com',
  'https://mcp.example.com.evil.com',
] as const;

export const IPV6_EDGE_CASE_ORIGINS = [
  { origin: 'http://[::1]:3000', validLoopback: true },
  { origin: 'http://[::ffff:127.0.0.1]:3000', validLoopback: false },
  { origin: 'http://[fe80::1]:3000', validLoopback: false },
  { origin: 'http://[2001:db8::1]:3000', validLoopback: false },
] as const;

export const COMPREHENSIVE_ORIGIN_MATRIX: readonly OriginTestCase[] = [
  {
    origin: 'https://mcp.example.com',
    expectedDecision: 'ALLOW',
    description: 'exact allowlist match with implicit 443 port',
  },
  {
    origin: 'https://mcp.example.com:443',
    expectedDecision: 'ALLOW',
    description: 'exact allowlist match with explicit 443 port',
  },
  {
    origin: 'https://api.foresift.io',
    expectedDecision: 'ALLOW',
    description: 'secondary registered allowlisted origin',
  },
  {
    origin: 'https://agent.foresift.internal:8443',
    expectedDecision: 'ALLOW',
    description: 'custom non-default port in allowlist',
  },
  {
    origin: 'https://xn--mc-xja.example.com',
    expectedDecision: 'REFUSE',
    reason: 'PUNYCODE_CONFUSED',
    description: 'punycode homoglyph lookalike',
  },
  {
    origin: 'https://mcp.example.com.',
    expectedDecision: 'REFUSE',
    reason: 'TRAILING_DOT',
    description: 'trailing dot host spelling',
  },
  {
    origin: 'http://mcp.example.com',
    expectedDecision: 'REFUSE',
    reason: 'MIXED_SCHEME',
    description: 'http scheme attempt at https endpoint',
  },
  {
    origin: 'https://mcp.example.com:8443',
    expectedDecision: 'REFUSE',
    reason: 'WRONG_PORT',
    description: 'wrong port on allowlisted host',
  },
  {
    origin: 'https://evil.example.com',
    expectedDecision: 'REFUSE',
    reason: 'NOT_ALLOWLISTED',
    description: 'unregistered origin domain',
  },
  {
    origin: 'not an origin',
    expectedDecision: 'REFUSE',
    reason: 'MALFORMED',
    description: 'malformed non-URL origin string',
  },
  {
    origin: 'https://user:secret@mcp.example.com',
    expectedDecision: 'REFUSE',
    reason: 'MALFORMED',
    description: 'origin with userinfo credentials',
  },
  {
    origin: undefined,
    expectedDecision: 'REFUSE',
    reason: 'ABSENT_POLICY_REFUSES',
    description: 'absent origin in production policy',
  },
];
