export interface AffectedTestResult {
  ok: boolean;
  mode: string;
  reason: string;
  tests: string[];
  changedPaths?: string[];
}

export function buildImportGraph(
  root: string,
  paths: string[],
): { reverse: Map<string, Set<string>>; ambiguousImporters: Set<string> };
export function selectAffectedTests(input: {
  root?: string;
  changedPaths: string[];
  allPaths: string[];
}): AffectedTestResult;
export function repositorySourcePaths(root?: string): string[];
