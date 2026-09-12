/**
 * @foresift/alerts — read-only alert classification, content, policy, and
 * lifecycle (FR-ALERT-001…005, PRD §26).
 *
 * Strictly read-only: nothing in this package can trade, hold custody, sign,
 * handle private keys, or submit a transaction. Alert classification and
 * content are pure data transformations; transactional commit and exactly-once
 * delivery stay owned by `@foresift/workflow-runtime` (§26.5).
 *
 * Slice T001–T011 ships the vocabulary, schema, and migration substrate
 * (`packages/domain/src/alert.ts`, `packages/shared-schemas/src/alert.ts`, and
 * the `alert` migration family). The classification/policy/content/lifecycle
 * modules export through this barrel as later tasks land.
 */
export {};
