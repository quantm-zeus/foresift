import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RequirementManifestError,
  RequirementManifestErrorCode,
} from './errors.ts';
import { validateRequirementManifest, type ValidationPaths } from './validate.ts';

export interface ManifestTextItem {
  readonly id: string;
  readonly line: number;
  readonly text: string;
  readonly textSha256: string;
  readonly [key: string]: unknown;
}

export interface RequirementItem extends ManifestTextItem {
  readonly acceptanceCriteria: readonly string[];
  readonly dependencyGroup: string;
  readonly securityRightsCostControls: readonly string[];
}

export interface AcceptanceCriterionItem extends ManifestTextItem {
  readonly requirementRefs: readonly string[];
}

export interface AdrItem {
  readonly id: string;
  readonly line: number;
  readonly title: string;
  readonly status: string;
  readonly decision: string;
  readonly textSha256: string;
  readonly [key: string]: unknown;
}

export interface DependencyGroup {
  readonly id: string;
  readonly name?: string;
  readonly dependsOn?: readonly string[];
  /** Fixture-compatible alias accepted by the DAG checker. */
  readonly dependencies?: readonly string[];
}

export interface RequirementManifest {
  readonly schemaVersion: string;
  readonly requirements: readonly RequirementItem[];
  readonly acceptanceCriteria: readonly AcceptanceCriterionItem[];
  readonly invariants: readonly ManifestTextItem[];
  readonly adrs: readonly AdrItem[];
  readonly dependencyGroups: readonly DependencyGroup[];
  readonly releaseConformance: Readonly<Record<string, unknown>>;
  readonly document?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
);
export const DEFAULT_AUDIT_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json',
);
export const DEFAULT_PRD_PATH = path.join(
  REPO_ROOT,
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md',
);
export const DEFAULT_SHA256SUMS_PATH = path.join(REPO_ROOT, 'docs/spec/SHA256SUMS');

export interface LoadRequirementManifestOptions extends Partial<ValidationPaths> {
  readonly manifestPath?: string;
}

export function assertManifestShape(value: unknown): asserts value is RequirementManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequirementManifestError(
      RequirementManifestErrorCode.MANIFEST_SHAPE_INVALID,
      'manifest root must be an object',
    );
  }
  const candidate = value as Record<string, unknown>;
  for (const key of [
    'requirements',
    'acceptanceCriteria',
    'invariants',
    'adrs',
    'dependencyGroups',
  ]) {
    if (!Array.isArray(candidate[key])) {
      throw new RequirementManifestError(
        RequirementManifestErrorCode.MANIFEST_SHAPE_INVALID,
        `manifest field ${key} must be an array`,
        { field: key },
      );
    }
  }
  if (typeof candidate.schemaVersion !== 'string') {
    throw new RequirementManifestError(
      RequirementManifestErrorCode.MANIFEST_SHAPE_INVALID,
      'manifest schemaVersion must be a string',
    );
  }
}

export async function readManifestFile(manifestPath: string): Promise<RequirementManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new RequirementManifestError(
      RequirementManifestErrorCode.MANIFEST_PARSE_FAILED,
      `could not parse requirement manifest ${manifestPath}: ${String(error)}`,
      { manifestPath },
    );
  }
  assertManifestShape(parsed);
  return parsed;
}

/** Load the authoritative manifest, validating companion artifacts when supplied. */
export async function loadRequirementManifest(
  options: LoadRequirementManifestOptions = {},
): Promise<RequirementManifest> {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = await readManifestFile(manifestPath);
  if (options.auditPath !== undefined || options.prdPath !== undefined || options.sha256sumsPath !== undefined) {
    await validateRequirementManifest({
      manifestData: manifest,
      manifestPath,
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      ...(options.prdPath === undefined ? {} : { prdPath: options.prdPath }),
      ...(options.sha256sumsPath === undefined ? {} : { sha256sumsPath: options.sha256sumsPath }),
    });
  }
  return manifest;
}
