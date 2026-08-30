import type { McpClientContext } from '../auth/client-context.ts';

export const MCP_PROMPT_NAMES = [
  'analyze-token',
  'investigate-alert',
  'compare-candidates',
  'audit-security',
  'explain-original-decision',
  're-evaluate-current',
  'analyze-wallet-cluster',
  'challenge-opportunity-thesis',
] as const;

export type McpPromptName = (typeof MCP_PROMPT_NAMES)[number];

export interface McpPromptDefinition {
  readonly name: McpPromptName;
  readonly description: string;
  readonly arguments: readonly { readonly name: string; readonly required: boolean }[];
  readonly requiredScopes: readonly string[];
  readonly allowedProfiles: readonly string[];
}

const ALL_STANDARD_PROFILES = [
  'discovery',
  'market-research',
  'security-research',
  'holder-wallet',
  'social-research',
  'macro-context',
  'run-investigation',
  'admin-read',
] as const;

export const MCP_PROMPTS: readonly McpPromptDefinition[] = MCP_PROMPT_NAMES.map((name) => ({
  name,
  description: `Bounded read-only research workflow: ${name}`,
  arguments: [{ name: 'target', required: true }],
  requiredScopes: ['tools:execute'],
  allowedProfiles: [...ALL_STANDARD_PROFILES],
}));

function visible(prompt: McpPromptDefinition, client: McpClientContext): boolean {
  return (
    prompt.allowedProfiles.includes(client.toolProfileId) &&
    prompt.requiredScopes.every((scope) => client.scopes.includes(scope))
  );
}

export function listMcpPrompts(client: McpClientContext): McpPromptDefinition[] {
  return MCP_PROMPTS.filter((prompt) => visible(prompt, client)).map((prompt) => ({ ...prompt }));
}

export function getMcpPrompt(
  name: string,
  client: McpClientContext,
  args: Readonly<Record<string, string>>,
): { readonly description: string; readonly messages: readonly unknown[] } {
  const prompt = MCP_PROMPTS.find((candidate) => candidate.name === name);
  if (prompt === undefined || !visible(prompt, client)) throw new Error('PROMPT_NOT_IN_PROFILE');
  const target = args.target;
  if (target === undefined || target.trim() === '') throw new Error('PROMPT_ARGUMENT_REQUIRED');
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Run ${prompt.name} for the caller-authorized target ${target}. Use only visible tools and cite resource evidence.`,
        },
      },
    ],
  };
}
