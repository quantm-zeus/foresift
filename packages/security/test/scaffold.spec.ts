// Scaffold smoke: proves the workspace wiring (package.json exports, tsconfig
// project references, vitest runner) resolves the package entrypoint. The
// substantive per-module suites land alongside their modules.
import { describe, expect, it } from 'vitest';
import { SecErrorCode } from '../src/errors.ts';

describe('@foresift/security scaffold', () => {
  it('exposes the typed security error-code vocabulary', () => {
    expect(SecErrorCode.SEC_AUDIT_CHAIN_VERIFICATION_FAILED).toBe(
      'SEC_AUDIT_CHAIN_VERIFICATION_FAILED',
    );
  });
});
