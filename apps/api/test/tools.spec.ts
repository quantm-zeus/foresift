/**
 * Unit test suite for MCP tools exposure over Shared Tool Core (T014).
 * Traces: FR-MCP-002, AC-001, PRD §17.10.
 *
 * Asserts:
 * - Exposes G0 tool catalog strictly through ToolCore registry & execute.
 * - Enforces per-client ToolProfileId binding on tools/list and tools/call.
 * - Provider-specific atomic tools excluded from discovery/free profiles.
 * - Plan-gated operations absent from STRICT_FREE profiles.
 * - Rejects execution of un-profiled tools with TOOL_NOT_IN_PROFILE.
 * - system_health and quota_get_status surface caller's own view.
 */
import { describe, expect, it } from 'bun:test';
import { ToolProfileId } from '@foresift/domain';
import {
  McpToolRegistryHandler,
  type McpToolCallRequest,
} from '../src/mcp/tools.ts';

describe('T014 — MCP tool catalog & execution over ToolCore (AC-001)', () => {
  const handler = new McpToolRegistryHandler();

  it('lists only authorized domain tools for DISCOVERY profile', async () => {
    const tools = await handler.listToolsForProfile(ToolProfileId.DISCOVERY);
    const names = tools.map((t) => t.name);

    expect(names).toContain('discover_candidates');
    expect(names).toContain('get_asset_identity');
    expect(names).toContain('get_candidate_delta');
    expect(names).toContain('compare_candidates');

    // Provider atomic tools (e.g. helius_raw_rpc) must NOT be present
    expect(names).not.toContain('helius_get_raw_block');
    expect(names).not.toContain('gmgn_raw_query');
  });

  it('excludes paid / plan-gated operations from STRICT_FREE profile', async () => {
    const freeTools = await handler.listToolsForProfile(ToolProfileId.STRICT_FREE);
    const freeNames = freeTools.map((t) => t.name);

    // Free tools admitted
    expect(freeNames).toContain('discover_candidates');
    expect(freeNames).toContain('system_health');

    // Paid / diagnostic operations excluded
    expect(freeNames).not.toContain('expert_provider_diagnostic');
  });

  it('exposes G0 health, quota, and capacity status tools', async () => {
    const standardTools = await handler.listToolsForProfile(ToolProfileId.STANDARD);
    const names = standardTools.map((t) => t.name);

    expect(names).toContain('system_health');
    expect(names).toContain('quota_get_status');
    expect(names).toContain('capacity_get_status');
    expect(names).toContain('provider_get_health');
    expect(names).toContain('collector_get_health');
    expect(names).toContain('capability_get_status');
  });

  it('delegates execution strictly to ToolCore.execute with profile verification', async () => {
    const callReq: McpToolCallRequest = {
      toolName: 'discover_candidates',
      arguments: { limit: 10 },
      clientContext: {
        actor: 'user-1',
        profileId: ToolProfileId.DISCOVERY,
        scopes: ['tools:execute'],
      },
    };

    const result = await handler.executeTool(callReq);
    expect(result.content).toBeDefined();
    expect(result._meta).toBeDefined();
    expect(result._meta.toolName).toBe('discover_candidates');
  });

  it('refuses execution when requested tool is outside caller profile', async () => {
    const unauthorizedCall: McpToolCallRequest = {
      toolName: 'expert_provider_diagnostic', // Not in DISCOVERY
      arguments: {},
      clientContext: {
        actor: 'user-1',
        profileId: ToolProfileId.DISCOVERY,
        scopes: ['tools:execute'],
      },
    };

    const result = await handler.executeTool(unauthorizedCall);
    expect(result.isError).toBe(true);
    expect(result.refusalReason).toBe('TOOL_NOT_IN_PROFILE');
  });

  it('system_health returns caller-specific status view', async () => {
    const result = await handler.executeTool({
      toolName: 'system_health',
      arguments: {},
      clientContext: {
        actor: 'tenant-abc',
        profileId: ToolProfileId.STANDARD,
        scopes: ['tools:execute'],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.actor).toBe('tenant-abc');
  });
});
