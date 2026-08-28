// Bun is the authoritative runner; this dependency-free shape is loadable by
// release-conformance Vitest probes without changing package test authority.
export default { test: { include: ['test/**/*.spec.ts'] } };
