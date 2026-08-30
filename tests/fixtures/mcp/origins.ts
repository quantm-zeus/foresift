/**
 * MCP Origin fixtures (FR-MCP-008, §17.2, ADR-055, AC-250).
 *
 * Covers exact scheme-host-port allowlist sets, punycode lookalikes, trailing-dot
 * spellings, mixed-case strings, wrong ports, IPv6 representations, mixed schemes,
 * and malformed non-origin inputs.
 */

/** Canonical allowlist registered for production test suites. */
export const ALLOWED_ORIGINS: readonly string[] = [
  'https://mcp.example.com',
  'https://mcp.example.com:443',
  'https://app.foresift.io',
  'https://staging-mcp.foresift.io:8443',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
] as const;

/** Valid origin headers that match the allowlist exactly or with canonical defaults. */
export const VALID_ORIGIN_FIXTURES = [
  {
    name: 'exact https allowlist hit',
    origin: 'https://mcp.example.com',
    expectedAllow: true,
  },
  {
    name: 'explicit default 443 port spelling',
    origin: 'https://mcp.example.com:443',
    expectedAllow: true,
  },
  {
    name: 'second allowlisted production host',
    origin: 'https://app.foresift.io',
    expectedAllow: true,
  },
  {
    name: 'non-default explicit port allowlist hit',
    origin: 'https://staging-mcp.foresift.io:8443',
    expectedAllow: true,
  },
  {
    name: 'loopback localhost with explicit port',
    origin: 'http://localhost:3000',
    expectedAllow: true,
  },
  {
    name: 'loopback IPv4 with port',
    origin: 'http://127.0.0.1:8080',
    expectedAllow: true,
  },
  {
    name: 'loopback IPv6 bracketed with port',
    origin: 'http://[::1]:8080',
    expectedAllow: true,
  },
] as const;

/** Invalid origin headers covering all mandatory rejection classes (AC-250). */
export const INVALID_ORIGIN_FIXTURES = [
  {
    name: 'punycode lookalike attack (Cyrillic a)',
    origin: 'https://xn--mc-xja.example.com',
    refusalReason: 'WRONG_HOST',
  },
  {
    name: 'punycode homograph attack',
    origin: 'https://xn--e1aybc.example.com',
    refusalReason: 'WRONG_HOST',
  },
  {
    name: 'trailing dot DNS notation',
    origin: 'https://mcp.example.com.',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'wrong port (non-matching port on allowed host)',
    origin: 'https://mcp.example.com:8443',
    refusalReason: 'WRONG_PORT',
  },
  {
    name: 'wrong port (http 80 port on https allowed host)',
    origin: 'https://mcp.example.com:80',
    refusalReason: 'WRONG_PORT',
  },
  {
    name: 'mixed scheme (http when https allowlisted)',
    origin: 'http://mcp.example.com',
    refusalReason: 'MIXED_SCHEME',
  },
  {
    name: 'unregistered domain entirely',
    origin: 'https://evil.example.com',
    refusalReason: 'WRONG_HOST',
  },
  {
    name: 'unbracketed IPv6 origin (malformed)',
    origin: 'http://::1:8080',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'malformed non-origin string (arbitrary text)',
    origin: 'not-a-valid-origin',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'origin with userinfo component (forbidden by RFC 6454)',
    origin: 'https://user:pass@mcp.example.com',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'origin with path component',
    origin: 'https://mcp.example.com/api',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'origin with trailing slash',
    origin: 'https://mcp.example.com/',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'javascript scheme pseudo-origin',
    origin: 'javascript:alert(1)',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'data scheme pseudo-origin',
    origin: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'null string literal origin',
    origin: 'null',
    refusalReason: 'MALFORMED',
  },
  {
    name: 'empty string origin',
    origin: '',
    refusalReason: 'MALFORMED',
  },
] as const;
