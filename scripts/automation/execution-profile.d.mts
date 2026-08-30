/* eslint-disable @typescript-eslint/no-explicit-any */
export type ExecutionProfile = 'HYBRID_AGY' | 'CODEX_AGY' | 'CLAUDE_AGY';
export declare const DEFAULT_EXECUTION_PROFILE: ExecutionProfile;
export declare const SUPPORTED_EXECUTION_PROFILES: readonly ExecutionProfile[];
export declare const BASELINE_TEST_CLASSIFICATIONS: readonly string[];
export declare const TEST_BASELINE_CLASSIFICATIONS: readonly string[];
export declare function resolveExecutionProfile(
  input?:
    | string
    | {
        override?: string;
        executionProfile?: string;
        env?: Record<string, string | undefined>;
      },
): ExecutionProfile;
export declare function implementationEngineForProfile(
  profile: string,
): 'HYBRID' | 'CODEX' | 'CLAUDE';
export declare function testEngineForProfile(profile: string): 'AGY';
export declare function createExecutionIdentity(
  input: Record<string, unknown>,
): Record<string, any>;
export declare function persistExecutionIdentity(
  file: string,
  input: Record<string, unknown>,
): Record<string, any>;
export declare function loadExecutionIdentity(file: string): Record<string, any>;
export declare function recoverExecutionIdentity(
  file: string,
  input?: Record<string, unknown>,
): Record<string, any>;
export declare function requireAgyForTests(input: { testBearing: boolean; hasAgy: boolean }): {
  required: boolean;
  engine: 'AGY' | null;
};
export declare function createTestDispute(input: Record<string, unknown>): Record<string, any>;
