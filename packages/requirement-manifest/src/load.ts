import { readFileSync } from 'node:fs';
import type { RequirementManifest } from './types.ts';
import { validateRequirementManifest, type ValidationOptions } from './validate.ts';

export interface LoadOptions extends ValidationOptions {
  readonly manifestPath: string;
}
export function loadRequirementManifest(options: LoadOptions): RequirementManifest {
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8')) as RequirementManifest;
  if (options.auditPath || options.prdPath || options.sha256sumsPath)
    validateRequirementManifest({ ...options, manifestData: manifest });
  return manifest;
}
