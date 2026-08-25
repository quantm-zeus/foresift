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

/**
 * SBOM record emission. Fail-closed on INCOMPLETE inventories: a component
 * missing any identity field, or an empty inventory, refuses rather than
 * emitting a summary that looks authoritative over unknown material.
 */
export function emitSbomRecord(components: readonly SbomComponent[]): SbomRecord {
  const incomplete =
    components.length === 0 ||
    components.some((c) => c.name.trim() === '' || c.version.trim() === '' || c.purl.trim() === '');
  if (incomplete) {
    throw new SupplyChainError(
      'SBOM record requires a non-empty inventory with complete component identities',
      { components: components.length },
      SecErrorCode.SEC_SBOM_RECORD_INCOMPLETE,
    );
  }
  // Name + purl + version, sorted as a MULTISET line per occurrence —
  // duplicates collapse nothing and identity is fully hashed (L13).
  const canonical = [...components]
    .map((c) => `${c.name}@${c.purl}@${c.version}`)
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

/**
 * Build-hash recording hook (SLSA-flavored): deterministic and injectable.
 * Refuses attestations missing their identifying fields — an unnamed
 * builder or commit must never anchor a recorded build hash.
 */
export function recordBuildHash(
  buildBytes: Uint8Array,
  attestation: ProvenanceAttestation,
): {
  buildHash: string;
  attestation: ProvenanceAttestation;
} {
  const incomplete =
    attestation.builderId.trim() === '' ||
    attestation.buildType.trim() === '' ||
    attestation.sourceCommit.trim() === '' ||
    attestation.materials.some((m) => m.uri.trim() === '' || m.digest.trim() === '');
  if (incomplete) {
    throw new SupplyChainError(
      'build attestation is incomplete: builder, type, commit, and materials are required',
      {},
      SecErrorCode.SEC_BUILD_ATTESTATION_INCOMPLETE,
    );
  }
  const buildHash = `sha256:${createHash('sha256').update(buildBytes).digest('hex')}`;
  return { buildHash, attestation };
}

/**
 * Fail-closed lockfile gate (M22): a deployment with NO recorded lockfile
 * has no reproducibility anchor — refused, never silently accepted.
 */
export function requireLockfile(record: LockfileRecord | null | undefined): LockfileRecord {
  if (record === undefined || record === null) {
    throw new SupplyChainError(
      'no lockfile record exists; reproducibility cannot be anchored',
      {},
      SecErrorCode.SEC_LOCKFILE_MISSING,
    );
  }
  return record;
}

// --- Lifecycle scripts & capability review -------------------------------------

const ALLOWED_LIFECYCLE_SCRIPTS = new Set(['prepare-husky', 'postinstall-allowlisted-pnpm-setup']);

/**
 * Restricted-lifecycle-script check: install/publish hooks are forbidden
 * unless their command is allowlisted. `prepare` stays admitted (it runs on
 * development installs — standard tooling such as husky — and the AC-254
 * acceptance contract pins that), while publish-time `prepack` and
 * `prepublishOnly` are restricted like the install hooks (M3).
 */
export function checkLifecycleScripts(manifest: {
  readonly name: string;
  readonly scripts?: Record<string, string> | undefined;
}): { restricted: string[]; allowed: true } {
  const scripts = manifest.scripts ?? {};
  const restricted = ['preinstall', 'install', 'postinstall', 'prepack', 'prepublishOnly'].filter(
    (hook) => {
      const command = scripts[hook];
      return command !== undefined && !ALLOWED_LIFECYCLE_SCRIPTS.has(command);
    },
  );
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
 * network / FILESYSTEM / process / CRYPTO / dynamic-code surface requires
 * recorded review — all five capabilities are review-relevant, exactly as
 * this module's contract states (M3).
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
    reviewRequired: entry.declaredCapabilities.length > 0,
  }));
}
