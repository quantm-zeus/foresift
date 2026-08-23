export type ImpactCategory =
  | 'CODE_JS_TS'
  | 'DATABASE'
  | 'AUTHORITATIVE_SPEC'
  | 'ARCHON_CONTROL_PLANE'
  | 'DOC_ONLY'
  | 'ROOT_OR_UNKNOWN';

export declare const IMPACT_CATEGORIES: ImpactCategory[];

export interface ImpactClassification {
  categories: Record<ImpactCategory, string[]>;
  escalateFull: boolean;
  reason: string | null;
}

export interface FastCheckStep {
  kind:
    | 'eslint'
    | 'vitest-related'
    | 'typecheck'
    | 'authority-validate'
    | 'conformance-tests'
    | 'format-check'
    | 'archon-validate';
  files?: string[];
  database?: boolean;
}

export declare function classifyPath(path: string): ImpactCategory;
export declare function classifyImpact(paths: string[]): ImpactClassification;
export declare function planFastChecks(classification: ImpactClassification): FastCheckStep[];
