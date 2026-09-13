/**
 * @foresift/capability-registry — read-only production-readiness governance
 * (FR-PROD-001…006, PRD §32, §33.7, §40, §69.2–§69.12).
 *
 * This scaffold (slice T001–T013) ships the package wiring plus the PGlite
 * `prod`-family migration-shape suite. The governed-state registry
 * (`module-states.ts`), the total fail-closed activation gate
 * (`activation-gate.ts`), the dependency-group build-order view
 * (`dependency-groups.ts`), the declared SLA/best-effort posture
 * (`deployment-posture.ts`), the MCP compatibility matrix (`mcp-compat.ts`),
 * the bounded precomputed-alpha contract (`precomputed-alpha.ts`), the isolated
 * import trust boundary (`trust-boundary.ts`), and containment/rollback
 * (`containment.ts`) land in T014–T018.
 *
 * Strictly read-only: nothing in this package can trade, hold custody, sign,
 * handle private keys, or submit a transaction. Activation, promotion,
 * containment, and rollback are governance records over already-approved
 * read-only behavior, never execution.
 */

/** Package scaffold marker; the governed-state surface replaces this in T018. */
export const CAPABILITY_REGISTRY_SCAFFOLD = true as const;
