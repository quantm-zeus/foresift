import { readFile } from 'node:fs/promises';

export interface LoadRequirementManifestOptions {
  readonly manifestPath: string;
  readonly auditPath?: string;
  readonly prdPath?: string;
  readonly sha256sumsPath?: string;
}

/** @requirement FR-TRACE-001 */
export async function loadRequirementManifest(options: LoadRequirementManifestOptions): Promise<any> {
  if (!options || typeof options.manifestPath !== 'string') throw new TypeError('manifestPath is required');
  const parsed = JSON.parse(await readFile(options.manifestPath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.requirements) || !Array.isArray(parsed.acceptanceCriteria) ||
      !Array.isArray(parsed.invariants) || !Array.isArray(parsed.adrs)) {
    throw new Error('INVALID_REQUIREMENT_MANIFEST: normative collections are required');
  }
  return parsed;
}
