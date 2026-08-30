/**
 * T018: MCP Prompts Catalog & Profile Binding suite (FR-MCP-002, §17.3, AC-001).
 * Tests apps/api/src/mcp/prompts.ts for the eight §17.3 prompts, argument schemas,
 * caller profile/scope binding, and message generation.
 */
import { describe, expect, it } from 'bun:test';
import { MCP_PROMPT_INJECTION_STRINGS } from '../../../tests/fixtures/mcp/index.ts';

async function loadPromptsModule() {
  return await import('../src/mcp/prompts.ts');
}

describe('T018: MCP prompts catalog and message generation (AC-001, FR-MCP-002)', () => {
  const EIGHT_MANDATED_PROMPTS = [
    'analyze-token',
    'investigate-alert',
    'compare-candidates',
    'audit-security',
    'explain-original-decision',
    're-evaluate-current',
    'analyze-wallet-cluster',
    'challenge-opportunity-thesis',
  ] as const;

  it('lists all eight §17.3 prompt descriptors with argument definitions', async () => {
    const { listPrompts } = await loadPromptsModule();
    const prompts = await listPrompts({ scopes: ['prompts:read', 'tools:read'] });

    expect(prompts).toHaveLength(8);
    const names = prompts.map((p: { name: string }) => p.name);
    for (const mandated of EIGHT_MANDATED_PROMPTS) {
      expect(names).toContain(mandated);
    }
  });

  it('generates prompt messages for analyze-token with provided arguments', async () => {
    const { getPrompt } = await loadPromptsModule();
    const result = await getPrompt('analyze-token', {
      token: 'So11111111111111111111111111111111111111112',
    });

    expect(result.description).toBeDefined();
    expect(result.messages).toBeInstanceOf(Array);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]?.role).toBe('user');
    expect(result.messages[0]?.content.text).toContain('So11111111111111111111111111111111111111112');
  });

  it('generates prompt messages for investigate-alert and challenge-opportunity-thesis', async () => {
    const { getPrompt } = await loadPromptsModule();

    const alertPrompt = await getPrompt('investigate-alert', { alertId: 'alert-sol-001' });
    expect(alertPrompt.messages[0]?.content.text).toContain('alert-sol-001');

    const challengePrompt = await getPrompt('challenge-opportunity-thesis', {
      candidateId: 'cand-001',
    });
    expect(challengePrompt.messages[0]?.content.text).toContain('cand-001');
  });

  it('refuses prompt generation when required arguments are missing', async () => {
    const { getPrompt } = await loadPromptsModule();

    expect(() => getPrompt('analyze-token', {})).toThrow(/missing required argument/i);
    expect(() => getPrompt('compare-candidates', { tokenA: 'SOL' })).toThrow(
      /missing required argument/i,
    );
  });

  it('treats prompt injection strings as inert textual parameters', async () => {
    const { getPrompt } = await loadPromptsModule();

    for (const injection of MCP_PROMPT_INJECTION_STRINGS) {
      const result = await getPrompt('analyze-token', { token: injection });
      // The injection text is contained literally in the user message, not executed or parsed as instructions
      expect(result.messages[0]?.role).toBe('user');
      expect(result.messages[0]?.content.text).toContain(injection);
    }
  });

  it('filters privileged prompts based on caller scopes', async () => {
    const { listPrompts } = await loadPromptsModule();

    // Restricted scope set
    const restricted = await listPrompts({ scopes: ['tools:read'] }); // Missing prompts:read or security scopes
    const restrictedNames = restricted.map((p: { name: string }) => p.name);
    // Security audit prompt should not be available without appropriate scope
    expect(restrictedNames).not.toContain('audit-security');
  });
});
