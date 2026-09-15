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
import { appendSafe } from './shadow-safe.ts';
import {
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
  ArtifactBoundaryAssertionKind,
  ErrorCode,
  ForesiftError,
  artifactBoundaryHolds,
  isOneOf,
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
export const IMPORT_SHADOW_STATES: readonly ImportQuarantineState[] = Object.freeze([
  'VALIDATING',
  'SHADOW_ELIGIBLE',
]);

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
  return decodeAssertionRows(result.rows);
}

/** Numeric-index decode of an assertion result set; never `rows.map(...)`. */
function decodeAssertionRows(rows: readonly RawAssertionRow[]): ArtifactBoundaryAssertionRow[] {
  const decoded: ArtifactBoundaryAssertionRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined) appendSafe(decoded, decodeAssertion(row));
  }
  return decoded;
}

/** Project assertion rows onto the domain boundary shape by numeric index. */
function toDomainAssertions(
  assertions: readonly ArtifactBoundaryAssertionRow[],
): ArtifactBoundaryAssertion[] {
  const domainAssertions: ArtifactBoundaryAssertion[] = [];
  for (let index = 0; index < assertions.length; index += 1) {
    const assertion = assertions[index];
    if (assertion === undefined) continue;
    appendSafe(domainAssertions, {
      assertionKind: assertion.assertionKind,
      verdict: assertion.verdict,
      importArtifactRef: assertion.importArtifactRef,
    });
  }
  return domainAssertions;
}

/** The domain boundary verdict for one live path's assertion set. */
export function livePathBoundaryVerdict(
  assertions: readonly ArtifactBoundaryAssertionRow[],
): ActivationGateVerdict {
  return trustBoundaryVerdict(toDomainAssertions(assertions));
}

/**
 * Assert the live path's boundary holds. A live path that references a heavy
 * Alpha Lab job, an artifact import, or a provider call (or that omits any
 * assertion kind) refuses — and the refusal names the violating kinds.
 *
 * Every `IMPORT_SHADOW_ONLY` assertion is additionally RESOLVED through the
 * security `ImportGate` (audit H4): the referenced artifact must exist and must
 * currently rest in `VALIDATING`/`SHADOW_ELIGIBLE`. A caller-supplied
 * `verdict:'PASS'` row that names a `RECEIVED`/`REJECTED`/unknown artifact
 * therefore refuses instead of passing on the caller's word.
 */
export async function assertLivePathBoundaryHolds(
  engine: DatabaseEngine,
  livePath: string,
): Promise<readonly ArtifactBoundaryAssertionRow[]> {
  const assertions = await artifactBoundaryAssertionsFor(engine, livePath);
  const domainAssertions = toDomainAssertions(assertions);
  if (!artifactBoundaryHolds(domainAssertions)) {
    const present = new Set<string>();
    const failingAssertionIds: string[] = [];
    // Numeric-index loops only (audit NEW-M4): the refusal message must not be
    // influenced by a shadowed `map`/`filter`.
    for (let assertionIndex = 0; assertionIndex < assertions.length; assertionIndex += 1) {
      const assertion = assertions[assertionIndex];
      if (assertion === undefined) continue;
      present.add(assertion.assertionKind);
      if (assertion.verdict !== 'PASS') appendSafe(failingAssertionIds, assertion.assertionId);
    }
    const missing: string[] = [];
    for (
      let kindIndex = 0;
      kindIndex < ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS.length;
      kindIndex += 1
    ) {
      const kind = ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS[kindIndex] as string;
      if (!present.has(kind)) appendSafe(missing, kind);
    }
    throw new ForesiftError(
      ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
      'a live path must not reach a heavy job, artifact import, or provider call (§10.3/§35.14)',
      {
        livePath,
        missingAssertionKinds: missing.join(', '),
        failingAssertionIds: failingAssertionIds.join(', '),
      },
    );
  }
  // Quarantine state is checked BEFORE the live path is authorized (H4).
  const gate = importGate(engine);
  // Numeric-index walk only (audit HIGH): a shadowed `Symbol.iterator` skipped
  // this loop entirely, so the H4 artifact quarantine check never ran.
  for (let assertionIndex = 0; assertionIndex < assertions.length; assertionIndex += 1) {
    const assertion = assertions[assertionIndex];
    if (assertion === undefined) continue;
    if (assertion.assertionKind !== ArtifactBoundaryAssertionKind.IMPORT_SHADOW_ONLY) continue;
    const artifactId = assertion.importArtifactRef;
    if (artifactId === null) {
      throw new ForesiftError(
        ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
        `IMPORT_SHADOW_ONLY assertion ${assertion.assertionId} names no import artifact`,
        { livePath, assertionId: assertion.assertionId },
      );
    }
    let artifact;
    try {
      artifact = await gate.getArtifact(artifactId);
    } catch {
      throw new ForesiftError(
        ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
        `IMPORT_SHADOW_ONLY assertion ${assertion.assertionId} references unknown import artifact ${artifactId}`,
        { livePath, assertionId: assertion.assertionId, artifactId },
      );
    }
    const state = artifact.state as ImportQuarantineState;
    if (!isOneOf(state, IMPORT_SHADOW_STATES)) {
      throw new ForesiftError(
        ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
        `imported artifact ${artifactId} is ${state}; imports may rest only in VALIDATING/SHADOW and never ACTIVE`,
        {
          livePath,
          assertionId: assertion.assertionId,
          artifactId,
          state,
          boundary: SECURITY_IMPORT_BOUNDARY,
        },
      );
    }
  }
  return assertions;
}

/** Refuse any live-path request that carries provider/import/decryption access. */
export function assertNoLivePathPrivileges(access: LivePathAccess, livePath = 'live-path'): void {
  const capabilities = ['providerCalls', 'artifactImports', 'decryption'] as const;
  const violations: string[] = [];
  // Numeric-index walk: a shadowed `Array.prototype.filter` returning `[]` must
  // not be able to erase a live-path privilege (audit NEW-M4).
  for (let index = 0; index < capabilities.length; index += 1) {
    const capability = capabilities[index] as (typeof capabilities)[number];
    if (access[capability] === true) appendSafe(violations, capability);
  }
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
  if (!isOneOf(state, IMPORT_SHADOW_STATES)) {
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
  return isOneOf(state, IMPORT_SHADOW_STATES);
}
