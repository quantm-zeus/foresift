/**
 * apps/api/test/tools.spec.ts
 *
 * Unit tests for MCP tool catalog exposure & ToolCore execution (T014 / AC-001).
 * Traces: FR-MCP-002, §17.10, AC-001, ADR-0021.
 *
 * Asserts:
 * - Exposes §17.10 G0 tool catalog strictly through Shared Tool Core registry.
 * - Enforces per-client ToolProfileId binding on tools/list.
 * - Narrow profiles (e.g. DISCOVERY, STRICT_FREE) see only assigned tools and zero atomic provider tools.
 * - Executes tool calls strictly via ToolCore.execute with HolderMode.MCP_MANUAL.
 * - Refuses execution of tools outside caller's profile with typed refusal TOOL_NOT_IN_PROFILE.
 */
import { describe, expect, it } from 'bun:test';
import { ToolProfileId, HolderMode } from '@foresift/domain';
import {
  McpToolRegistryHandler,
  type ListToolsParams,
  type CallToolParams,
} from '../src/mcp/tools.ts';

describe('T014: MCP tool catalog exposure via Shared Tool Core (AC-001)', () => {
  it('lists only scoped domain tools for DISCOVERY profile', () => {
    const handler = new McpToolRegistryHandler();
    const listResult = handler.listToolsForProfile(ToolProfileId.DISCOVERY);

    const toolNames = listResult.tools.map((t) => t.name);
    expect(toolNames).toContain('discover_candidates');
    expect(toolNames).toContain('get_asset_identity');
    expect(toolNames).toContain('compare_candidates');

    // Atomic provider tools strictly excluded from standard discovery profile
    expect(toolNames).not.toContain('provider_adapter_probe');
    expect(toolNames).not.toContain('raw_ledger_diagnostic');
  });

  it('exposes platform health and status tools across standard profiles', () => {
    const handler = new McpToolRegistryHandler();
    const listResult = handler.listToolsForProfile(ToolProfileId.STANDARD);

    const toolNames = listResult.tools.map((t) => t.name);
    expect(toolNames).toContain('system_health');
    expect(toolNames).toContain('quota_get_status');
    expect(toolNames).toContain('capacity_get_status');
    expect(toolNames).toContain('provider_get_health');
  });

  it('excludes paid and plan-gated operations from STRICT_FREE profiles', () => {
    const handler = new McpToolRegistryHandler();
    const freeTools = handler.listToolsForProfile(ToolProfileId.STRICT_FREE);

    const toolNames = freeTools.tools.map((t) => t.name);
    expect(toolNames).toContain('discover_candidates');
    expect(toolNames).not.toContain('premium_deep_intelligence');
  });

  it('executes tool calls through ToolCore with MCP_MANUAL holder mode and returns structured results', async () => {
    const handler = new McpToolRegistryHandler();

    const callParams: CallToolParams = {
      name: 'discover_candidates',
      arguments: { limit: 10 },
      clientContext: {
        actor: 'user@foresift.io',
        toolProfileId: ToolProfileId.DISCOVERY,
        scopes: ['discovery:read'],
      },
    };

    const result = await handler.callTool(callParams);
    expect(result.structuredContent).toBeDefined();
    expect(result.textContent).toBeDefined();
    expect(result.meta.toolName).toBe('discover_candidates');
    expect(result.meta.holderMode).toBe(HolderMode.MCP_MANUAL);
  });

  it('refuses execution when tool is not present in caller profile', async () => {
    const handler = new McpToolRegistryHandler();

    const outOfProfileCall: CallToolParams = {
      name: 'provider_adapter_probe', // atomic tool not in discovery profile
      arguments: {},
      clientContext: {
        actor: 'user@foresift.io',
        toolProfileId: ToolProfileId.DISCOVERY,
        scopes: ['discovery:read'],
      },
    };

    await expect(handler.callTool(outOfProfileCall)).rejects.toThrow(
      /TOOL_NOT_IN_PROFILE|AUTHORIZATION_REFUSED/i,
    );
  });
});
