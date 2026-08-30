/**
 * Accept/refuse matrices for the MCP schema family (FR-MCP-001…010, §17.4, §17.7, §29.4).
 * Every `.strict()` schema must refuse unknown keys fail-closed (ADR-0013).
 */
import { describe, expect, it } from 'bun:test';
// @ts-ignore TS2307: pending implementation in T002
import {
  McpConfigSchema,
  McpCursorSchema,
  McpOutputEnvelopeSchema,
  McpOutputMetaSchema,
  McpRateStateRecordSchema,
  McpRefusalReasonSchema,
  McpSessionBindingSchema,
  McpSessionRecordSchema,
  MCP_SCHEMAS,
  parseMcpSchema,
  type McpSchemaName,
// @ts-ignore TS2307
} from '../src/mcp.ts';
import {
  ACTIVE_SESSION_FIXTURE,
  EXPIRED_SESSION_FIXTURE,
  TERMINATED_SESSION_FIXTURE,
  VALID_AUTHORIZED_CURSOR,
  VALID_MCP_OUTPUT_ENVELOPE,
  DEGRADED_MCP_OUTPUT_ENVELOPE,
  MAXIMUM_REQUEST_BYTES,
  MAXIMUM_RESPONSE_BYTES,
  MAXIMUM_PAGE_RECORDS,
} from '../../../tests/fixtures/mcp/index.ts';

const at = (s: string) => s;

