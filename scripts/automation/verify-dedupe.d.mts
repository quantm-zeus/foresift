export declare const PROHIBITED_SCAN: string;

export type DedupeVerdict =
  | { command: string; class: 'UNIQUE_MANDATORY'; reason: string }
  | {
      command: string;
      class: 'DUPLICATE_COVERED_BY_FULL_SUITE';
      reason: string;
      testFileCount: number;
    };

export declare function classifyCommand(command: string, repoRoot: string): DedupeVerdict;
export declare function classifyMilestoneVerification(repoRoot: string): DedupeVerdict[];
