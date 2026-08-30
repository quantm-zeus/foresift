/**
 * apps/api/test/prompts.spec.ts
 *
 * Unit tests for the eight §17.3 MCP prompt definitions (T018 / AC-001).
 * Traces: FR-MCP-002, §17.3, AC-001.
 *
 * Asserts:
 * - Exposes all eight mandated §17.3 standard prompts on prompts/list.
 * - Validates prompt arguments and renders structured prompt messages on prompts/get.
 * - Binds prompt visibility and invocation to the caller's profile and scopes.
 * - Refuses execution of unpermitted prompts with typed authorization errors.
 */
import { describe, expect, it } from 'bun:test';
import { ToolProfileId } from '@foresift/domain';
import {
  McpPromptHandler,
  MANDATED_PROMPT_NAMES,
  type GetPromptRequest,
} from '../src/mcp/prompts.ts';

describe('T018: the eight §17.3 standard MCP prompts (AC-001)', () => {
  it('lists all eight §17.3 prompts for fully scoped profiles', () => {
    const handler = new McpPromptHandler();
    const result = handler.listPromptsForProfile(ToolProfileId.EXPERT);

    const names = result.prompts.map((p) => p.name);
    expect(names).toEqual([
      'analyze-token',
      'investigate-alert',
      'compare-candidates',
      'audit-security',
      'explain-original-decision',
      're-evaluate-current',
      'analyze-wallet-cluster',
      'challenge-opportunity-thesis',
    ]);
    expect(result.prompts).toHaveLength(8);
  });

  it('renders analyze-token prompt messages with required arguments', async () => {
    const handler = new McpPromptHandler();

    const request: GetPromptRequest = {
      name: 'analyze-token',
      arguments: {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        timeframe: '24h',
      },
      clientContext: {
        actor: 'analyst@foresift.io',
        toolProfileId: ToolProfileId.DISCOVERY,
        scopes: ['research:read'],
      },
    };

    const rendered = await handler.getPrompt(request);
    expect(rendered.description).toBeDefined();
    expect(rendered.messages.length).toBeGreaterThan(0);

    const userMessage = rendered.messages[0];
    expect(userMessage?.role).toBe('user');
    expect(userMessage?.content.type).toBe('text');
    expect(userMessage?.content.text).toContain('So11111111111111111111111111111111111111112');
  });

  it('renders challenge-opportunity-thesis prompt messages for candidate evaluation', async () => {
    const handler = new McpPromptHandler();

    const request: GetPromptRequest = {
      name: 'challenge-opportunity-thesis',
      arguments: {
        candidateId: 'cand-sol-001',
        thesis: 'High liquidity growth following DEX migration',
      },
      clientContext: {
        actor: 'analyst@foresift.io',
        toolProfileId: ToolProfileId.DISCOVERY,
        scopes: ['research:read'],
      },
    };

    const rendered = await handler.getPrompt(request);
    expect(rendered.messages[0]?.content.text).toContain('cand-sol-001');
    expect(rendered.messages[0]?.content.text).toContain('High liquidity growth');
  });

  it('throws validation error when required prompt arguments are missing', async () => {
    const handler = new McpPromptHandler();

    const requestWithMissingArgs: GetPromptRequest = {
      name: 'analyze-token',
      arguments: {}, // missing required tokenAddress
      clientContext: {
        actor: 'analyst@foresift.io',
        toolProfileId: ToolProfileId.DISCOVERY,
        scopes: ['research:read'],
      },
    };

    await expect(handler.getPrompt(requestWithMissingArgs)).rejects.toThrow(
      /ARGUMENT_REQUIRED|missing required argument/i,
    );
  });

  it('refuses prompts not available in caller profile or granted scopes', async () => {
    const handler = new McpPromptHandler();

    const requestOutOfScope: GetPromptRequest = {
      name: 'audit-security',
      arguments: { tokenAddress: 'So11111111111111111111111111111111111111112' },
      clientContext: {
        actor: 'restricted-user@foresift.io',
        toolProfileId: ToolProfileId.STRICT_FREE,
        scopes: ['discovery:read'], // lacks security audit scope
      },
    };

    await expect(handler.getPrompt(requestOutOfScope)).rejects.toThrow(
      /PROMPT_UNAUTHORIZED|SCOPE_REQUIRED/i,
    );
  });
});
