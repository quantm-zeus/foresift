// Scaffold smoke: proves the workspace wiring (package.json exports, tsconfig
// project references, bun test runner) resolves the package entrypoint. The
// substantive per-module suites land alongside their modules (T114+).
import { describe, expect, it } from 'bun:test';

describe('@foresift/providers scaffold', () => {
  it('resolves the package entrypoint', async () => {
    const entry = await import('../src/index.ts');
    expect(entry).toBeDefined();
  });
});
