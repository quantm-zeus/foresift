// Package entrypoint — the permanent read-only security perimeter
// (FR-SEC-001…012). Every module here is a fail-closed policy primitive;
// transport wiring (HTTP 403s, session stores, OAuth server) belongs to the
// mcp-surface package, which consumes these verdicts.
export * from './errors.ts';
export * from './audit-categories.ts';
export * from './audit-chain.ts';
export * from './incidents.ts';
export * from './gate-pause.ts';
export * from './csrf.ts';
export * from './action-gate.ts';
export * from './mcp-origin.ts';
export * from './mcp-protocol-guard.ts';
export * from './oauth-binding.ts';
export * from './mcp-credentials.ts';
