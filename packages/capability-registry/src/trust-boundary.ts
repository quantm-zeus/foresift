/**
 * Export/import confinement assertions over live paths (T025, FR-PROD-006,
 * AC-279; PRD §10.3/§35.14; plan D6).
 *
 * A live path must never run heavy Alpha Lab work (pattern mining,
 * cross-fitting, replay, adversarial sweeps), never import artifacts, and never
 * call a provider. Imports flow ONLY through `@foresift/security`'s
 * `ImportGate`/`sec.import_artifacts` quarantine machine, land in
 * `VALIDATING`/`SHADOW`, and can never reach `ACTIVE` (that state does not exist
 * in the machine). Every live-path request must carry NO provider, import, or
 * decryption access.
 *
 * The assertion set is the domain `trustBoundaryVerdict`: all four kinds
 * (`NO_HEAVY_JOB`, `NO_IMPORT`, `NO_PROVIDER_CALL`, `IMPORT_SHADOW_ONLY`) must
 * appear exactly once and pass, and only `IMPORT_SHADOW_ONLY` references the
 * quarantined import artifact. A missing assertion is a refusal, not a skip.
 *
 * Strictly read-only: this module enforces that heavy/imported work cannot
 * reach production request paths; it never trades, custodies, signs, or submits.
 */
import {
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
  ArtifactBoundaryAssertionKind,
  ErrorCode,
  ForesiftError,
  artifactBoundaryHolds,
  parseActivationGateVerdict,
  parseArtifactBoundaryAssertionKind,
  trustBoundaryVerdict,
  type ArtifactBoundaryAssertion,
  type ActivationGateVerdict,
} from '@foresift/domain';
import { ImportGate } from '@foresift/security';
import { type DatabaseEngine } from '@foresift/persistence';
import type { ImportQuarantineState } from '@foresift/shared-schemas';

/** The security-owned import boundary this module consumes (never duplicates). */
export const SECURITY_IMPORT_BOUNDARY = '@foresift/security:ImportGate' as const;

/** Quarantine states an imported artifact may rest in — never ACTIVE. */
export const IMPORT_SHADOW_STATES: readonly ImportQuarantineState[] = [
  'VALIDATING',
  'SHADOW_ELIGIBLE',
];

/** The live-path privileges a confined request must NOT carry (§10.3/§35.14). */
export interface LivePathAccess {
  readonly providerCalls: boolean;
  readonly artifactImports: boolean;
  readonly decryption: boolean;
}

/** One persisted `prod.artifact_boundary_assertions` row. */
export interface ArtifactBoundaryAssertionRow {
  readonly assertionId: string;
  readonly livePath: string;
  readonly assertionKind: ArtifactBoundaryAssertionKind;
  readonly importArtifactRef: string | null;
  readonly verdict: ActivationGateVerdict;
  readonly assertedAt: string;
}

interface RawAssertionRow {
  assertion_id: string;
  live_path: string;
  assertion_kind: string;
  import_artifact_ref: string | null;
  verdict: string;
  asserted_at: unknown;
}

const toIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

function decodeAssertion(row: RawAssertionRow): ArtifactBoundaryAssertionRow {
  return {
    assertionId: row.assertion_id,
    livePath: row.live_path,
    assertionKind: parseArtifactBoundaryAssertionKind(row.assertion_kind),
    importArtifactRef: row.import_artifact_ref,
    verdict: parseActivationGateVerdict(row.verdict),
    assertedAt: toIso(row.asserted_at),
  };
}

