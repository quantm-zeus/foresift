/* eslint-disable @typescript-eslint/no-explicit-any */
export const LEASE_SCHEMA: string;
export declare const LEASE_STATES: Readonly<Record<string, string>>;
export declare const SHARED_SURFACE_FILES: readonly string[];
export declare function normalizeExactFiles(
  input: string[],
  opts?: { scopeFallback?: string[] },
): string[];
export declare function acquireLeases(
  stateDir: string,
  holder: string,
  exactFiles: string[],
  opts?: { baseSha?: string | null; scopeFallback?: string[] },
): {
  ok: boolean;
  granted: Array<Record<string, any>>;
  conflicts: Array<{ file: string; heldBy: string; state: string }>;
};
export declare function reserveLeases(
  stateDir: string,
  holder: string,
  exactFiles: string[],
  opts?: { baseSha?: string | null; scopeFallback?: string[] },
): {
  ok: boolean;
  reserved: Array<Record<string, any>>;
  conflicts: Array<{ file: string; heldBy: string; state: string }>;
};
export declare function releaseLeases(
  stateDir: string,
  holder: string,
  opts?: { reason?: string | null },
): { released: number };
export declare function activeLeases(stateDir: string): Array<Record<string, any>>;
export declare function exactConflictSurface(filesA: string[], filesB: string[]): string[];
export declare function computeContentSha256Fast(content: string): string;
