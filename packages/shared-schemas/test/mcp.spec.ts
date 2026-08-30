/**
 * Accept/refuse matrices for the MCP shared-schemas family (FR-MCP-003, FR-MCP-009; AC-002, AC-251).
 * Every `.strict()` object must refuse unknown keys;
 * output envelopes validate §17.4 requirements (structured + human content, evidence links, metadata,
 * pagination, explicit abstentions, prohibited payload scrub);
 * session bindings validate §17.7 (actor/profile/origin/revision/expiry);
 * cursors validate resumable ownership; refusal reasons pass through deterministically.
 */
import { describe, expect, it } from 'bun:test';
// prettier-ignore
// @ts-expect-error TS2307: module under implementation in T002
import { McpAdmissionRefusalSchema, McpCursorSchema, McpOutputEnvelopeSchema, McpOutputMetaSchema, McpRefusalReasonSchema, McpSessionBindingSchema, MCP_SCHEMAS, parseMcpSchema, type McpSchemaName } from '../src/mcp.ts';

const at = (s: string) => s;

const validOutputMeta = {
  toolName: 'discover_candidates',
  toolVersion: '1.0.0',
  qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
  freshnessSeconds: 30,
  observedAt: at('2026-08-01T00:00:00Z'),
  availableAt: at('2026-08-01T00:01:00Z'),
  fetchedAt: at('2026-08-01T00:01:05Z'),
  rightsPolicy: 'rights-verified-only',
  cost: {
    estimatedUnits: 1,
    actualUnits: 1,
    model: 'REQUESTS_PER_PERIOD',
  },
  sourceDependence: ['first-party-dex-observer'],
  partial: false,
  abstention: false,
  abstentionReason: null,
};

const validOutputEnvelope = {
  outputSchema: {
    type: 'object',
    properties: {
      candidates: { type: 'array' },
    },
  },
  structuredContent: {
    candidates: [
      {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
      },
    ],
  },
  humanContent: 'Found 1 candidate token matching criteria.',
  resourceLinks: ['evidence://ev-discovery-001', 'run://run-ac001-001'],
  cursor: null,
  nextCursor: 'cur_next_00001',
  hasMore: true,
  meta: validOutputMeta,
};

const validSessionBinding = {
  sessionId: 'sess_mcp_01h7x8k2v4m9n3p5q6r8s9t0u1',
  actor: 'actor-discovery@example.com',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  createdAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-08-01T01:00:00Z'),
  terminatedAt: null,
};

const validCursor = {
  cursor: 'cur_res_01h7x8k2v4m9n3p5q6r8s9t0u1_seq_42',
  sessionId: 'sess_mcp_01h7x8k2v4m9n3p5q6r8s9t0u1',
  sequence: 42,
  issuedAt: at('2026-08-01T00:00:00Z'),
  expiresAt: at('2026-08-01T01:00:00Z'),
  authorized: true,
};

const validRefusal = {
  refusalCode: 'ORIGIN_REFUSED',
  stage: 'ORIGIN_GATE',
  detail: 'Origin not present on exact allowlist',
  occurredAt: at('2026-08-01T00:00:00Z'),
};

describe('MCP schema family — registry & entrypoints', () => {
  it('exposes every declared MCP schema by name', () => {
    const names = Object.keys(MCP_SCHEMAS);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names).toContain('McpOutputEnvelope');
    expect(names).toContain('McpOutputMeta');
    expect(names).toContain('McpSessionBinding');
    expect(names).toContain('McpCursor');
    expect(names).toContain('McpAdmissionRefusal');
  });

  for (const name of Object.keys(MCP_SCHEMAS) as McpSchemaName[]) {
    it(`parseMcpSchema(${name}) is wired to its schema (refuses garbage)`, () => {
      expect(() => parseMcpSchema(name, { obviously: 'wrong_payload_structure' })).toThrow();
    });
  }
});

