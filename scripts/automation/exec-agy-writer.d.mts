// Type declarations for the hybrid writer-engine selector / agy executor
// (V4 §25/§30, exec-agy-writer.mjs).

export declare function decideWriterEngine(
  laneId: string,
  opts?: {
    env?: Record<string, string | undefined>;
    hasAgy?: boolean;
    coreLane?: boolean;
  },
): 'CLAUDE' | 'AGY';

export declare function agyOnPath(): boolean;

export declare function emitEngineFiles(
  graphPath: string,
  artifactsDir: string,
  lanes?: string[],
  opts?: { env?: Record<string, string | undefined>; hasAgy?: boolean; coreLane?: boolean },
): Record<string, string>;
