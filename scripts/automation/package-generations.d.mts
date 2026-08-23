// Type declarations for durable execution generations (V3 §6, package-generations.mjs).

export declare function packageGeneration(
  pkg: { id?: string; generation?: number } | null | undefined,
): number;

export declare function generationBranch(packageId: string, generation: number): string;

export declare function generationMessage(packageId: string, generation: number): string;

export declare function parseGenerationMessage(
  message: unknown,
): { packageId: string; generation: number } | null;

export declare function usesOptimizedWorkflow(
  pkg: { id?: string; generation?: number } | null | undefined,
): boolean;

export declare function workPackageWorkflowFor(
  pkg: { id?: string; generation?: number } | string | null | undefined,
): 'foresift-work-package' | 'foresift-work-package-optimized';
