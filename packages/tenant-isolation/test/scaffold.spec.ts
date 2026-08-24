// Scaffold smoke: proves the workspace wiring (package.json exports, tsconfig
// project references, vitest runner) resolves the package entrypoint. The
// substantive per-module suites land alongside their modules.
import { describe, expect, it } from 'vitest';
import { TENANT_ISOLATION_PACKAGE } from '../src/index.ts';

describe('@foresift/tenant-isolation scaffold', () => {
  it('resolves the package entrypoint', () => {
    expect(TENANT_ISOLATION_PACKAGE).toBe('@foresift/tenant-isolation');
  });
});
