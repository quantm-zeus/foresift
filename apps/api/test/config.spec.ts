/**
 * Unit test suite for MCP server configuration schema (T005).
 * Traces: FR-MCP-001, AC-251, PRD G.13, ADR-0013.
 *
 * Asserts:
 * - Valid G.13 configuration parses cleanly with exact defaults.
 * - Protocol baseline revision 2025-11-25 is enforced.
 * - Transport is STREAMABLE_HTTP.
 * - Origin mode is EXACT_ALLOWLIST.
 * - Absent origin policy rejects absent in PRODUCTION, admits in NON_PRODUCTION.
 * - Stateful sessions default to false.
 * - Caps: maximum_request_bytes = 262144 (256 KiB), maximum_response_bytes = 1048576 (1 MiB), maximum_page_records = 100.
 * - Fail-closed on unknown configuration keys (.strict()).
 */
import { describe, expect, it } from 'bun:test';
import {
  McpServerConfigSchema,
  parseMcpConfig,
  type McpServerConfig,
} from '../src/config.ts';

const VALID_CONFIG: McpServerConfig = {
  protocolRevision: '2025-11-25',
  transport: 'STREAMABLE_HTTP',
  originMode: 'EXACT_ALLOWLIST',
  originAllowlist: ['https://mcp.example.com', 'https://app.foresift.internal:8443'],
  absentOriginPolicy: 'PRODUCTION',
  allowAbsentOriginForRegisteredNonBrowserClients: true,
  statefulSessionsEnabled: false,
  maximumRequestBytes: 262144,
  maximumResponseBytes: 1048576,
  maximumPageRecords: 100,
};

describe('T005 — MCP server configuration schema (AC-251)', () => {
  it('parses a valid complete G.13 configuration', () => {
    const parsed = parseMcpConfig(VALID_CONFIG);
    expect(parsed.protocolRevision).toBe('2025-11-25');
    expect(parsed.transport).toBe('STREAMABLE_HTTP');
    expect(parsed.originMode).toBe('EXACT_ALLOWLIST');
    expect(parsed.originAllowlist).toEqual([
      'https://mcp.example.com',
      'https://app.foresift.internal:8443',
    ]);
    expect(parsed.absentOriginPolicy).toBe('PRODUCTION');
    expect(parsed.allowAbsentOriginForRegisteredNonBrowserClients).toBe(true);
    expect(parsed.statefulSessionsEnabled).toBe(false);
    expect(parsed.maximumRequestBytes).toBe(262144);
    expect(parsed.maximumResponseBytes).toBe(1048576);
    expect(parsed.maximumPageRecords).toBe(100);
  });

  it('fails closed on unknown keys in the configuration object', () => {
    const configWithUnknown = {
      ...VALID_CONFIG,
      unrecognizedSecurityOption: true,
      legacyPort: 8080,
    };
    expect(() => parseMcpConfig(configWithUnknown)).toThrow();
  });

  it('rejects unsupported protocol revisions', () => {
    const invalidRevision = {
      ...VALID_CONFIG,
      protocolRevision: '2024-01-01',
    };
    expect(() => parseMcpConfig(invalidRevision)).toThrow();
  });

  it('rejects non-STREAMABLE_HTTP transport modes', () => {
    const invalidTransport = {
      ...VALID_CONFIG,
      transport: 'WEBSOCKET',
    };
    expect(() => parseMcpConfig(invalidTransport)).toThrow();
  });

  it('rejects invalid absent origin policy', () => {
    const invalidPolicy = {
      ...VALID_CONFIG,
      absentOriginPolicy: 'PERMISSIVE',
    };
    expect(() => parseMcpConfig(invalidPolicy)).toThrow();
  });

  it('rejects invalid origin URI formatting (e.g. wildcards or paths)', () => {
    const wildcardOrigin = {
      ...VALID_CONFIG,
      originAllowlist: ['https://*.example.com'],
    };
    expect(() => parseMcpConfig(wildcardOrigin)).toThrow();

    const originWithPath = {
      ...VALID_CONFIG,
      originAllowlist: ['https://example.com/api'],
    };
    expect(() => parseMcpConfig(originWithPath)).toThrow();
  });

  it('enforces request size cap bounds (must be positive integer <= 10 MiB)', () => {
    const negativeBytes = {
      ...VALID_CONFIG,
      maximumRequestBytes: -1,
    };
    expect(() => parseMcpConfig(negativeBytes)).toThrow();

    const zeroBytes = {
      ...VALID_CONFIG,
      maximumRequestBytes: 0,
    };
    expect(() => parseMcpConfig(zeroBytes)).toThrow();
  });

  it('enforces page records cap bounds (must be positive integer <= 1000)', () => {
    const excessivePage = {
      ...VALID_CONFIG,
      maximumPageRecords: 10000,
    };
    expect(() => parseMcpConfig(excessivePage)).toThrow();
  });

  it('provides default values for optional settings where specified by G.13', () => {
    const minimalConfig = {
      protocolRevision: '2025-11-25',
      transport: 'STREAMABLE_HTTP',
      originMode: 'EXACT_ALLOWLIST',
      originAllowlist: ['https://mcp.example.com'],
      absentOriginPolicy: 'PRODUCTION',
    };
    const parsed = McpServerConfigSchema.parse(minimalConfig);
    expect(parsed.statefulSessionsEnabled).toBe(false);
    expect(parsed.maximumRequestBytes).toBe(262144);
    expect(parsed.maximumResponseBytes).toBe(1048576);
    expect(parsed.maximumPageRecords).toBe(100);
  });
});
