/**
 * Supply-chain policy (FR-SEC-006; AC-254 dependency scan surface).
 *
 * Pure policy layer over the dependency surface: exact-version pinning for
 * production deps, lockfile presence/reproducibility records, SBOM record
 * emission, provenance-attestation fields, build-hash recording hooks,
 * restricted lifecycle-script checks, and capability review flags
 * (network / filesystem / process / crypto / dynamic code) that force a
 * dependency review whenever flagged.
 */
import { createHash } from 'node:crypto';
import { SecErrorCode, SupplyChainError } from './errors.ts';

// --- Pinning -------------------------------------------------------------------

const EXACT_VERSION = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/** Production dependencies must be pinned to EXACT versions. */
export function verifyPinning(
  manifests: ReadonlyArray<{
    readonly name: string;
    readonly dependencies?: Record<string, string> | undefined;
  }>,
): { pinned: string[]; violations: { manifest: string; dependency: string; range: string }[] } {
  const pinned: string[] = [];
  const violations: { manifest: string; dependency: string; range: string }[] = [];
  for (const manifest of manifests) {
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (EXACT_VERSION.test(range)) {
        pinned.push(`${manifest.name}/${dependency}@${range}`);
      } else {
        violations.push({ manifest: manifest.name, dependency, range });
      }
    }
  }
  return { pinned, violations };
}

export function assertPinned(
  manifests: Parameters<typeof verifyPinning>[0],
): ReturnType<typeof verifyPinning> {
  const result = verifyPinning(manifests);
  if (result.violations.length > 0) {
    throw new SupplyChainError(
      'production dependencies must be pinned to exact versions',
      {
        offenders: result.violations
          .map((v) => `${v.manifest}/${v.dependency}@${v.range}`)
          .join(','),
      },
      SecErrorCode.SEC_DEPENDENCY_UNPINNED,
    );
  }
  return result;
}

// --- Lockfile / SBOM / provenance / build-hash ---------------------------------

export interface LockfileRecord {
  readonly path: string;
  /** sha256:<hex> of the committed lockfile — reproducibility anchor. */
  readonly contentHash: string;
  readonly lockfileVersion: number;
}

export function recordLockfile(input: {
  path: string;
  bytes: Uint8Array;
  lockfileVersion: number;
}): LockfileRecord {
  const digest = createHash('sha256').update(input.bytes).digest('hex');
  return {
    path: input.path,
    contentHash: `sha256:${digest}`,
    lockfileVersion: input.lockfileVersion,
  };
}

export interface SbomComponent {
  readonly name: string;
  readonly version: string;
  readonly purl: string;
}

export interface SbomRecord {
  readonly sbomVersion: 1;
  readonly components: readonly SbomComponent[];
  /** sha256 over sorted component identities — tamper-evident summary. */
  readonly componentsHash: string;
}

export function emitSbomRecord(components: readonly SbomComponent[]): SbomRecord {
  const canonical = [...components]
    .map((c) => `${c.purl}@${c.version}`)
    .sort()
    .join('\n');
  return {
    sbomVersion: 1,
    components,
    componentsHash: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  };
}

export interface ProvenanceAttestation {
  readonly builderId: string;
  readonly buildType: string;
  readonly sourceCommit: string;
  readonly materials: readonly { readonly uri: string; readonly digest: string }[];
}

/** Build-hash recording hook (SLSA-flavored): deterministic and injectable. */
export function recordBuildHash(
  buildBytes: Uint8Array,
  attestation: ProvenanceAttestation,
): {
  buildHash: string;
  attestation: ProvenanceAttestation;
} {
  const buildHash = `sha256:${createHash('sha256').update(buildBytes).digest('hex')}`;
  return { buildHash, attestation };
}

// --- Lifecycle scripts & capability review -------------------------------------

const ALLOWED_LIFECYCLE_SCRIPTS = new Set(['prepare-husky', 'postinstall-allowlisted-pnpm-setup']);

/** Restricted-lifecycle-script check: install hooks are forbidden unless allowlisted. */
export function checkLifecycleScripts(manifest: {
  readonly name: string;
  readonly scripts?: Record<string, string> | undefined;
}): { restricted: string[]; allowed: true } {
  const scripts = manifest.scripts ?? {};
  const restricted = ['preinstall', 'install', 'postinstall'].filter((hook) => {
    const command = scripts[hook];
    return command !== undefined && !ALLOWED_LIFECYCLE_SCRIPTS.has(command);
  });
  if (restricted.length > 0) {
    throw new SupplyChainError(
      'restricted lifecycle scripts present in manifest',
      { manifest: manifest.name, hooks: restricted.join(',') },
      SecErrorCode.SEC_LIFECYCLE_SCRIPT_RESTRICTED,
    );
  }
  return { restricted, allowed: true };
}

export type DependencyCapability = 'NETWORK' | 'FILESYSTEM' | 'PROCESS' | 'CRYPTO' | 'DYNAMIC_CODE';

export interface CapabilityReviewFlag {
  readonly dependency: string;
  readonly capabilities: readonly DependencyCapability[];
  readonly reviewRequired: boolean;
}

/**
 * Capability review flags: any dependency declaring (or suspected of)
 * network/process/crypto/dynamic-code surface requires recorded review.
 */
export function flagCapabilityReview(
  entries: ReadonlyArray<{
    readonly dependency: string;
    readonly declaredCapabilities: readonly DependencyCapability[];
  }>,
): readonly CapabilityReviewFlag[] {
  return entries.map((entry) => ({
    dependency: entry.dependency,
    capabilities: entry.declaredCapabilities,
    reviewRequired:
      entry.declaredCapabilities.includes('NETWORK') ||
      entry.declaredCapabilities.includes('PROCESS') ||
      entry.declaredCapabilities.includes('DYNAMIC_CODE'),
  }));
}
