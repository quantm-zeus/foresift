/* eslint-disable @typescript-eslint/no-explicit-any */
export declare function claudeProviderEvent(
  classification: string,
  detail?: string | null,
): { healthy: boolean; retryAfterMs?: number | null };
export declare function runClaudeWriter(input: Record<string, any>): Record<string, any>;
