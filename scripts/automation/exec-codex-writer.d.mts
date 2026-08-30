export declare function codexRouteForLane(
  routing: Record<string, any>,
  lane: string,
): Record<string, any>;
export declare function classifyCodexExit(result: unknown): string;
export declare function codexProviderEvent(
  classification: string,
  detail?: string | null,
): { event: string; resetAt?: number };
export declare function runCodexWriter(input: Record<string, any>): Record<string, any>;
