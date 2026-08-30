/**
 * Accept/refuse matrices for the Model Context Protocol (MCP) schema family
 * (FR-MCP-001…010, manifest schemaRefs for §17 / §29.4).
 * Every `.strict()` object must refuse unknown keys; vocabularies mirror the
 * domain §16 & §17 constants; prohibited financial payload scrubbing and §29.4
 * caps are structural.
 */
import { describe, expect, it } from 'bun:test';
// prettier-ignore
// @ts-expect-error ../src/mcp.ts is implemented in T002
import { MCP_SCHEMA_REGISTRY_VERSION, MCP_SCHEMAS, McpOutputEnvelopeSchema, McpOutputMetadataSchema, McpSessionBindingSchema, McpResumableCursorSchema, McpRefusalReasonSchema, McpPromptNameSchema, McpResourceUriSchema, McpClientContextSchema, parseMcpSchema, ALL_MCP_PROMPT_NAMES, ALL_MCP_RESOURCE_SCHEMES, type McpSchemaName } from '../src/mcp.ts';

const at = (s: string) => s;

const outputMetadataFixture = {
  toolName: 'discover_candidates',
  toolVersion: '1.0.0',
  provider: 'first-party-dex-observer',
  operation: 'discover_candidates',
  evidenceUris: ['evidence://ev-001', 'evidence://ev-002'],
  fetchedAt: at('2026-08-01T00:00:10Z'),
  observedAt: at('2026-08-01T00:00:00Z'),
  availableAt: at('2026-08-01T00:00:05Z'),
  freshnessSeconds: 30,
  qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
  conflicts: [],
  costUnits: 1,
  rightsPolicy: 'VERIFIED_DERIVED_PERMITTED',
  sourceDependence: 'INDEPENDENT',
  partial: false,
  nextCursor: 'cur_run101_seq010_1a2b3c4d',
};

const outputEnvelopeFixture = {
  content: [
    {
      type: 'text',
      text: 'Discovered 2 candidate tokens with complete provenance.',
    },
  ],
  structuredData: {
    candidates: [
      {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Wrapped SOL',
      },
    ],
  },
  meta: outputMetadataFixture,
};

const sessionBindingFixture = {
  sessionId: 'sess_live_4f9a1c8b2e3d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e',
  actor: 'agent-discovery@example.com',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  createdAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-08-01T01:00:00Z'),
  terminatedAt: null,
};

const cursorFixture = {
  cursor: 'cur_run101_seq001_8a7f6e5d4c3b2a10',
  runId: 'run-discovery-101',
  sequenceNumber: 1,
  actor: 'agent-discovery@example.com',
  createdAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-08-01T01:00:00Z'),
  authorized: true,
};

const clientContextFixture = {
  clientId: 'client-discovery-001',
  actor: 'agent-discovery@example.com',
  profileId: 'discovery',
  allowedScopes: ['mcp:tools:read', 'mcp:tools:call', 'discovery:read'],
  allowedOrigins: ['https://mcp.example.com'],
  rateLimitRps: 10,
  concurrencyLimit: 2,
  createdAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-12-31T23:59:59Z'),
  revokedAt: null,
};

