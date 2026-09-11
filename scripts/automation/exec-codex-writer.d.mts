/* eslint-disable @typescript-eslint/no-explicit-any */
export declare function codexRouteForLane(
  routing: Record<string, any>,
  lane: string,
): Record<string, any>;
export declare function classifyCodexExit(result: unknown): string;
export declare function codexProviderEvent(
  classification: string,
  detail?: string | null,
): { event: string; resetAt?: number };
export declare function validateGeneration(generation: unknown): number;
export declare function runCodexWriter(input: Record<string, any>): Record<string, any>;
export declare function writerSummaryFor(result: Record<string, any>): {
  ok: boolean;
  lane: string | null;
  model: string | null;
  reasoning: string | null;
  serviceTier: string | null;
  headSha: string | null;
};
