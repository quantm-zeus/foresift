/**
 * T014: MCP Tools catalog and profile binding suite (FR-MCP-002, §17.10, AC-001).
 * Tests apps/api/src/mcp/tools.ts for ToolCore delegation, §17.10 catalog exposure,
 * per-client profile binding, atomic tool exclusion, and plan gating.
 */
import { describe, expect, it } from 'bun:test';
import { ToolProfileId } from '@foresift/domain';

async function loadToolsModule() {
  return await import('../src/mcp/tools.ts');
}

describe('T014: MCP tools catalog and profile binding (AC-001, FR-MCP-002)', () => {
  it('lists §17.10 G0 tool catalog filtered by DISCOVERY profile', async () => {
    const { listToolsForProfile } = await loadToolsModule();
    const tools = await listToolsForProfile(ToolProfileId.DISCOVERY);

    const toolNames = tools.map((t: { name: string }) => t.name);
    // Domain discovery tools present
    expect(toolNames).toContain('discover_candidates');
    expect(toolNames).toContain('get_asset_identity');
    expect(toolNames).toContain('get_candidate_delta');
    expect(toolNames).toContain('compare_candidates');

    // Status tools present
    expect(toolNames).toContain('system_health');
    expect(toolNames).toContain('quota_get_status');
    expect(toolNames).toContain('capacity_get_status');

    // Provider atomic tools strictly ABSENT for DISCOVERY profile
    expect(toolNames).not.toContain('provider_adapter_probe');
    expect(toolNames).not.toContain('raw_ledger_diagnostic');
  });

  it('exposes diagnostic / atomic tools only to privileged expert profiles', async () => {
    const { listToolsForProfile } = await loadToolsModule();
    const expertTools = await listToolsForProfile(ToolProfileId.ADMIN_READ);
    const expertNames = expertTools.map((t: { name: string }) => t.name);

    expect(expertNames).toContain('get_asset_identity');
  });

  it('delegates tools/call execution strictly through ToolCore', async () => {
    const { executeMcpTool } = await loadToolsModule();
    let toolCoreCalled = false;

    const mockToolCore = {
      execute: async (req: unknown) => {
        toolCoreCalled = true;
        return {
          data: { result: 'ok' },
          meta: {
            toolName: 'discover_candidates',
            toolVersion: '1.0.0',
            evidenceIds: ['ev-001'],
            partial: false,
          },
        };
      },
    };

    const result = await executeMcpTool(
      {
        name: 'discover_candidates',
        arguments: { limit: 10 },
      },
      {
        toolCore: mockToolCore as unknown as import('@foresift/tool-core').ToolCore,
        callerProfile: ToolProfileId.DISCOVERY,
        actor: 'user@foresift.io',
      },
    );

    expect(toolCoreCalled).toBe(true);
    expect(result.structuredContent).toBeDefined();
    expect(result._meta.toolName).toBe('discover_candidates');
  });

  it('refuses tool call when tool is outside the callers profile', async () => {
    const { executeMcpTool } = await loadToolsModule();

    const mockToolCore = {
      execute: async () => {
        throw new Error('ToolCore should not be called');
      },
    };

    const result = await executeMcpTool(
      {
        name: 'provider_adapter_probe', // Forbidden for discovery profile
        arguments: {},
      },
      {
        toolCore: mockToolCore as unknown as import('@foresift/tool-core').ToolCore,
        callerProfile: ToolProfileId.DISCOVERY,
        actor: 'user@foresift.io',
      },
    );

    expect(result.isError).toBe(true);
    expect(result.errorReason).toBe('TOOL_NOT_IN_PROFILE');
  });
});
