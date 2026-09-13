/**
 * Typed loaders for the PROD fixture corpus (T033).
 *
 * Consumers import from this barrel only: `tests/fixtures/prod/index.ts`.
 * Fixtures are inert typed data plus small deterministic builders — no network,
 * no credentials (the gate-evidence pepper is an obvious local-test
 * placeholder).
 */
export * from './gate-inputs.ts';
export * from './module-states.ts';
export * from './activation-gates.ts';
export * from './dependency-groups.ts';
export * from './posture.ts';
export * from './mcp-matrix.ts';
export * from './precomputed.ts';
export * from './containment.ts';
export * from './distribution.ts';
