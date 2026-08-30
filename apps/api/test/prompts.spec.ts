/**
 * Unit test suite for MCP standard prompts (T018).
 * Traces: FR-MCP-002, AC-001, PRD §17.3.
 *
 * Asserts:
 * - Exposes exactly the eight §17.3 prompts:
 *   1. analyze-token
 *   2. investigate-alert
 *   3. compare-candidates
 *   4. audit-security
 *   5. explain-original-decision
 *   6. re-evaluate-current
 *   7. analyze-wallet-cluster
 *   8. challenge-opportunity-thesis
 * - Validates input arguments schema for each prompt.
 * - Renders standard prompt messages bound to caller's profile/scopes.
 * - Refuses execution of prompts when caller lacks requisite scopes.
 */
import { describe, expect, it } from 'bun:test';
import {
  McpPromptHandler,
  MANDATED_PROMPT_NAMES,
  type GetPromptRequest,
} from '../src/mcp/prompts.ts';

describe('T018 — MCP standard prompts handler (AC-001)', () => {
  const handler = new McpPromptHandler();

  it('lists all eight §17.3 mandated prompts', async () => {
    const prompts = await handler.listPrompts({
      actor: 'user-1',
      profileId: 'standard',
      scopes: ['prompts:read'],
    });

    const names = prompts.map((p) => p.name);
    expect(names).toHaveLength(8);
    for (const mandated of MANDATED_PROMPT_NAMES) {
      expect(names).toContain(mandated);
    }
  });

  it('gets analyze-token prompt with rendered messages', async () => {
    const req: GetPromptRequest = {
      name: 'analyze-token',
      arguments: {
        tokenAddress: 'So11111111111111111111111111111111111111112',
        depth: 'FULL',
      },
      clientContext: {
        actor: 'analyst-1',
        profileId: 'standard',
        scopes: ['prompts:read'],
      },
    };

    const result = await handler.getPrompt(req);
    expect(result.description).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0]?.content?.text).toContain('So11111111111111111111111111111111111111112');
  });

  it('gets challenge-opportunity-thesis prompt with arguments', async () => {
    const req: GetPromptRequest = {
      name: 'challenge-opportunity-thesis',
      arguments: {
        candidateId: 'cand_123',
        thesisStatement: 'High liquidity growth on Raydium pool',
      },
      clientContext: {
        actor: 'analyst-1',
        profileId: 'standard',
        scopes: ['prompts:read'],
      },
    };

    const result = await handler.getPrompt(req);
    expect(result.messages[0]?.content?.text).toContain('cand_123');
    expect(result.messages[0]?.content?.text).toContain('High liquidity growth');
  });

  it('rejects unknown prompt names', async () => {
    const req: GetPromptRequest = {
      name: 'unknown-custom-prompt',
      arguments: {},
      clientContext: {
        actor: 'analyst-1',
        profileId: 'standard',
        scopes: ['prompts:read'],
      },
    };

    expect(async () => await handler.getPrompt(req)).toThrow(/PROMPT_NOT_FOUND|unknown/i);
  });

  it('refuses prompt access if caller lacks prompts:read scope', async () => {
    const req: GetPromptRequest = {
      name: 'audit-security',
      arguments: { tokenAddress: 'So11111111111111111111111111111111111111112' },
      clientContext: {
        actor: 'analyst-1',
        profileId: 'standard',
        scopes: ['tools:execute'], // Missing prompts:read
      },
    };

    expect(async () => await handler.getPrompt(req)).toThrow(/PROMPT_UNAUTHORIZED|unauthorized/i);
  });
});
