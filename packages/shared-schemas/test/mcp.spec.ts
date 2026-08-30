/**
 * Unit test suite for MCP Shared Schemas (FR-MCP-003, PRD §17.4, §17.7, AC-002).
 *
 * Validates accept/refuse matrices for:
 * - McpOutputEnvelopeSchema (structured output, pagination, prohibited payload scrub)
 * - McpOutputMetadataSchema (quality, freshness, capabilities, rights, cost, lineage, partial/abstention)
 * - McpSessionBindingSchema (actor, profile, origin, protocol revision, expiry, ASCII-safe session ID)
 * - McpCursorSchema (runId, sequenceNumber, authorized ownership)
 * - McpRefusalReasonSchema (fail-closed refusal reason passthrough)
 * - MCP_SCHEMAS registry and parseMcpSchema helper
 */
import { describe, expect, it } from 'bun:test';
import {
  MCP_SCHEMAS,
  MCP_SCHEMA_REGISTRY_VERSION,
  McpCursorSchema,
  McpOutputEnvelopeSchema,
  McpOutputMetadataSchema,
  McpRefusalReasonSchema,
  McpSessionBindingSchema,
  parseMcpSchema,
  type McpSchemaName,
} from '../src/mcp.ts';
import {
  CURSOR_DISCOVERY_PAGE_1,
  CURSOR_DISCOVERY_PAGE_2,
  CURSOR_UNAUTHORIZED_FOREIGN,
  SESSION_DISCOVERY_STATELESS,
  SESSION_RESEARCH_STATEFUL,
} from '../../../tests/fixtures/mcp/index.ts';

const at = (s: string) => s;

const validMetadata = {
  toolName: 'discover_candidates',
  toolVersion: '1.0.0',
  provider: 'first-party-dex-observer',
  operation: 'discover_candidates',
  evidenceIds: ['ev-disc-001', 'ev-disc-002'],
  observedAt: at('2026-08-01T00:00:00Z'),
  availableAt: at('2026-08-01T00:01:00Z'),
  fetchedAt: at('2026-08-01T00:01:05Z'),
  cache: 'HIT_FRESH',
  freshnessSeconds: 30,
  qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
  conflicts: [],
  quota: {
    quotaModel: 'REQUESTS_PER_PERIOD',
    reservationState: 'COMMITTED',
    estimatedUnits: 1,
    actualUnits: 1,
  },
  cost: {
    estimatedCostUnits: 1,
    actualCostUnits: 1,
    currency: 'CREDITS',
  },
  rightsPolicyId: 'rights-verified-only',
  sourceDependence: ['solana-dex-stream'],
  partial: false,
};

const validOutputEnvelope = {
  data: {
    candidates: [
      {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Wrapped SOL',
        firstSeenAt: at('2026-08-01T00:00:00Z'),
      },
    ],
  },
  text: 'Discovered 1 candidate token on Solana with complete provenance.',
  resourceLinks: ['evidence://ev-disc-001', 'evidence://ev-disc-002'],
  nextCursor: 'cur_disc_run001_seq010',
  meta: validMetadata,
};

const validSessionBinding = {
  sessionId: 'sess_disc_0123456789abcdef01234567',
  actor: 'actor_discovery_01@foresift.internal',
  profileId: 'discovery',
  origin: 'https://mcp.foresift.internal',
  protocolRevision: '2025-11-25',
  stateful: false,
  createdAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-08-01T01:00:00Z'),
};

const validCursor = {
  cursor: 'cur_disc_run001_seq010',
  runId: 'run_disc_001',
  sequenceNumber: 10,
  actor: 'actor_discovery_01@foresift.internal',
  sessionId: 'sess_disc_0123456789abcdef01234567',
  authorized: true,
  createdAt: at('2026-08-01T00:00:10Z'),
  expiresAt: at('2026-08-01T01:00:00Z'),
};

const validRefusal = {
  stage: 'ORIGIN_VERIFICATION',
  code: 'ORIGIN_REFUSED',
  reason: 'PUNYCODE_CONFUSED',
  message: 'Punycode internationalized domain rejected by origin policy',
  details: { origin: 'https://xn--mcp-9o0a.foresift.internal' },
  occurredAt: at('2026-08-01T00:00:00Z'),
};

