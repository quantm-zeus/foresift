/**
 * @foresift/capability-registry — read-only production-readiness governance
 * (FR-PROD-001…006, PRD §32, §33.7, §40, §69.2–§69.12).
 *
 * Public surface:
 *   - `module-states.ts`      — scope-exact, append-only IMPLEMENTED/AVAILABLE/
 *                               PROVEN registry and the governed transition log;
 *   - `activation-gate.ts`    — ONE total, ordered, fail-closed gate consuming
 *                               release-conformance evidence, capacity-planner
 *                               capacity laws, and registered statistical/
 *                               distribution evidence;
 *   - `dependency-groups.ts`  — §40 G0…G7 build/test ordering (never activation);
 *   - `containment.ts`        — smallest-scope containment, explicit revalidation,
 *                               and additive rollback;
 *   - `deployment-posture.ts` — SLA-backed vs free-tier best-effort posture and
 *                               the protected-dimension law;
 *   - `mcp-compat.ts`         — §69.7 revision×client compatibility matrix;
 *   - `precomputed-alpha.ts`  — bounded §33.7 live-path precomputed lookups;
 *   - `trust-boundary.ts`     — §10.3/§35.14 export/import confinement assertions.
 *
 * Strictly read-only: nothing in this package can trade, hold custody, sign,
 * handle private keys, or submit a transaction. Activation, promotion,
 * containment, and rollback are governance records over already-approved
 * read-only behaviour, never execution.
 */
export * from './module-states.ts';
export * from './activation-gate.ts';
export * from './dependency-groups.ts';
export * from './containment.ts';
export * from './deployment-posture.ts';
export * from './mcp-compat.ts';
export * from './precomputed-alpha.ts';
export * from './trust-boundary.ts';
