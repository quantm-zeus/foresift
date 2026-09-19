/**
 * Private conformance-result provenance brand (HIGH-3).
 *
 * `buildReleaseReport` previously certified `activationState.status === 'ACTIVE'`
 * from ANY caller-supplied conformance result whose counts were internally
 * self-consistent, so a caller could hand-build
 * `{overall:'PASSED', totalRulesEvaluated:42, passedCount:42, failureCount:0,
 * findings:[]}` and drive a release to ACTIVE without ever running the gate.
 *
 * `evaluateConformance` is now the ONLY writer of this brand: it adds the frozen
 * result object it returns to a module-private `WeakSet`. `buildReleaseReport`
 * requires the brand before a supplied result can contribute to ACTIVE, and an
 * unbranded / hand-built / structurally-cloned result fails closed with a
 * `CONFORMANCE_UNVERIFIED` finding.
 *
 * The brand is keyed by OBJECT IDENTITY, not shape: `structuredClone`,
 * `{...result}`, `JSON.parse(JSON.stringify(result))` and any hand-built object
 * are new objects and therefore unbranded. `brandAuthoritativeConformanceResult`
 * is intentionally NOT re-exported from the package entrypoint (only the
 * read-only guard is), so product code cannot mint the brand.
 */
const AUTHORITATIVE_CONFORMANCE_RESULTS = new WeakSet<object>();

/**
 * Mint the provenance brand for the object `evaluateConformance` returns. Kept
 * package-internal (not re-exported from `index.ts`); only the authoritative
 * evaluator calls it.
 */
export function brandAuthoritativeConformanceResult<T extends object>(result: T): T {
  AUTHORITATIVE_CONFORMANCE_RESULTS.add(result);
  return result;
}

/**
 * The read-only brand guard: true only for an object actually returned by
 * `evaluateConformance` in THIS process. A hand-built, spread, JSON-round-tripped
 * or `structuredClone`d copy is a distinct object and returns false.
 */
export function isAuthoritativeConformanceResult(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && AUTHORITATIVE_CONFORMANCE_RESULTS.has(value)
  );
}
