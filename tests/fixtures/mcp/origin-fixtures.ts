/**
 * MCP Origin test fixtures (FR-MCP-008; AC-250).
 * Covering exact scheme-host-port allowlisting, hygiene checks
 * (punycode, trailing-dot, mixed-case, wrong-port, IPv6, mixed-scheme, null/absent).
 */

export interface OriginTestCase {
  readonly origin: string | undefined;
  readonly expectedDecision: 'ALLOW' | 'REFUSE';
  readonly expectedReason?:
    | 'MALFORMED'
    | 'MIXED_SCHEME'
    | 'TRAILING_DOT'
    | 'PUNYCODE_CONFUSED'
    | 'WRONG_PORT'
    | 'WRONG_HOST'
    | 'NOT_ALLOWLISTED'
    | 'ABSENT_POLICY_REFUSES';
  readonly description: string;
}

export const TEST_ALLOWLIST: readonly string[] = [
  'https://mcp.example.com',
  'https://mcp.example.com:443',
  'https://app.foresift.io',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
];

export const VALID_ORIGINS: readonly string[] = [
  'https://mcp.example.com',
  'https://mcp.example.com:443',
  'https://app.foresift.io',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://[::1]:8080',
];

export const INVALID_ORIGIN_CASES: readonly OriginTestCase[] = [
  // Punycode lookalikes and homoglyphs
  {
    origin: 'https://xn--mcp-9o0a.example.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'PUNYCODE_CONFUSED',
    description: 'punycode label impersonation',
  },
  {
    origin: 'https://xn--pple-43d.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'PUNYCODE_CONFUSED',
    description: 'punycode domain confusion',
  },
  {
    origin: 'https://mсp.example.com', // Cyrillic 'с' (U+0441)
    expectedDecision: 'REFUSE',
    expectedReason: 'PUNYCODE_CONFUSED',
    description: 'non-ASCII homoglyph character',
  },

  // Trailing dots
  {
    origin: 'https://mcp.example.com.',
    expectedDecision: 'REFUSE',
    expectedReason: 'TRAILING_DOT',
    description: 'trailing dot in FQDN format',
  },
  {
    origin: 'https://app.foresift.io.',
    expectedDecision: 'REFUSE',
    expectedReason: 'TRAILING_DOT',
    description: 'trailing dot on domain',
  },

  // Mixed scheme / scheme confusion
  {
    origin: 'http://mcp.example.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'MIXED_SCHEME',
    description: 'insecure http for https allowlist entry',
  },
  {
    origin: 'ftp://mcp.example.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'MIXED_SCHEME',
    description: 'non-web ftp scheme',
  },
  {
    origin: 'ws://mcp.example.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'MIXED_SCHEME',
    description: 'websocket scheme instead of http/https',
  },

  // Wrong port
  {
    origin: 'https://mcp.example.com:8443',
    expectedDecision: 'REFUSE',
    expectedReason: 'WRONG_PORT',
    description: 'non-default port for 443 allowlist entry',
  },
  {
    origin: 'http://localhost:9999',
    expectedDecision: 'REFUSE',
    expectedReason: 'WRONG_PORT',
    description: 'unregistered port on localhost',
  },
  {
    origin: 'http://127.0.0.1:3000',
    expectedDecision: 'REFUSE',
    expectedReason: 'WRONG_PORT',
    description: 'port mismatch on loopback IPv4',
  },

  // Wrong host / subdomain confusion
  {
    origin: 'https://evil-mcp.example.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'WRONG_HOST',
    description: 'subdomain on same registrable domain',
  },
  {
    origin: 'https://mcp.example.com.attacker.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'NOT_ALLOWLISTED',
    description: 'suffix match attack',
  },
  {
    origin: 'https://unrelated.org',
    expectedDecision: 'REFUSE',
    expectedReason: 'NOT_ALLOWLISTED',
    description: 'completely unrelated host',
  },

  // Malformed origins
  {
    origin: 'not-a-valid-url',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'garbage string not a URI',
  },
  {
    origin: 'https://user:pass@mcp.example.com',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'origin carrying userinfo credentials',
  },
  {
    origin: 'https://mcp.example.com/path/to/resource',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'origin carrying a pathname',
  },
  {
    origin: 'https://mcp.example.com?query=val',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'origin carrying query parameters',
  },
  {
    origin: 'https://mcp.example.com#fragment',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'origin carrying a hash fragment',
  },

  // Null origin
  {
    origin: 'null',
    expectedDecision: 'REFUSE',
    expectedReason: 'MALFORMED',
    description: 'literal "null" string origin',
  },
];