describe('MCP schema registry & versioning', () => {
  it('exposes a positive integer registry version', () => {
    expect(MCP_SCHEMA_REGISTRY_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('exposes every declared MCP schema by name in MCP_SCHEMAS', () => {
    const names = Object.keys(MCP_SCHEMAS);
    expect(names).toContain('McpOutputMetadata');
    expect(names).toContain('McpOutputEnvelope');
    expect(names).toContain('McpSessionBinding');
    expect(names).toContain('McpResumableCursor');
    expect(names).toContain('McpRefusalReason');
    expect(names).toContain('McpClientContext');
  });

  for (const name of Object.keys(MCP_SCHEMAS) as McpSchemaName[]) {
    it(`parseMcpSchema(${name}) parses valid payloads and refuses garbage`, () => {
      expect(() => parseMcpSchema(name, { unvettedField: 'garbage' })).toThrow();
    });
  }
});

describe('MCP prompt & resource vocabularies (§17.3)', () => {
  it('enumerates exactly the eight §17.3 prompt names', () => {
    expect([...ALL_MCP_PROMPT_NAMES].sort()).toEqual(
      [
        'analyze-token',
        'investigate-alert',
        'compare-candidates',
        'audit-security',
        'explain-original-decision',
        're-evaluate-current',
        'analyze-wallet-cluster',
        'challenge-opportunity-thesis',
      ].sort(),
    );
    for (const prompt of ALL_MCP_PROMPT_NAMES) {
      expect(McpPromptNameSchema.parse(prompt)).toBe(prompt);
    }
    expect(() => McpPromptNameSchema.parse('unregistered-prompt')).toThrow();
  });

  it('enumerates exactly the eight §17.3 resource URI schemes', () => {
    expect([...ALL_MCP_RESOURCE_SCHEMES].sort()).toEqual(
      [
        'evidence',
        'run',
        'candidate',
        'snapshot',
        'report',
        'conflict',
        'capacity',
        'tradability',
      ].sort(),
    );

    const validUris = [
      'evidence://ev-12345',
      'run://run-abc-789',
      'candidate://cand-1/timeline',
      'snapshot://solana:token-1/2026-08-01T00:00:00Z',
      'report://rep-001',
      'conflict://conf-99',
      'capacity://cap-contract-7',
      'tradability://assess-sol-01',
    ];

    for (const uri of validUris) {
      expect(McpResourceUriSchema.parse(uri)).toBe(uri);
    }

    expect(() => McpResourceUriSchema.parse('http://example.com/data')).toThrow();
    expect(() => McpResourceUriSchema.parse('file:///etc/passwd')).toThrow();
    expect(() => McpResourceUriSchema.parse('ftp://files.example.com')).toThrow();
    expect(() => McpResourceUriSchema.parse('unknownscheme://resource-id')).toThrow();
  });
});

describe('MCP output envelope & metadata schemas (§17.4, FR-MCP-003)', () => {
  it('accepts a fully-populated MCP output metadata record and round-trips', () => {
    const parsed = McpOutputMetadataSchema.parse(outputMetadataFixture);
    expect(parsed.toolName).toBe('discover_candidates');
    expect(parsed.partial).toBe(false);
    expect(parsed.evidenceUris).toHaveLength(2);
    expect(parsed.qualityCodes).toContain('QUALITY_HIGH');
  });

  it('accepts an MCP output envelope with concise text and structured data', () => {
    const parsed = McpOutputEnvelopeSchema.parse(outputEnvelopeFixture);
    expect(parsed.content[0]?.type).toBe('text');
    expect(parsed.meta.toolName).toBe('discover_candidates');
  });

  it('strictly refuses unknown keys on output metadata and envelopes', () => {
    expect(() =>
      McpOutputMetadataSchema.parse({ ...outputMetadataFixture, unexpected: 'injected' }),
    ).toThrow();
    expect(() =>
      McpOutputEnvelopeSchema.parse({ ...outputEnvelopeFixture, unauthorized: true }),
    ).toThrow();
  });

  it('refuses missing mandated metadata fields', () => {
    for (const key of [
      'toolName',
      'toolVersion',
      'fetchedAt',
      'qualityCodes',
      'partial',
    ] as const) {
      const broken: Record<string, unknown> = { ...outputMetadataFixture };
      delete broken[key];
      expect(() => McpOutputMetadataSchema.parse(broken)).toThrow();
    }
  });

  it('enforces prohibited payload scrubbing structurally (no private keys, transactions, seeds)', () => {
    const forbiddenPayloads = [
      { privateKey: '5K...' },
      { seedPhrase: 'twelve words ...' },
      { transactionPayload: '01020304...' },
      { signatureRequest: 'sign here' },
      { routeTransaction: 'route info' },
      { executableFinancialInstruction: 'buy 10 SOL' },
    ];

    for (const forbidden of forbiddenPayloads) {
      expect(() =>
        McpOutputEnvelopeSchema.parse({
          ...outputEnvelopeFixture,
          structuredData: forbidden,
        }),
      ).toThrow();
    }
  });
});

describe('MCP session binding schema (§17.7, FR-MCP-009)', () => {
  it('accepts a valid cryptographically-random visible-ASCII session binding', () => {
    const parsed = McpSessionBindingSchema.parse(sessionBindingFixture);
    expect(parsed.sessionId).toBe(sessionBindingFixture.sessionId);
    expect(parsed.actor).toBe('agent-discovery@example.com');
    expect(parsed.protocolRevision).toBe('2025-11-25');
  });

  it('refuses session IDs containing non-ASCII, spaces, or control characters', () => {
    const invalidSessionIds = [
      '',
      '   ',
      'sess_\0nullbyte',
      'sess_with spaces_here',
      'sess_emoji_🚀_invalid',
      'sess_non_ascii_åäö',
    ];
    for (const invalidId of invalidSessionIds) {
      expect(() =>
        McpSessionBindingSchema.parse({ ...sessionBindingFixture, sessionId: invalidId }),
      ).toThrow();
    }
  });

  it('strictly refuses unknown keys on session bindings', () => {
    expect(() =>
      McpSessionBindingSchema.parse({ ...sessionBindingFixture, leakedSecret: 'sk-123' }),
    ).toThrow();
  });
});

describe('MCP resumable cursor schema (§17.4, FR-MCP-009)', () => {
  it('accepts a valid resumable cursor record and round-trips', () => {
    const parsed = McpResumableCursorSchema.parse(cursorFixture);
    expect(parsed.sequenceNumber).toBe(1);
    expect(parsed.runId).toBe('run-discovery-101');
    expect(parsed.authorized).toBe(true);
  });

  it('refuses negative sequence numbers', () => {
    expect(() =>
      McpResumableCursorSchema.parse({ ...cursorFixture, sequenceNumber: -1 }),
    ).toThrow();
  });

  it('strictly refuses unknown keys on cursor records', () => {
    expect(() =>
      McpResumableCursorSchema.parse({ ...cursorFixture, injectedFlag: true }),
    ).toThrow();
  });
});

describe('MCP client context schema (§17.5, FR-MCP-004, FR-MCP-005)', () => {
  it('accepts a valid client context with scoped profiles and rate limits', () => {
    const parsed = McpClientContextSchema.parse(clientContextFixture);
    expect(parsed.clientId).toBe('client-discovery-001');
    expect(parsed.rateLimitRps).toBe(10);
    expect(parsed.concurrencyLimit).toBe(2);
  });

  it('refuses negative rate limits or non-positive concurrency limits', () => {
    expect(() =>
      McpClientContextSchema.parse({ ...clientContextFixture, rateLimitRps: -1 }),
    ).toThrow();
    expect(() =>
      McpClientContextSchema.parse({ ...clientContextFixture, concurrencyLimit: 0 }),
    ).toThrow();
  });

  it('strictly refuses unvetted/unknown keys on client context', () => {
    expect(() =>
      McpClientContextSchema.parse({ ...clientContextFixture, rawApiKeySecret: 'leaked' }),
    ).toThrow();
  });
});

describe('MCP refusal reason schema (FR-MCP-001, FR-MCP-008, FR-MCP-009)', () => {
  it('covers all normative refusal reason codes across transport, origin, auth, rate, and policy', () => {
    const validReasons = [
      'MESSAGE_OVERSIZE',
      'ORIGIN_NOT_ALLOWLISTED',
      'ORIGIN_PUNYCODE_CONFUSED',
      'ORIGIN_TRAILING_DOT',
      'ORIGIN_MIXED_SCHEME',
      'ORIGIN_WRONG_PORT',
      'ORIGIN_MALFORMED',
      'ORIGIN_ABSENT_REFUSED',
      'REVISION_UNSUPPORTED',
      'CONTENT_TYPE_INVALID',
      'METHOD_INVALID',
      'SESSION_BINDING_INVALID',
      'SESSION_EXPIRED',
      'SESSION_TERMINATED',
      'CURSOR_UNAUTHORIZED',
      'CURSOR_EXPIRED',
      'AUTH_REQUIRED',
      'CREDENTIAL_INVALID',
      'CREDENTIAL_REVOKED',
      'CREDENTIAL_EXPIRED',
      'SCOPE_INSUFFICIENT',
      'PROFILE_MISMATCH',
      'RATE_LIMITED',
      'CONCURRENCY_LIMIT_EXCEEDED',
      'PROHIBITED_PAYLOAD',
      'RIGHTS_BLOCKED',
      'QUOTA_EXHAUSTED',
    ];

    for (const reason of validReasons) {
      expect(McpRefusalReasonSchema.parse(reason)).toBe(reason);
    }

    expect(() => McpRefusalReasonSchema.parse('UNREGISTERED_REFUSAL_REASON')).toThrow();
  });
});