describe('MCP shared schemas (FR-MCP-001…010, ADR-0013)', () => {
  describe('McpSessionBindingSchema (§17.7)', () => {
    const validBinding = {
      actor: 'analyst@foresift.io',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      expiresAt: at('2028-01-01T00:00:00Z'),
    };

    it('accepts valid session binding payload', () => {
      expect(McpSessionBindingSchema.safeParse(validBinding).success).toBe(true);
    });

    it('refuses missing required fields', () => {
      expect(McpSessionBindingSchema.safeParse({ ...validBinding, actor: undefined }).success).toBe(
        false,
      );
      expect(
        McpSessionBindingSchema.safeParse({ ...validBinding, profileId: undefined }).success,
      ).toBe(false);
      expect(McpSessionBindingSchema.safeParse({ ...validBinding, origin: undefined }).success).toBe(
        false,
      );
      expect(
        McpSessionBindingSchema.safeParse({ ...validBinding, protocolRevision: undefined }).success,
      ).toBe(false);
    });

    it('refuses unknown keys fail-closed (.strict())', () => {
      expect(McpSessionBindingSchema.safeParse({ ...validBinding, extraKey: 'fail' }).success).toBe(
        false,
      );
    });
  });

  describe('McpSessionRecordSchema (§17.7, INV-009)', () => {
    it('accepts active, expired, and terminated session records', () => {
      expect(McpSessionRecordSchema.safeParse(ACTIVE_SESSION_FIXTURE).success).toBe(true);
      expect(McpSessionRecordSchema.safeParse(EXPIRED_SESSION_FIXTURE).success).toBe(true);
      expect(McpSessionRecordSchema.safeParse(TERMINATED_SESSION_FIXTURE).success).toBe(true);
    });

    it('refuses unknown keys fail-closed', () => {
      const tampered = { ...ACTIVE_SESSION_FIXTURE, injected: 'attack' };
      expect(McpSessionRecordSchema.safeParse(tampered).success).toBe(false);
    });
  });

  describe('McpCursorSchema (§17.4, FR-MCP-003)', () => {
    it('accepts valid pagination / stream cursor descriptor', () => {
      expect(McpCursorSchema.safeParse(VALID_AUTHORIZED_CURSOR).success).toBe(true);
    });

    it('refuses negative offset or invalid page size', () => {
      expect(McpCursorSchema.safeParse({ ...VALID_AUTHORIZED_CURSOR, offset: -1 }).success).toBe(
        false,
      );
      expect(McpCursorSchema.safeParse({ ...VALID_AUTHORIZED_CURSOR, pageSize: 0 }).success).toBe(
        false,
      );
    });

    it('refuses unknown keys fail-closed', () => {
      expect(
        McpCursorSchema.safeParse({ ...VALID_AUTHORIZED_CURSOR, unauthorizedPayload: true }).success,
      ).toBe(false);
    });
  });

  describe('McpRefusalReasonSchema (§17.2, §17.4, INV-037)', () => {
    const validRefusalReasons = [
      'ORIGIN_NOT_ALLOWLISTED',
      'REVISION_UNSUPPORTED',
      'CONTENT_TYPE_INVALID',
      'METHOD_INVALID',
      'MESSAGE_OVERSIZE',
      'SESSION_BINDING_INVALID',
      'CURSOR_UNAUTHORIZED',
      'CREDENTIAL_REVOKED',
      'CREDENTIAL_EXPIRED',
      'CREDENTIAL_INVALID',
      'RATE_LIMIT_EXCEEDED',
      'CONCURRENCY_LIMIT_EXCEEDED',
      'PROHIBITED_PAYLOAD_DETECTED',
      'RESOURCE_UNAUTHORIZED',
      'RESOURCE_NOT_FOUND',
      'TOOL_NOT_IN_PROFILE',
    ];

    it('accepts all canonical refusal codes', () => {
      for (const reason of validRefusalReasons) {
        expect(McpRefusalReasonSchema.safeParse(reason).success).toBe(true);
      }
    });

    it('refuses unregistered / arbitrary refusal codes', () => {
      expect(McpRefusalReasonSchema.safeParse('UNKNOWN_RANDOM_REASON').success).toBe(false);
      expect(McpRefusalReasonSchema.safeParse('INTERNAL_CRASH').success).toBe(false);
    });
  });

  describe('McpOutputMetaSchema (§17.4)', () => {
    it('accepts full metadata matching §17.4 contract', () => {
      expect(McpOutputMetaSchema.safeParse(VALID_MCP_OUTPUT_ENVELOPE.meta).success).toBe(true);
      expect(McpOutputMetaSchema.safeParse(DEGRADED_MCP_OUTPUT_ENVELOPE.meta).success).toBe(true);
    });

    it('refuses unknown keys fail-closed', () => {
      const tampered = { ...VALID_MCP_OUTPUT_ENVELOPE.meta, secretToken: 'leak' };
      expect(McpOutputMetaSchema.safeParse(tampered).success).toBe(false);
    });
  });

  describe('McpOutputEnvelopeSchema (§17.4, FR-MCP-003)', () => {
    it('accepts valid structured output envelopes', () => {
      expect(McpOutputEnvelopeSchema.safeParse(VALID_MCP_OUTPUT_ENVELOPE).success).toBe(true);
      expect(McpOutputEnvelopeSchema.safeParse(DEGRADED_MCP_OUTPUT_ENVELOPE).success).toBe(true);
    });

    it('refuses envelopes missing meta or textContent', () => {
      expect(
        McpOutputEnvelopeSchema.safeParse({
          structuredContent: { a: 1 },
        }).success,
      ).toBe(false);
      expect(
        McpOutputEnvelopeSchema.safeParse({
          textContent: 'hello',
        }).success,
      ).toBe(false);
    });

    it('refuses unknown keys fail-closed', () => {
      expect(
        McpOutputEnvelopeSchema.safeParse({
          ...VALID_MCP_OUTPUT_ENVELOPE,
          extraField: 'prohibited',
        }).success,
      ).toBe(false);
    });
  });

  describe('McpRateStateRecordSchema (FR-MCP-009, INV-009)', () => {
    const validRateState = {
      credentialId: 'cred_disc_0001_standard',
      rateClass: 'STANDARD_FREE',
      tokensRemaining: 100,
      inFlightCount: 1,
      windowStartedAt: at('2026-08-01T00:00:00Z'),
      updatedAt: at('2026-08-01T00:00:05Z'),
    };

    it('accepts valid rate state record', () => {
      expect(McpRateStateRecordSchema.safeParse(validRateState).success).toBe(true);
    });

    it('refuses negative tokens or in-flight counts', () => {
      expect(
        McpRateStateRecordSchema.safeParse({ ...validRateState, tokensRemaining: -5 }).success,
      ).toBe(false);
      expect(
        McpRateStateRecordSchema.safeParse({ ...validRateState, inFlightCount: -1 }).success,
      ).toBe(false);
    });

    it('refuses unknown keys fail-closed', () => {
      expect(McpRateStateRecordSchema.safeParse({ ...validRateState, bypass: true }).success).toBe(
        false,
      );
    });
  });

  describe('McpConfigSchema (G.13 MCP security block)', () => {
    const validConfig = {
      protocolBaseline: '2025-11-25',
      allowedRevisions: ['2025-11-25'],
      transport: 'STREAMABLE_HTTP',
      originPolicy: 'EXACT_ALLOWLIST',
      allowedOrigins: ['https://mcp.example.com', 'https://app.foresift.io'],
      absentOriginPolicy: 'PRODUCTION',
      statefulSessionsEnabled: false,
      maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
      maximumResponseBytes: MAXIMUM_RESPONSE_BYTES,
      maximumPageRecords: MAXIMUM_PAGE_RECORDS,
    };

    it('accepts valid G.13 MCP security configuration', () => {
      expect(McpConfigSchema.safeParse(validConfig).success).toBe(true);
    });

    it('refuses unknown keys fail-closed', () => {
      expect(McpConfigSchema.safeParse({ ...validConfig, unknownKey: true }).success).toBe(false);
    });
  });

  describe('MCP_SCHEMAS registry map and parseMcpSchema helper', () => {
    it('exposes all MCP schema keys in registry', () => {
      const expectedKeys: McpSchemaName[] = [
        'McpSessionBinding',
        'McpSessionRecord',
        'McpCursor',
        'McpRefusalReason',
        'McpOutputMeta',
        'McpOutputEnvelope',
        'McpRateStateRecord',
        'McpConfig',
      ];
      for (const key of expectedKeys) {
        expect(MCP_SCHEMAS[key]).toBeDefined();
      }
    });

    it('parseMcpSchema parses valid inputs and throws on invalid inputs', () => {
      const parsed = parseMcpSchema('McpOutputEnvelope', VALID_MCP_OUTPUT_ENVELOPE);
      expect(parsed.meta.toolName).toBe('discover_candidates');
      expect(() => parseMcpSchema('McpOutputEnvelope', { bad: true })).toThrow();
    });
  });
});
