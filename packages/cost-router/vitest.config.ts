// Kept dependency-free because this workspace executes package tests with Bun.
// The shape is also understood by Vitest when a release-conformance runner loads it.
export default { test: { include: ['test/**/*.spec.ts'] } };
