/**
 * Canonical precomputed-alpha and artifact-boundary fixtures (T033,
 * FR-PROD-006, AC-279; PRD §33.7/§10.3/§35.14).
 *
 * Inert typed data: bounded, unbounded, and ceiling-exceeding live-path
 * envelopes; complete boundary assertion sets; and import-referencing /
 * heavy-job-violating sets.
 */
import type { ArtifactBoundaryAssertion } from '@foresift/domain';
import type {
  LivePathBoundClaim,
  LivePathPrecomputationClaim,
} from '@foresift/release-conformance';
import { PROD_FIXTURE_FAR_FUTURE, PROD_FIXTURE_HASH_A, PROD_FIXTURE_NOW } from './gate-inputs.ts';

export const PROD_LIVE_PATH = 'live-path://candidate-discovery';

/** A fully-bounded, unexpired envelope. */
export const PROD_PRECOMPUTED_BOUND_BOUNDED: LivePathBoundClaim = {
  artifactSetHash: PROD_FIXTURE_HASH_A,
  maxCandidates: 500,
  maxRows: 10_000,
  maxEdges: 50_000,
  maxLatencyMs: 250,
  maxCostUsd: 5,
  expiresAt: PROD_FIXTURE_FAR_FUTURE,
};

/** No positive ceilings at all — the law refuses it instead of treating it unbounded-allow. */
export const PROD_PRECOMPUTED_BOUND_UNBOUNDED: LivePathBoundClaim = {
  artifactSetHash: PROD_FIXTURE_HASH_A,
  maxCandidates: 0,
  maxRows: 0,
  maxEdges: 0,
  maxLatencyMs: 0,
  maxCostUsd: 0,
  expiresAt: PROD_FIXTURE_FAR_FUTURE,
};

/** An envelope whose freshness window already closed. */
export const PROD_PRECOMPUTED_BOUND_EXPIRED: LivePathBoundClaim = {
  ...PROD_PRECOMPUTED_BOUND_BOUNDED,
  expiresAt: '2020-01-01T00:00:00Z',
};

/** A request within every declared ceiling. */
export const PROD_PRECOMPUTED_REQUEST_WITHIN = {
  candidates: 10,
  rows: 100,
  edges: 200,
  latencyMs: 20,
  costUsd: 0.1,
} as const;

/** A request that exceeds the row ceiling. */
export const PROD_PRECOMPUTED_REQUEST_EXCEEDING = {
  candidates: 10,
  rows: 1_000_000,
  edges: 200,
  latencyMs: 20,
  costUsd: 0.1,
} as const;

/** The complete, passing boundary assertion set (imports stay shadow-only). */
export const PROD_BOUNDARY_ASSERTIONS_COMPLETE: readonly ArtifactBoundaryAssertion[] = [
  { assertionKind: 'NO_HEAVY_JOB', verdict: 'PASS', importArtifactRef: null },
  { assertionKind: 'NO_IMPORT', verdict: 'PASS', importArtifactRef: null },
  { assertionKind: 'NO_PROVIDER_CALL', verdict: 'PASS', importArtifactRef: null },
  {
    assertionKind: 'IMPORT_SHADOW_ONLY',
    verdict: 'PASS',
    importArtifactRef: 'import-artifact-prod-1',
  },
];

/** A live path that reaches a heavy Alpha Lab job / cannot assert NO_IMPORT. */
export const PROD_BOUNDARY_ASSERTIONS_IMPORT_REFERENCING: readonly ArtifactBoundaryAssertion[] = [
  { assertionKind: 'NO_HEAVY_JOB', verdict: 'PASS', importArtifactRef: null },
  { assertionKind: 'NO_IMPORT', verdict: 'REFUSE', importArtifactRef: null },
  { assertionKind: 'NO_PROVIDER_CALL', verdict: 'PASS', importArtifactRef: null },
  {
    assertionKind: 'IMPORT_SHADOW_ONLY',
    verdict: 'PASS',
    importArtifactRef: 'import-artifact-prod-1',
  },
];

/** A live path missing a required boundary assertion entirely. */
export const PROD_BOUNDARY_ASSERTIONS_MISSING: readonly ArtifactBoundaryAssertion[] =
  PROD_BOUNDARY_ASSERTIONS_COMPLETE.slice(0, 3);

/** A bounded, compliant live path. */
export const PROD_LIVE_PATH_BOUNDED_CLAIM: LivePathPrecomputationClaim = {
  livePath: PROD_LIVE_PATH,
  bound: PROD_PRECOMPUTED_BOUND_BOUNDED,
  request: PROD_PRECOMPUTED_REQUEST_WITHIN,
  now: PROD_FIXTURE_NOW,
  boundaryAssertions: PROD_BOUNDARY_ASSERTIONS_COMPLETE,
  artifactRef: 'artifact-prod-1',
};

/** A live path with no envelope at all. */
export const PROD_LIVE_PATH_NO_BOUND_CLAIM: LivePathPrecomputationClaim = {
  ...PROD_LIVE_PATH_BOUNDED_CLAIM,
  bound: null,
};

/** A live path whose request exceeds a declared ceiling. */
export const PROD_LIVE_PATH_EXCEEDING_CLAIM: LivePathPrecomputationClaim = {
  ...PROD_LIVE_PATH_BOUNDED_CLAIM,
  request: PROD_PRECOMPUTED_REQUEST_EXCEEDING,
};

/** A live path whose boundary assertions do not hold. */
export const PROD_LIVE_PATH_IMPORT_CLAIM: LivePathPrecomputationClaim = {
  ...PROD_LIVE_PATH_BOUNDED_CLAIM,
  boundaryAssertions: PROD_BOUNDARY_ASSERTIONS_IMPORT_REFERENCING,
};

export const PROD_LIVE_PATH_CLAIMS: readonly LivePathPrecomputationClaim[] = [
  PROD_LIVE_PATH_BOUNDED_CLAIM,
  PROD_LIVE_PATH_NO_BOUND_CLAIM,
  PROD_LIVE_PATH_EXCEEDING_CLAIM,
  PROD_LIVE_PATH_IMPORT_CLAIM,
];
