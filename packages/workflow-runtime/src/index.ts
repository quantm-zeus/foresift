/**
 * `@foresift/workflow-runtime` — durable, read-only workflow substrate
 * (FR-WF-001…008, PRD §25).
 *
 * Engine-core public surface (slice 2, T012–T017, T019):
 * - `scheduler-port.ts`   — `SchedulerPort`, local/QStash adapters, and the
 *                           HMAC/replay delivery trust boundary (ADR-G2WF-2).
 * - `trigger-inbox.ts`    — canonicalization, idempotent inbox insert,
 *                           schedule/version resolution, exactly-one-run
 *                           creation (AC-010).
 * - `schedules.ts`        — immutable versioned CRUD and the §25.11 control
 *                           actions, including the §33.6 forecast-before-enable
 *                           gate (AC-013, AC-014, AC-063).
 * - `steps.ts`            — §25.4 step order and §25.5 checkpoint read/write
 *                           with per-run idempotency keys.
 * - `leases.ts`           — §25.7 fenced acquire/release/commit-compare over
 *                           `wf.step_leases` (AC-012).
 * - `retries.ts`          — the §25.8 taxonomy as an executable policy.
 *
 * Lifecycle public surface (slice 3, T020–T026):
 * - `outbox.ts`           — the §26.5 atomic decision/alert/outbox commit
 *                           boundary and the crash-safe claim/deliver workers
 *                           (AC-011, AC-061).
 * - `channels.ts`         — `NotificationChannelPort` (idempotent by key) and
 *                           the deterministic fake channel (§26.6/§26.9).
 * - `shadow.ts`           — the single shadow-influence choke point (FR-WF-008).
 * - `dead-letters.ts`     — actionable dead letters and safe retry from the
 *                           last valid checkpoint (FR-WF-007).
 * - `reconciliation.ts`   — the §25.10 database-vs-scheduler diff, incidents,
 *                           and safe-direction repair (FR-WF-005).
 * - `verify-state.ts`     — read-only inbox/outbox/lease/dead-letter checks;
 *                           the recovery-package drill seam (AC-062/AC-260…264).
 *
 * Strictly read-only: this package must never gain trading, custody,
 * wallet-signing, private-key, or transaction-submission capability.
 */
export * from './scheduler-port.ts';
export * from './trigger-inbox.ts';
export * from './schedules.ts';
export * from './steps.ts';
export * from './leases.ts';
export * from './retries.ts';
export * from './channels.ts';
export * from './shadow.ts';
export * from './outbox.ts';
export * from './dead-letters.ts';
export * from './reconciliation.ts';
export * from './verify-state.ts';
