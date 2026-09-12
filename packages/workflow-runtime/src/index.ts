/**
 * `@foresift/workflow-runtime` — durable, read-only workflow substrate
 * (FR-WF-001…008, PRD §25).
 *
 * This barrel documents the module seams the following slices fill in. It
 * exports nothing yet: the first slice (T001–T011, T018) lands only the domain
 * vocabularies, the Zod mirrors, the `wf` SQL schema, and this package
 * scaffold. Every module below is a named seam, not an implementation.
 *
 * Module seams (planned paths under `src/`):
 * - `trigger-inbox.ts`   — external-message canonicalization, idempotent inbox
 *                          insert, active-schedule/version resolution,
 *                          exactly-one-run creation (AC-010).
 * - `schedules.ts`       — immutable versioned CRUD and the §25.11 control
 *                          actions, including the §33.6 forecast-before-enable
 *                          gate (AC-013, AC-014, AC-063).
 * - `steps.ts`           — §25.5 checkpoint read/write and per-run
 *                          idempotency-key enforcement.
 * - `leases.ts`          — §25.7 fenced acquire/release/compare over
 *                          `wf.step_leases` (AC-012).
 * - `retries.ts`         — the §25.8 taxonomy as an executable policy.
 * - `outbox.ts`          — §26.5 atomic decision/alert/outbox commit plus
 *                          lease-claimed exactly-once delivery (AC-011).
 * - `dead-letters.ts`    — exhaustion, actionable context, and safe
 *                          retry-from-last-valid-checkpoint.
 * - `reconciliation.ts`  — database-vs-scheduler diff and incidents (§25.10).
 * - `shadow.ts`          — shadow-run guard: no opportunity influence
 *                          (FR-WF-008).
 * - `scheduler-port.ts`  — the only scheduler seam (ADR-G2WF-2).
 * - `channels.ts`        — notification channel port plus a test fake.
 * - `verify-state.ts`    — read-only consistency queries for recovery drills.
 *
 * Strictly read-only: this package must never gain trading, custody,
 * wallet-signing, private-key, or transaction-submission capability.
 */
export {};
