/**
 * Alert fixture corpus barrel (T027).
 *
 * Consumers import from this barrel only: `tests/fixtures/alerts/index.ts`.
 *
 * PATH ALIAS NOTE: the requirements manifest's `fixtureRef` for this slice is
 * the singular `tests/fixtures/alert/`, while the milestone `writeScopes` grant
 * the plural `tests/fixtures/alerts/**`. The plural path is authoritative for
 * this package; the acceptance suites import this barrel and nothing else.
 *
 * The corpus is inert typed data plus total builders: no network, no database,
 * no clock, no credentials, no real secrets. Every content address is a
 * deterministic local placeholder.
 */
export * from './common.ts';
export * from './gates.ts';
export * from './policies.ts';
export * from './classification.ts';
export * from './content.ts';
export * from './lifecycle.ts';
export * from './fingerprints.ts';
export * from './metrics.ts';
