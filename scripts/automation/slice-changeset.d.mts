export type ChangesetStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface ChangedFile {
  path: string;
  status: ChangesetStatus;
}

export interface SliceChangeset {
  baseRef: string | null;
  headSha: string | null;
  files: ChangedFile[];
  commits: string[];
  unknown: boolean;
  reasons: string[];
}

export declare function git(args: string[], repoRoot: string): string;
export declare function resolveSliceChangeset(opts: {
  repoRoot: string;
  baseRef?: string | null;
}): SliceChangeset;
export declare function parseNameStatus(raw: string): ChangedFile[];
export declare function parsePorcelain(raw: string): ChangedFile[];
