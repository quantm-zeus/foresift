/**
 * apps/api/test/config.spec.ts
 *
 * Unit tests for apps/api configuration schema (T005 / AC-251).
 * Traces: FR-MCP-001, G.13 security block, ADR-0013, ADR-0023.
 *
 * Asserts:
 * - Validates G.13 MCP security block with baseline '2025-11-25', STREAMABLE_HTTP transport,
 *   EXACT_ALLOWLIST origin policy, absent-origin policy PRODUCTION, stateful_sessions_enabled false,
 *   maximum_request_bytes 262144, maximum_response_bytes 1048576, maximum_page_records 100.
 * - Strict schema validation: fail-closed on unknown keys.
 * - Rejects invalid URLs, empty allowlists, and negative/out-of-range caps.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { McpServerConfigSchema, loadMcpServerConfig, type McpServerConfig } from '../src/config.ts';

const VALID_CONFIG_INPUT = {
  protocolBaseline: MCP_PROTOCOL_BASELINE_REVISION,
  allowedRevisions: [MCP_PROTOCOL_BASELINE_REVISION],
  transport: 'STREAMABLE_HTTP' as const,
  originPolicy: 'EXACT_ALLOWLIST' as const,
  allowedOrigins: ['https://mcp.foresift.io', 'https://claude.ai'],
  absentOriginPolicy: 'PRODUCTION' as const,
  statefulSessionsEnabled: false,
  maximumRequestBytes: 262144, // 256 KiB
  maximumResponseBytes: 1048576, // 1 MiB §29.4 cap
  maximumPageRecords: 100, // §29.4 cap
};

describe('T005: apps/api config schema (G.13 MCP security block)', () => {
  it('parses a valid G.13 security block configuration', () => {
    const config = McpServerConfigSchema.parse(VALID_CONFIG_INPUT);
    expect(config.protocolBaseline).toBe('2025-11-25');
    expect(config.transport).toBe('STREAMABLE_HTTP');
    expect(config.originPolicy).toBe('EXACT_ALLOWLIST');
    expect(config.allowedOrigins).toEqual(['https://mcp.foresift.io', 'https://claude.ai']);
    expect(config.absentOriginPolicy).toBe('PRODUCTION');
    expect(config.statefulSessionsEnabled).toBe(false);
    expect(config.maximumRequestBytes).toBe(262144);
    expect(config.maximumResponseBytes).toBe(1048576);
    expect(config.maximumPageRecords).toBe(100);
  });

  it('fails closed when unknown keys are provided (strict schema)', () => {
    const invalidWithExtra = {
      ...VALID_CONFIG_INPUT,
      unrecognizedProperty: 'malicious_override',
    };
    expect(() => McpServerConfigSchema.parse(invalidWithExtra)).toThrow();
  });

  it('rejects invalid transport or origin policy values', () => {
    expect(() =>
      McpServerConfigSchema.parse({ ...VALID_CONFIG_INPUT, transport: 'WEBSOCKET' as never }),
    ).toThrow();
    expect(() =>
      McpServerConfigSchema.parse({ ...VALID_CONFIG_INPUT, originPolicy: 'WILDCARD' as never }),
    ).toThrow();
  });

  it('rejects malformed origin URLs in allowedOrigins', () => {
    expect(() =>
      McpServerConfigSchema.parse({
        ...VALID_CONFIG_INPUT,
        allowedOrigins: ['not-a-valid-url'],
      }),
    ).toThrow();
  });

  it('rejects non-positive caps for request bytes, response bytes, and page records', () => {
    expect(() =>
      McpServerConfigSchema.parse({ ...VALID_CONFIG_INPUT, maximumRequestBytes: 0 }),
    ).toThrow();
    expect(() =>
      McpServerConfigSchema.parse({ ...VALID_CONFIG_INPUT, maximumRequestBytes: -100 }),
    ).toThrow();
    expect(() =>
      McpServerConfigSchema.parse({ ...VALID_CONFIG_INPUT, maximumResponseBytes: -1 }),
    ).toThrow();
    expect(() =>
      McpServerConfigSchema.parse({ ...VALID_CONFIG_INPUT, maximumPageRecords: 0 }),
    ).toThrow();
  });

  it('loadMcpServerConfig helper reads environment variables with safe fail-closed defaults', () => {
    const loaded = loadMcpServerConfig({
      MCP_ALLOWED_ORIGINS: 'https://mcp.foresift.io,https://claude.ai',
      MCP_MAX_REQUEST_BYTES: '262144',
    });
    expect(loaded.protocolBaseline).toBe('2025-11-25');
    expect(loaded.allowedOrigins).toContain('https://mcp.foresift.io');
    expect(loaded.statefulSessionsEnabled).toBe(false);
  });
});
