export declare function classifyOwnedPath(
  path: string,
  options?: { testOwnedPaths?: string[] },
): string | { isTest?: boolean; isProduct?: boolean };
export declare function validateLaneOwnership(input: {
  engine: string;
  role: string;
  changedPaths?: string[];
  testOwnedPaths?: string[];
  dispute?: Record<string, unknown>;
}): {
  ok: boolean;
  valid: boolean;
  violation: string | null;
  code: string | null;
  violationCode: string | null;
  violations: string[];
  violatingPaths: string[];
};
export declare function recordTestDispute(
  baselineRecord: Record<string, unknown>,
  dispute: Record<string, unknown>,
): Record<string, any>;
/* eslint-disable @typescript-eslint/no-explicit-any */