/** Record one live-path boundary assertion (append-only). */
export async function recordArtifactBoundaryAssertion(
  engine: DatabaseEngine,
  input: {
    readonly assertionId: string;
    readonly livePath: string;
    readonly assertionKind: unknown;
    readonly importArtifactRef?: string | null;
    readonly verdict: unknown;
    readonly assertedAt: string;
  },
): Promise<ArtifactBoundaryAssertionRow> {
  const assertionKind = parseArtifactBoundaryAssertionKind(input.assertionKind);
  const verdict = parseActivationGateVerdict(input.verdict);
  const importArtifactRef = input.importArtifactRef ?? null;
  if (
    (assertionKind === ArtifactBoundaryAssertionKind.IMPORT_SHADOW_ONLY) !==
    (importArtifactRef !== null)
  ) {
    throw new ForesiftError(
      ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
      'only an IMPORT_SHADOW_ONLY assertion may reference a quarantined import artifact',
      { assertionKind, importArtifactRef },
    );
  }
  await engine.query(
    `INSERT INTO prod.artifact_boundary_assertions
       (assertion_id, live_path, assertion_kind, import_artifact_ref, verdict, asserted_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
    [
      input.assertionId,
      input.livePath,
      assertionKind,
      importArtifactRef,
      verdict,
      input.assertedAt,
    ],
  );
  return {
    assertionId: input.assertionId,
    livePath: input.livePath,
    assertionKind,
    importArtifactRef,
    verdict,
    assertedAt: input.assertedAt,
  };
}

/** Every boundary assertion for one live path. */
export async function artifactBoundaryAssertionsFor(
  engine: DatabaseEngine,
  livePath: string,
): Promise<readonly ArtifactBoundaryAssertionRow[]> {
  const result = await engine.query<RawAssertionRow>(
    `SELECT assertion_id, live_path, assertion_kind, import_artifact_ref, verdict, asserted_at
       FROM prod.artifact_boundary_assertions
      WHERE live_path = $1
      ORDER BY assertion_kind ASC, asserted_at ASC, assertion_id ASC`,
    [livePath],
  );
  return result.rows.map(decodeAssertion);
}

/** The domain boundary verdict for one live path's assertion set. */
export function livePathBoundaryVerdict(
  assertions: readonly ArtifactBoundaryAssertionRow[],
): ActivationGateVerdict {
  const domainAssertions: ArtifactBoundaryAssertion[] = assertions.map((assertion) => ({
    assertionKind: assertion.assertionKind,
    verdict: assertion.verdict,
    importArtifactRef: assertion.importArtifactRef,
  }));
  return trustBoundaryVerdict(domainAssertions);
}

/**
 * Assert the live path's boundary holds. A live path that references a heavy
 * Alpha Lab job, an artifact import, or a provider call (or that omits any
 * assertion kind) refuses — and the refusal names the violating kinds.
 */
export async function assertLivePathBoundaryHolds(
  engine: DatabaseEngine,
  livePath: string,
): Promise<readonly ArtifactBoundaryAssertionRow[]> {
  const assertions = await artifactBoundaryAssertionsFor(engine, livePath);
  const domainAssertions: ArtifactBoundaryAssertion[] = assertions.map((assertion) => ({
    assertionKind: assertion.assertionKind,
    verdict: assertion.verdict,
    importArtifactRef: assertion.importArtifactRef,
  }));
  if (!artifactBoundaryHolds(domainAssertions)) {
    const present = new Set(assertions.map((assertion) => assertion.assertionKind));
    const missing = ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS.filter((kind) => !present.has(kind));
    const failing = assertions.filter((assertion) => assertion.verdict !== 'PASS');
    throw new ForesiftError(
      ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
      'a live path must not reach a heavy job, artifact import, or provider call (§10.3/§35.14)',
      {
        livePath,
        missingAssertionKinds: missing.join(', '),
        failingAssertionIds: failing.map((assertion) => assertion.assertionId).join(', '),
      },
    );
  }
  return assertions;
}

/** Refuse any live-path request that carries provider/import/decryption access. */
export function assertNoLivePathPrivileges(access: LivePathAccess, livePath = 'live-path'): void {
  const violations = (['providerCalls', 'artifactImports', 'decryption'] as const).filter(
    (capability) => access[capability] === true,
  );
  if (violations.length > 0) {
    throw new ForesiftError(
      ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
      `a live-path request must not carry ${violations.join(', ')} access (§10.3/§35.14)`,
      { livePath, violations: violations.join(', ') },
    );
  }
}

/** The consumed security import gate (reads only; this module never parses). */
function importGate(engine: DatabaseEngine): ImportGate {
  return new ImportGate({
    engine,
    trustedProducers: [],
    verifier: () => false,
  });
}

/**
 * Assert an imported artifact reached `VALIDATING`/`SHADOW` only and has no
 * direct-activation path. The artifact is read through the security
 * `ImportGate` (the single owner of the quarantine machine); `ACTIVE` is not a
 * member of that machine and refuses.
 */
export async function assertImportedArtifactShadowOnly(
  engine: DatabaseEngine,
  artifactId: string,
): Promise<ImportQuarantineState> {
  const artifact = await importGate(engine).getArtifact(artifactId);
  const state = artifact.state;
  if (!IMPORT_SHADOW_STATES.includes(state)) {
    throw new ForesiftError(
      ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
      `imported artifact ${artifactId} is ${state}; imports may rest only in VALIDATING/SHADOW and never ACTIVE`,
      { artifactId, state, boundary: SECURITY_IMPORT_BOUNDARY },
    );
  }
  return state;
}

/** True when an `IMPORT_SHADOW_ONLY` assertion references a quarantined import. */
export async function importShadowAssertionHolds(
  engine: DatabaseEngine,
  assertionId: string,
): Promise<boolean> {
  const result = await engine.query<RawAssertionRow>(
    `SELECT assertion_id, live_path, assertion_kind, import_artifact_ref, verdict, asserted_at
       FROM prod.artifact_boundary_assertions WHERE assertion_id = $1`,
    [assertionId],
  );
  const row = result.rows[0];
  if (row === undefined) return false;
  const assertion = decodeAssertion(row);
  if (
    assertion.assertionKind !== ArtifactBoundaryAssertionKind.IMPORT_SHADOW_ONLY ||
    assertion.importArtifactRef === null ||
    assertion.verdict !== 'PASS'
  ) {
    return false;
  }
  const state = await assertImportedArtifactShadowOnly(engine, assertion.importArtifactRef);
  return IMPORT_SHADOW_STATES.includes(state);
}