describe('McpOutputEnvelopeSchema (§17.4 output contract)', () => {
  it('accepts a fully-conforming output envelope and round-trips byte-stable', () => {
    const parsed = McpOutputEnvelopeSchema.parse(validOutputEnvelope);
    expect(parsed.humanContent).toBe('Found 1 candidate token matching criteria.');
    expect(parsed.resourceLinks).toHaveLength(2);
    expect(parsed.meta.partial).toBe(false);
    expect(parsed.meta.abstention).toBe(false);
    expect(McpOutputEnvelopeSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('accepts an explicit abstention envelope with reason', () => {
    const abstentionEnvelope = {
      ...validOutputEnvelope,
      structuredContent: { candidates: [] },
      humanContent: 'Insufficient observations to evaluate opportunity frontier.',
      meta: {
        ...validOutputMeta,
        partial: true,
        abstention: true,
        abstentionReason: 'INSUFFICIENT_OBSERVATIONS_AT_BOUNDARY',
        qualityCodes: ['QUALITY_PARTIAL', 'SOURCE_DEGRADED_UNAVAILABLE'],
      },
    };
    const parsed = McpOutputEnvelopeSchema.parse(abstentionEnvelope);
    expect(parsed.meta.abstention).toBe(true);
    expect(parsed.meta.abstentionReason).toBe('INSUFFICIENT_OBSERVATIONS_AT_BOUNDARY');
  });

  it('refuses unknown keys on output envelope (.strict())', () => {
    expect(() =>
      McpOutputEnvelopeSchema.parse({
        ...validOutputEnvelope,
        extraUnexpectedKey: 'not_allowed',
      }),
    ).toThrow();
  });

  it('refuses missing mandated §17.4 fields', () => {
    for (const key of [
      'outputSchema',
      'structuredContent',
      'humanContent',
      'resourceLinks',
      'meta',
    ] as const) {
      const broken: Record<string, unknown> = { ...validOutputEnvelope };
      delete broken[key];
      expect(() => McpOutputEnvelopeSchema.parse(broken)).toThrow();
    }
  });

  it('refuses empty humanContent or invalid resourceLink URI schemes', () => {
    expect(() =>
      McpOutputEnvelopeSchema.parse({
        ...validOutputEnvelope,
        humanContent: '',
      }),
    ).toThrow();

    expect(() =>
      McpOutputEnvelopeSchema.parse({
        ...validOutputEnvelope,
        resourceLinks: ['invalid-uri-scheme://evidence-1'],
      }),
    ).toThrow();
  });
});

describe('McpOutputMetaSchema (§17.4 metadata dimensions)', () => {
  it('accepts valid metadata with complete dimensions', () => {
    const parsed = McpOutputMetaSchema.parse(validOutputMeta);
    expect(parsed.toolName).toBe('discover_candidates');
    expect(parsed.freshnessSeconds).toBe(30);
    expect(parsed.cost.model).toBe('REQUESTS_PER_PERIOD');
  });

  it('refuses negative freshness seconds or invalid ISO timestamps', () => {
    expect(() =>
      McpOutputMetaSchema.parse({
        ...validOutputMeta,
        freshnessSeconds: -1,
      }),
    ).toThrow();

    expect(() =>
      McpOutputMetaSchema.parse({
        ...validOutputMeta,
        observedAt: 'not-a-timestamp',
      }),
    ).toThrow();
  });
});

describe('McpSessionBindingSchema (§17.7 session security)', () => {
  it('accepts a valid cryptographically-random visible-ASCII session binding', () => {
    const parsed = McpSessionBindingSchema.parse(validSessionBinding);
    expect(parsed.sessionId).toBe('sess_mcp_01h7x8k2v4m9n3p5q6r8s9t0u1');
    expect(parsed.protocolRevision).toBe('2025-11-25');
  });

  it('refuses malformed session IDs (spaces, control characters, empty)', () => {
    expect(() =>
      McpSessionBindingSchema.parse({
        ...validSessionBinding,
        sessionId: '',
      }),
    ).toThrow();

    expect(() =>
      McpSessionBindingSchema.parse({
        ...validSessionBinding,
        sessionId: 'session id with spaces',
      }),
    ).toThrow();

    expect(() =>
      McpSessionBindingSchema.parse({
        ...validSessionBinding,
        sessionId: 'session\x00null',
      }),
    ).toThrow();
  });

  it('refuses invalid origins or missing actors', () => {
    expect(() =>
      McpSessionBindingSchema.parse({
        ...validSessionBinding,
        actor: '',
      }),
    ).toThrow();

    expect(() =>
      McpSessionBindingSchema.parse({
        ...validSessionBinding,
        origin: 'not-an-origin',
      }),
    ).toThrow();
  });
});

describe('McpCursorSchema (resumable streams)', () => {
  it('accepts authorized resumable cursor', () => {
    const parsed = McpCursorSchema.parse(validCursor);
    expect(parsed.authorized).toBe(true);
    expect(parsed.sequence).toBe(42);
  });

  it('refuses negative sequence numbers or empty cursor strings', () => {
    expect(() =>
      McpCursorSchema.parse({
        ...validCursor,
        sequence: -1,
      }),
    ).toThrow();

    expect(() =>
      McpCursorSchema.parse({
        ...validCursor,
        cursor: '',
      }),
    ).toThrow();
  });
});

describe('McpRefusalReasonSchema & McpAdmissionRefusalSchema', () => {
  it('accepts the typed deterministic refusal reasons', () => {
    const reasons = [
      'ORIGIN_REFUSED',
      'PROTOCOL_REFUSED',
      'AUTH_REFUSED',
      'SESSION_INVALID',
      'RATE_LIMITED',
      'CONCURRENCY_EXCEEDED',
      'PROHIBITED_PAYLOAD',
      'FORBIDDEN_OPERATION',
      'RESOURCE_UNAUTHORIZED',
      'MESSAGE_OVERSIZE',
    ] as const;

    for (const r of reasons) {
      expect(McpRefusalReasonSchema.parse(r)).toBe(r);
    }
  });

  it('refuses untyped / arbitrary refusal reasons', () => {
    expect(() => McpRefusalReasonSchema.parse('ARBITRARY_UNTRACKED_ERROR')).toThrow();
  });

  it('accepts complete admission refusal record', () => {
    const parsed = McpAdmissionRefusalSchema.parse(validRefusal);
    expect(parsed.refusalCode).toBe('ORIGIN_REFUSED');
    expect(parsed.stage).toBe('ORIGIN_GATE');
  });
});