describe('MCP Shared Schemas Registry (FR-MCP-003, ADR-0013)', () => {
  it('exposes a positive integer registry version', () => {
    expect(MCP_SCHEMA_REGISTRY_VERSION).toBeGreaterThan(0);
  });

  it('registers all required MCP schemas in the registry map', () => {
    const requiredSchemas: McpSchemaName[] = [
      'McpOutputEnvelope',
      'McpOutputMetadata',
      'McpSessionBinding',
      'McpCursor',
      'McpRefusalReason',
    ];
    for (const schemaName of requiredSchemas) {
      expect(MCP_SCHEMAS[schemaName]).toBeDefined();
    }
  });

  it('parseMcpSchema helper parses each schema by name', () => {
    expect(parseMcpSchema('McpOutputEnvelope', validOutputEnvelope)).toBeDefined();
    expect(parseMcpSchema('McpOutputMetadata', validMetadata)).toBeDefined();
    expect(parseMcpSchema('McpSessionBinding', validSessionBinding)).toBeDefined();
    expect(parseMcpSchema('McpCursor', validCursor)).toBeDefined();
    expect(parseMcpSchema('McpRefusalReason', validRefusal)).toBeDefined();
  });
});

describe('McpOutputEnvelopeSchema (§17.4)', () => {
  it('accepts valid structured output envelopes with full metadata and links', () => {
    const parsed = McpOutputEnvelopeSchema.parse(validOutputEnvelope);
    expect(parsed.data).toBeDefined();
    expect(parsed.resourceLinks).toHaveLength(2);
    expect(parsed.nextCursor).toBe('cur_disc_run001_seq010');
    expect(parsed.meta.toolName).toBe('discover_candidates');
  });

  it('refuses unknown keys fail-closed (.strict())', () => {
    const tampered = { ...validOutputEnvelope, unexpectedExtraKey: 'leak' };
    expect(() => McpOutputEnvelopeSchema.parse(tampered)).toThrow();
  });

  it('refuses envelopes carrying prohibited financial instruction keys in data', () => {
    const prohibitedDataEnvelopes = [
      {
        ...validOutputEnvelope,
        data: { swapTransactionPayload: '0x1234' },
      },
      {
        ...validOutputEnvelope,
        data: { privateKey: 'secret_key_bytes' },
      },
      {
        ...validOutputEnvelope,
        data: { seedPhrase: 'twelve word mnemonic phrase' },
      },
      {
        ...validOutputEnvelope,
        data: { signatureRequest: { message: 'sign this' } },
      },
    ];

    for (const envelope of prohibitedDataEnvelopes) {
      expect(() => McpOutputEnvelopeSchema.parse(envelope)).toThrow(/prohibited|financial|key/i);
    }
  });
});

describe('McpOutputMetadataSchema (§17.4)', () => {
  it('accepts complete metadata records', () => {
    const parsed = McpOutputMetadataSchema.parse(validMetadata);
    expect(parsed.qualityCodes).toContain('QUALITY_HIGH');
    expect(parsed.partial).toBe(false);
    expect(parsed.freshnessSeconds).toBe(30);
  });

  it('accepts degraded/partial metadata with explicit quality codes', () => {
    const degradedMetadata = {
      ...validMetadata,
      partial: true,
      qualityCodes: ['QUALITY_PARTIAL', 'SOURCE_DEGRADED_UNAVAILABLE'],
      missingCapabilities: ['dex_volume_stream'],
    };
    const parsed = McpOutputMetadataSchema.parse(degradedMetadata);
    expect(parsed.partial).toBe(true);
    expect(parsed.qualityCodes).toContain('SOURCE_DEGRADED_UNAVAILABLE');
  });

  it('refuses silent gaps: partial true with empty qualityCodes', () => {
    const silentGapMetadata = {
      ...validMetadata,
      partial: true,
      qualityCodes: [],
    };
    expect(() => McpOutputMetadataSchema.parse(silentGapMetadata)).toThrow(/quality/i);
  });

  it('accepts explicit abstention metadata states', () => {
    const abstentionMetadata = {
      ...validMetadata,
      partial: true,
      qualityCodes: ['ABSTENTION_INSUFFICIENT_DATA'],
      abstentionReason: 'INSUFFICIENT_OBSERVATION_WINDOW',
    };
    const parsed = McpOutputMetadataSchema.parse(abstentionMetadata);
    expect(parsed.abstentionReason).toBe('INSUFFICIENT_OBSERVATION_WINDOW');
  });

  it('refuses unknown keys fail-closed (.strict())', () => {
    const extraKeyMetadata = { ...validMetadata, foreignTrackingKey: 'tracker' };
    expect(() => McpOutputMetadataSchema.parse(extraKeyMetadata)).toThrow();
  });
});

