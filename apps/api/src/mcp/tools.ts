import { toolProfileId, type CostMode } from '@foresift/domain';
import type { ToolCore, ToolExecutionRequest } from '@foresift/tool-core';
import type { McpClientContext } from '../auth/client-context.ts';
import { formatMcpOutput, type FormatOutputOptions, type McpFormattedOutput } from './output.ts';

export const MCP_STATUS_TOOLS = [
  'system_health',
  'quota_get_status',
  'capacity_get_status',
  'provider_get_health',
  'collector_get_health',
  'capability_get_status',
] as const;

export const MCP_EXPERT_PROVIDER_TOOLS = [
  'dexscreener_search_pairs',
  'dexscreener_get_token_pairs',
  'dexscreener_get_latest_profiles',
  'gmgn_get_market_trending',
  'gmgn_get_hot_searches',
  'gmgn_get_token_info',
  'gmgn_get_token_security',
  'gmgn_get_top_holders',
  'gmgn_get_top_traders',
  'goplus_get_token_security',
  'goplus_get_address_risk',
  'helius_get_asset',
  'helius_get_token_accounts_by_mint',
  'solana_rpc_get_signatures_for_address',
  'solana_rpc_get_transaction',
  'solana_decode_supported_program_instructions',
  'collector_get_program_events',
] as const;

export const MCP_DOMAIN_TOOLS = [
  'snapshot_get_history',
  'snapshot_compare_periods',
  'candidate_get_timeline',
  'candidate_get_current_features',
  'research_get_market_evidence',
  'research_get_security_evidence',
  'research_get_holder_evidence',
  'research_get_tradability_assessment',
  'research_get_winning_pattern_matches',
  'research_get_wallet_alpha_lineage',
  'research_get_deployer_funder_dna',
  'research_get_liquidity_resilience',
  'research_get_launch_migration_state',
  'research_get_attention_diffusion',
  'research_get_leader_laggard_assessment',
  'research_get_novelty_assessment',
  'research_get_multi_view_assessment',
  'research_get_failure_hazard',
  'research_get_opportunity_frontier',
  'research_get_shadow_portfolio_evidence',
  'run_get_trace',
  'alert_get_recent',
] as const;

export const MCP_G0_TOOL_CATALOG = [
  ...MCP_STATUS_TOOLS,
  ...MCP_EXPERT_PROVIDER_TOOLS,
  ...MCP_DOMAIN_TOOLS,
] as const;

const EXPERT_PROFILES = new Set(['admin-read']);
const PLAN_GATED_STRICT_FREE = new Set<string>([
  'solana_rpc_get_transaction',
  'snapshot_get_history',
  'snapshot_compare_periods',
]);

export interface McpToolDescription {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolCallInput {
  readonly client: McpClientContext;
  readonly runId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly canonicalEntityIdentity: string;
  readonly costMode?: CostMode;
  readonly output?: FormatOutputOptions;
}

export class McpToolSurface {
  constructor(
    private readonly toolCore: ToolCore,
    private readonly auditAccess?: (input: {
      readonly actor: string;
      readonly subject: string;
      readonly allowed: boolean;
      readonly detail?: Record<string, unknown>;
    }) => Promise<void>,
  ) {}

  list(client: McpClientContext, costMode: CostMode = 'STRICT_FREE'): McpToolDescription[] {
    const profile = toolProfileId(client.toolProfileId);
    const bounded = new Set(client.toolBounds);
    return this.toolCore.registry
      .listByProfile(profile)
      .filter((entry) => (bounded.size === 0 ? true : bounded.has(entry.metadata.name)))
      .filter((entry) =>
        (MCP_EXPERT_PROVIDER_TOOLS as readonly string[]).includes(entry.metadata.name)
          ? EXPERT_PROFILES.has(client.toolProfileId)
          : true,
      )
      .filter(
        (entry) => costMode !== 'STRICT_FREE' || !PLAN_GATED_STRICT_FREE.has(entry.metadata.name),
      )
      .map((entry) => ({
        name: entry.metadata.name,
        title: entry.metadata.title,
        description: entry.metadata.description,
        inputSchema: entry.metadata.inputSchemaJson,
        outputSchema: entry.metadata.outputSchemaJson,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async call(input: ToolCallInput): Promise<McpFormattedOutput> {
    const visible = this.list(input.client, input.costMode).some(
      (tool) => tool.name === input.name,
    );
    if (!visible) {
      await this.auditAccess?.({
        actor: input.client.actorId,
        subject: `tool:${input.name}`,
        allowed: false,
        detail: { reason: 'TOOL_NOT_IN_PROFILE' },
      });
      throw new Error('TOOL_NOT_IN_PROFILE');
    }
    const request: ToolExecutionRequest = {
      runId: input.runId,
      authnMaterial: input.client,
      holderMode: 'MCP_MANUAL',
      workloadClass: 'INTERACTIVE_HIGH',
      toolName: input.name,
      tenantId: input.tenantId,
      arguments: input.arguments,
      canonicalEntityIdentity: input.canonicalEntityIdentity,
    };
    await this.auditAccess?.({
      actor: input.client.actorId,
      subject: `tool:${input.name}`,
      allowed: true,
    });
    return formatMcpOutput(await this.toolCore.execute(request), input.output);
  }
}
