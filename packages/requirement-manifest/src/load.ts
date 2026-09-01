import { readFile } from 'node:fs/promises';
import { ManifestErrorCode, RequirementManifestError } from './errors.ts';
import { validateRequirementManifest, type RequirementManifest } from './validate.ts';

export interface LoadRequirementManifestOptions {
  readonly manifestPath: string;
  readonly auditPath?: string;
  readonly prdPath?: string;
  readonly sha256sumsPath?: string;
}

/** Load the generated artifact, validating it when its authority inputs are supplied. */
export async function loadRequirementManifest(
  options: LoadRequirementManifestOptions,
): Promise<RequirementManifest> {
  let manifest: RequirementManifest;
  try {
    manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as RequirementManifest;
  } catch (cause) {
    throw new RequirementManifestError(
      ManifestErrorCode.MANIFEST_PARSE_FAILED,
      `could not read or parse manifest ${options.manifestPath}: ${String(cause)}`,
      { path: options.manifestPath },
    );
  }

  if (options.auditPath || options.prdPath || options.sha256sumsPath) {
    validateRequirementManifest({ ...options, manifestData: manifest });
  }
  return manifest;
}
