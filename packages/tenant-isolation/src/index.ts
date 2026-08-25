// Package entrypoint — tenant-isolation primitives (FR-SEC-009): tenant
// context, fail-closed row scoping, tenant-bound signed URLs, and
// cross-tenant resource-access authorization for all eleven isolated surfaces.
export const TENANT_ISOLATION_PACKAGE = '@foresift/tenant-isolation';
export * from './errors-reexport.ts';
export * from './tenant-context.ts';
export * from './row-scope.ts';
export * from './signed-url.ts';
export * from './resource-access.ts';
