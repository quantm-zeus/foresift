/**
 * @foresift/alerts — read-only alert lifecycle: per-class policies, the
 * deterministic §26.3 confirmed-opportunity gates, classification, class-
 * templated content, and the thin adapter over the engine's §26.5 commit
 * boundary (FR-ALERT-001…005, PRD §26).
 *
 * Slice T001–T011 shipped the vocabulary, schema, and migration substrate
 * (`packages/domain/src/alert.ts`, `packages/shared-schemas/src/alert.ts`, and
 * the `alert` migration family). This barrel exposes the classification/policy/
 * content/commit surface (T012–T016) and the fingerprint/update/expiry/metrics
 * surface (T019–T023).
 *
 * Strictly read-only: nothing in this package can trade, hold custody, sign,
 * handle private keys, or submit a transaction. Alert classification and
 * content are pure data transformations; transactional commit and exactly-once
 * delivery stay owned by `@foresift/workflow-runtime` (§26.5).
 */
export * from './policies.ts';
export * from './gates.ts';
export * from './classification.ts';
export * from './content.ts';
export * from './fingerprints.ts';
export * from './commit.ts';
export * from './lifecycle.ts';
export * from './monitoring.ts';
export * from './metrics.ts';
