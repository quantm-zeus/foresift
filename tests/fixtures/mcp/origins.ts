/**
 * MCP Origin fixtures (FR-MCP-008, ADR-055, AC-250).
 *
 * Provides valid and invalid Origin sets covering exact scheme-host-port
 * tuples, punycode attacks, trailing dots, mixed schemes, wrong ports,
 * IPv6 loopback, and absent-origin policies.
 */

export interface OriginTestCase {
  readonly origin: string | undefined;
  readonly expectedDecision: 'ALLOW' | 'REFUSE';
  readonly expectedReason?: string;
  readonly description: string;
}

/** Production allowlist for standard test configurations. */
export const MCP_PRODUCTION_ALLOWLIST: readonly string[] = [
  'https://mcp.foresift.internal',
  'https://partner.agent-gateway.io',
];

/** Non-production / local development allowlist. */
export const MCP_LOCAL_ALLOWLIST: readonly string[] = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
];

/** Valid allowlisted origins that MUST admit cleanly. */
export const VALID_MCP_ORIGINS: readonly string[] = [
  'https://mcp.foresift.internal',
  'https://mcp.foresift.internal:443',
  'https://partner.agent-gateway.io',
  'https://partner.agent-gateway.io:443',
];

/** Valid local development origins. */
export const VALID_LOCAL_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://localhost:3000:80', // normalized
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
];

/** Invalid origins representing attack vectors or hygiene failures. */
export const INVALID_MCP_ORIGINS = {
  PUNYCODE: [
    'https://xn--mcp-9o0a.foresift.internal',
    'https://xn--e1aybc.foresift.internal',
    'https://mcp.xn--foresft-vxa.internal',
    'https://xn--80ak6aa92e.com',
  ],
  TRAILING_DOT: [
    'https://mcp.foresift.internal.',
    'https://partner.agent-gateway.io.',
    'http://localhost:3000.',
  ],
  MIXED_SCHEME: [
    'http://mcp.foresift.internal',
    'ftp://mcp.foresift.internal',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
  ],
  WRONG_PORT: [
    'https://mcp.foresift.internal:8443',
    'https://mcp.foresift.internal:80',
    'https://mcp.foresift.internal:444',
    'https://partner.agent-gateway.io:8080',
  ],
  WRONG_HOST_OR_SUBDOMAIN: [
    'https://evil.mcp.foresift.internal',
    'https://mcp.foresift.internal.attacker.com',
    'https://attacker-foresift.internal',
    'https://other.foresift.internal',
    'https://mcp-foresift.internal',
  ],
  MALFORMED: [
    'not-a-valid-origin',
    'https://',
    'https://user:password@mcp.foresift.internal',
    'https://mcp.foresift.internal/path/to/resource',
    'https://mcp.foresift.internal?query=1',
    'https://mcp.foresift.internal#fragment',
  ],
  NULL_OR_ABSENT: [
    'null',
    '',
    undefined,
  ],
} as const;

/** Comprehensive matrix of origin test vectors with expected verdict classifications. */
export const MCP_ORIGIN_TEST_MATRIX: readonly OriginTestCase[] = [
  {
    origin: 'https://mcp.foresift.internal',
    expectedDecision: 'ALLOW',
    description: 'Exact match on HTTPS allowlist with default port',
  },
  {
    origin: 'https://mcp.foresift.internal:443',
    expectedDecision: 'ALLOW',
    description: 'Explicit default port 443 on allowlisted HTTPS host',
  },
  {
    origin: 'https://partner.agent-gateway.io',
    expectedDecision: 'ALLOW',
    description: 'Secondary allowlisted partner domain',
  },
  {
    origin: 'https://xn--mcp-9o0a.foresift.internal',
    expectedDecision: 'REFUSE',
    expectedReason: 'PUNYCODE_CONFUSED',
    description: 'Punycode internationalized domain label',
  },
  {
    origin: 'https://mcp.foresift.internal.',
    expectedDecision: 'REFUSE',
    expectedReason: 'TRAILING_DOT',
    description: 'Trailing dot on host',
  },
  {
    origin: 'http://mcp.foresift.internal',
    expectedDecision: 'REFUSE',
    expectedReason: 'MIXED_SCHEME',
    description: 'HTTP scheme for HTTPS allowlist entry',
  },
  {
    origin: 'https://mcp.foresift.internal:8443',
    expectedDecision: 'REFUSE',
    expectedReason: 'WRONG_PORT',
    description: 'Non-matching port on allowlisted host',
  },
  {
    origin: 'https://evil.mcp.foresift.internal',
    expectedDecision: 'REFUSE',
    expectedReason: 'WRONG_HOST',
    description: 'Subdomain confusion / lookalike on same registrable domain',
  },
  {
    origin: 'https://unrelated-domain.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'NOT_ALLOWLISTED',
    description: 'Completely un-allowlisted foreign origin',
  },
  {
    origin: 'https://mcp.foresift.internal/with/path',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'Origin containing path component',
  },
  {
    origin: 'https://admin:secret@mcp.foresift.internal',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'Origin containing userinfo',
  },
];
