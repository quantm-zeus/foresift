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
import {
  appendSafe,
  numericFilter,
  numericJoin,
  numericMap,
  numericSome,
  numericSortStrings,
  snapshotCallerInput,
} from './shadow-safe.ts';

// --- Pinning -------------------------------------------------------------------

const EXACT_VERSION = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/** Production dependencies must be pinned to EXACT versions. */
export function verifyPinning(
  rawManifests: ReadonlyArray<{
    readonly name: string;
    readonly dependencies?: Record<string, string> | undefined;
  }>,
): { pinned: string[]; violations: { manifest: string; dependency: string; range: string }[] } {
  // Single-read binding (V7 accessor class): the range classified as pinned and
  // the range recorded in the violation must be the SAME read.
  const manifests = snapshotCallerInput(rawManifests);
  const pinned: string[] = [];
  const violations: { manifest: string; dependency: string; range: string }[] = [];
  for (let manifestIndex = 0; manifestIndex < manifests.length; manifestIndex += 1) {
    const manifest = manifests[manifestIndex] as {
      readonly name: string;
      readonly dependencies?: Record<string, string> | undefined;
    };
    const dependencies = Object.entries(manifest.dependencies ?? {});
    for (let entryIndex = 0; entryIndex < dependencies.length; entryIndex += 1) {
      const dependencyEntry = dependencies[entryIndex] as [string, string];
      const dependency = dependencyEntry[0];
      const range = dependencyEntry[1];
      if (EXACT_VERSION.test(range)) {
        appendSafe(pinned, `${manifest.name}/${dependency}@${range}`);
      } else {
        appendSafe(violations, { manifest: manifest.name, dependency, range });
      }
    }
  }
  return { pinned, violations };
}

export function assertPinned(
  rawManifests: Parameters<typeof verifyPinning>[0],
): ReturnType<typeof verifyPinning> {
  // Single-read binding (V7 accessor class).
  const manifests = snapshotCallerInput(rawManifests);
  const result = verifyPinning(manifests);
  if (result.violations.length > 0) {
    throw new SupplyChainError(
      'production dependencies must be pinned to exact versions',
      {
        offenders: numericJoin(
          numericMap(result.violations, (v) => `${v.manifest}/${v.dependency}@${v.range}`),
        ),
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

export function recordLockfile(rawInput: {
  path: string;
  bytes: Uint8Array;
  lockfileVersion: number;
}): LockfileRecord {
  // Single-read binding (V7 accessor class): the hashed bytes, path and
  // version must come from one read.
  const input = snapshotCallerInput(rawInput);
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
export function emitSbomRecord(rawComponents: readonly SbomComponent[]): SbomRecord {
  // Single-read binding (V7 accessor class): completeness, the hashed identity
  // set and the returned inventory must all be the same read.
  const components = snapshotCallerInput(rawComponents);
  const incomplete =
    components.length === 0 ||
    numericSome(
      components,
      (c) => c.name.trim() === '' || c.version.trim() === '' || c.purl.trim() === '',
    );
  if (incomplete) {
    throw new SupplyChainError(
      'SBOM record requires a non-empty inventory with complete component identities',
      { components: components.length },
      SecErrorCode.SEC_SBOM_RECORD_INCOMPLETE,
    );
  }
  // Name + purl + version, sorted as a MULTISET line per occurrence —
  // duplicates collapse nothing and identity is fully hashed (L13).
  const canonical = numericJoin(
    numericSortStrings(numericMap(components, (c) => `${c.name}@${c.purl}@${c.version}`)),
    '\n',
  );
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
  rawBuildBytes: Uint8Array,
  rawAttestation: ProvenanceAttestation,
): {
  buildHash: string;
  attestation: ProvenanceAttestation;
} {
  // Single-read binding (V7 accessor class): the completeness check, the hashed
  // bytes and the returned attestation must observe one read each.
  const buildBytes = snapshotCallerInput(rawBuildBytes);
  const attestation = snapshotCallerInput(rawAttestation);
  const incomplete =
    attestation.builderId.trim() === '' ||
    attestation.buildType.trim() === '' ||
    attestation.sourceCommit.trim() === '' ||
    numericSome(attestation.materials, (m) => m.uri.trim() === '' || m.digest.trim() === '');
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
export function requireLockfile(rawRecord: LockfileRecord | null | undefined): LockfileRecord {
  // Single-read binding (V7 accessor class); null/undefined pass through.
  const record = snapshotCallerInput(rawRecord);
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
export function checkLifecycleScripts(rawManifest: {
  readonly name: string;
  readonly scripts?: Record<string, string> | undefined;
}): { restricted: string[]; allowed: true } {
  // Single-read binding (V7 accessor class): the restricted-hook decision and
  // the refusal detail must observe the same manifest.
  const manifest = snapshotCallerInput(rawManifest);
  const scripts = manifest.scripts ?? {};
  const restrictedHooks = ['preinstall', 'install', 'postinstall', 'prepack', 'prepublishOnly'];
  const restricted = numericFilter(restrictedHooks, (hook) => {
    const command = scripts[hook];
    return command !== undefined && !ALLOWED_LIFECYCLE_SCRIPTS.has(command);
  });
  if (restricted.length > 0) {
    throw new SupplyChainError(
      'restricted lifecycle scripts present in manifest',
      { manifest: manifest.name, hooks: numericJoin(restricted) },
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
  rawEntries: ReadonlyArray<{
    readonly dependency: string;
    readonly declaredCapabilities: readonly DependencyCapability[];
  }>,
): readonly CapabilityReviewFlag[] {
  // Single-read binding (V7 accessor class): the review flag is derived from the
  // same capability list that is returned.
  const entries = snapshotCallerInput(rawEntries);
  return numericMap(entries, (entry) => ({
    dependency: entry.dependency,
    capabilities: entry.declaredCapabilities,
    reviewRequired: entry.declaredCapabilities.length > 0,
  }));
}