describe('McpSessionBindingSchema (§17.7)', () => {
  it('accepts valid stateless and stateful session records', () => {
    expect(McpSessionBindingSchema.parse(SESSION_DISCOVERY_STATELESS)).toBeDefined();
    expect(McpSessionBindingSchema.parse(SESSION_RESEARCH_STATEFUL)).toBeDefined();
  });

  it('refuses session IDs containing non-printable or secret-encoding characters', () => {
    const invalidSessionIds = [
      { ...validSessionBinding, sessionId: '' },
      { ...validSessionBinding, sessionId: 'sess\x00nullbyte' },
      { ...validSessionBinding, sessionId: 'sess with spaces' },
      { ...validSessionBinding, sessionId: 'sess_secret_password_encoded_123456789' },
    ];
    for (const invalid of invalidSessionIds) {
      expect(() => McpSessionBindingSchema.parse(invalid)).toThrow();
    }
  });

  it('refuses missing actor, missing profile, or malformed origin', () => {
    expect(() => McpSessionBindingSchema.parse({ ...validSessionBinding, actor: '' })).toThrow();
    expect(() => McpSessionBindingSchema.parse({ ...validSessionBinding, profileId: '' })).toThrow();
    expect(() => McpSessionBindingSchema.parse({ ...validSessionBinding, origin: 'not-an-origin' })).toThrow();
  });

  it('refuses unknown keys fail-closed (.strict())', () => {
    expect(() =>
      McpSessionBindingSchema.parse({ ...validSessionBinding, unvettedFlag: true }),
    ).toThrow();
  });
});

describe('McpCursorSchema (§17.4, §17.7)', () => {
  it('accepts valid resumable cursor fixtures', () => {
    expect(McpCursorSchema.parse(CURSOR_DISCOVERY_PAGE_1)).toBeDefined();
    expect(McpCursorSchema.parse(CURSOR_DISCOVERY_PAGE_2)).toBeDefined();
    expect(McpCursorSchema.parse(CURSOR_UNAUTHORIZED_FOREIGN)).toBeDefined();
  });

  it('refuses negative sequence numbers or empty runIds', () => {
    expect(() => McpCursorSchema.parse({ ...validCursor, sequenceNumber: -1 })).toThrow();
    expect(() => McpCursorSchema.parse({ ...validCursor, runId: '' })).toThrow();
  });

  it('refuses unknown keys fail-closed (.strict())', () => {
    expect(() => McpCursorSchema.parse({ ...validCursor, extraParam: 123 })).toThrow();
  });
});

describe('McpRefusalReasonSchema (ADR-0022)', () => {
  it('accepts valid typed refusal payloads across admission stages', () => {
    const validRefusals = [
      validRefusal,
      {
        stage: 'PROTOCOL_GUARD',
        code: 'PROTOCOL_REFUSED',
        reason: 'REVISION_UNSUPPORTED',
        message: 'Unsupported MCP protocol revision',
        occurredAt: at('2026-08-01T00:00:00Z'),
      },
      {
        stage: 'RATE_ADMISSION',
        code: 'RATE_LIMITED',
        reason: 'TOKEN_BUCKET_EXHAUSTED',
        message: 'Per-client token bucket capacity exceeded',
        details: { retryAfterSeconds: 30 },
        occurredAt: at('2026-08-01T00:00:00Z'),
      },
    ];

    for (const refusal of validRefusals) {
      expect(McpRefusalReasonSchema.parse(refusal)).toBeDefined();
    }
  });

  it('refuses unknown keys fail-closed (.strict())', () => {
    expect(() => McpRefusalReasonSchema.parse({ ...validRefusal, arbitraryPayload: 'bad' })).toThrow();
  });
});
