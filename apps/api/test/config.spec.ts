/**
 * T005: MCP Security Configuration schema suite (FR-MCP-001, AC-251).
 * Tests apps/api/src/config.ts against G.13 MCP security block requirements.
 */
import { describe, expect, it } from 'bun:test';
import {
  MAXIMUM_PAGE_RECORDS,
  MAXIMUM_REQUEST_BYTES,
  MAXIMUM_RESPONSE_BYTES,
} from '../../../tests/fixtures/mcp/index.ts';

// Dynamic import from product path; will fail NEW_BEHAVIOR_RED until implemented.
async function loadConfigModule() {
  return await import('../src/config.ts');
}

describe('T005: MCP server config (G.13 security block, AC-251)', () => {
  const validConfig = {
    protocolBaseline: '2025-11-25',
    allowedRevisions: ['2025-11-25'],
    transport: 'STREAMABLE_HTTP' as const,
    originPolicy: 'EXACT_ALLOWLIST' as const,
    allowedOrigins: ['https://mcp.example.com', 'https://app.foresift.io'],
    absentOriginPolicy: 'PRODUCTION' as const,
    statefulSessionsEnabled: false,
    maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
    maximumResponseBytes: MAXIMUM_RESPONSE_BYTES,
    maximumPageRecords: MAXIMUM_PAGE_RECORDS,
  };

  it('validates canonical G.13 MCP configuration successfully', async () => {
    const { McpServerConfigSchema, validateMcpConfig } = await loadConfigModule();
    const parsed = McpServerConfigSchema.parse(validConfig);
    expect(parsed.protocolBaseline).toBe('2025-11-25');
    expect(parsed.transport).toBe('STREAMABLE_HTTP');
    expect(parsed.statefulSessionsEnabled).toBe(false);
    expect(parsed.maximumRequestBytes).toBe(262144);
    expect(parsed.maximumResponseBytes).toBe(1048576);
    expect(parsed.maximumPageRecords).toBe(100);

    if (validateMcpConfig) {
      expect(validateMcpConfig(validConfig)).toEqual(parsed);
    }
  });

  it('fails closed on unknown keys (.strict() schema per ADR-0013)', async () => {
    const { McpServerConfigSchema } = await loadConfigModule();
    const withExtraKey = {
      ...validConfig,
      unknownSecurityBypass: true,
    };
    const result = McpServerConfigSchema.safeParse(withExtraKey);
    expect(result.success).toBe(false);
  });

  it('refuses invalid protocol baseline or unvetted revisions', async () => {
    const { McpServerConfigSchema } = await loadConfigModule();
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, protocolBaseline: '2024-01-01' }).success,
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, allowedRevisions: ['draft-unknown'] })
        .success,
    ).toBe(false);
  });

  it('refuses non-streamable transports and non-allowlist origin policies', async () => {
    const { McpServerConfigSchema } = await loadConfigModule();
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, transport: 'WEBSOCKET_RAW' }).success,
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, originPolicy: 'ALLOW_ALL' }).success,
    ).toBe(false);
  });

  it('refuses request byte cap exceeding 256 KiB or non-positive caps', async () => {
    const { McpServerConfigSchema } = await loadConfigModule();
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, maximumRequestBytes: 524288 }).success,
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, maximumRequestBytes: 0 }).success,
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, maximumResponseBytes: -100 }).success,
    ).toBe(false);
    expect(McpServerConfigSchema.safeParse({ ...validConfig, maximumPageRecords: 0 }).success).toBe(
      false,
    );
  });

  it('enforces absentOriginPolicy to be either PRODUCTION or NON_PRODUCTION', async () => {
    const { McpServerConfigSchema } = await loadConfigModule();
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, absentOriginPolicy: 'PERMISSIVE' }).success,
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({ ...validConfig, absentOriginPolicy: 'NON_PRODUCTION' })
        .success,
    ).toBe(true);
  });
});
