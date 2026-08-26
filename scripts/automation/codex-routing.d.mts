/* eslint-disable @typescript-eslint/no-explicit-any */
export declare const CODEX_SERVICE_TIER: 'standard';
export declare const CODEX_CLI_SERVICE_TIER: 'default';
export declare const MAX_CODEX_WRITERS: 3;
export declare const CODEX_MODELS: Readonly<Record<'LOW' | 'MEDIUM' | 'HIGH', string>>;
export declare function classifyCodexLane(input?: Record<string, any>): Record<string, any>;
export declare function routeCodexLane(
  input?: Record<string, any>,
  availability?: Iterable<string> | { availableModels: string[] },
): Record<string, any>;
export declare function retryCodexRoute(route: Record<string, any>): Record<string, any>;
export declare function escalateCodexRoute(
  route: Record<string, any>,
  availability?: Iterable<string>,
): Record<string, any>;
export declare function codexWriterCount(graph?: Record<string, any>): number;
export declare function buildCodexExecArgs(
  route: Record<string, any>,
  input: { worktree: string },
): string[];
export declare function installedCodexModels(binary?: string): Set<string>;
export declare function buildWaveRouting(
  graph: Record<string, any>,
  executionProfile: string,
  availability?: Iterable<string>,
): Record<string, any>;
