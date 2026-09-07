/**
 * @foresift/execution-simulator — read-only execution modeling (§64).
 *
 * Surface map:
 *  - scenario identity, pre-registration, hash pinning (scenario.ts)
 *  - action-delay distributions and the robust-delay gate (delays.ts)
 *  - §64.6 entry fills / §64.7 exits (entry.ts, exit.ts)
 *  - §64.9 net-return composition + §8.2 outcome classification
 *    (net-return.ts, outcome.ts)
 *  - §64.13 executable-target law, FR-EXEC-007 tradability gate,
 *    §64.15/FR-EXEC-020 uncertainty (target-touch.ts, tradability.ts,
 *    uncertainty.ts)
 *  - FR-EXEC-019 concurrent shadow aggregation, FR-EXEC-022 point-in-time
 *    route selection (concurrency.ts, routes.ts)
 *  - FR-EXEC-010 frozen replay manifests, FR-EXEC-009 experiment registry,
 *    §64.14/FR-EXEC-011 observation plans (replay-manifest.ts,
 *    experiments.ts, observation-plans.ts)
 *  - §64.10/FR-EXEC-012/017 stress matrix (stress.ts)
 *  - FR-EXEC-021 degradation ledger (degradation.ts)
 *  - FR-EXEC-008 alert content + §64.16 structural read-only guard
 *    (alert-content.ts, read-only-guard.ts)
 *
 * The package models execution; it never executes. No build/sign/broadcast/
 * submit/recommend surface exists (FR-EXEC-005) — see read-only-guard.ts.
 */

export * from './scenario.ts';
export * from './delays.ts';
export * from './entry.ts';
export * from './exit.ts';
export * from './net-return.ts';
export * from './outcome.ts';
export * from './target-touch.ts';
export * from './tradability.ts';
export * from './uncertainty.ts';
export * from './concurrency.ts';
export * from './routes.ts';
export * from './replay-manifest.ts';
export * from './experiments.ts';
export * from './observation-plans.ts';
export * from './stress.ts';
export * from './degradation.ts';
export * from './alert-content.ts';
export * from './read-only-guard.ts';
