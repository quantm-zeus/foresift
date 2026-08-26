/**
 * License extension-point contract units (FR-CORE-008): the default source
 * refuses every unverifiable call (no allow path exists), and a composed
 * source admits only version-pinned verdicts that feed execution admission
 * AND the cache-key license component identically.
 */
import { describe, expect, it } from 'bun:test';
import { LicenseVerdictSchema } from '@foresift/shared-schemas';
import { UnverifiableRightsRefusedSource } from '../src/license-contract.ts';
import { ReferenceLicenseSource } from '../../../tests/fixtures/core/reference-adapters.ts';

describe('default license source (fail-closed)', () => {
  const source = new UnverifiableRightsRefusedSource();

  it.each(['token_security', 'token_profile'] as const)(
    'refuses %s with an unverified typed verdict',
    async (operation) => {
      const verdict = await source.verdict({
        licensePolicyId: 'rights-verified-only',
        provider: 'gmgn',
        operation,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.policyVersion).toBe('unverified');
      expect(LicenseVerdictSchema.parse(verdict)).toEqual(verdict);
    },
  );

  it('never allows for any query shape', async () => {
    for (const licensePolicyId of ['rights-verified-only', 'unknown-policy', '']) {
      const verdict = await source.verdict({ licensePolicyId, provider: 'p', operation: 'o' });
      expect(verdict.allowed).toBe(false);
    }
  });
});

describe('composed license source (version-pinned allow)', () => {
  const source = new ReferenceLicenseSource();

  it('allows only the pinned policy version', async () => {
    const allowed = await source.verdict({
      licensePolicyId: 'rights-verified-only',
      provider: 'gmgn',
      operation: 'token_security',
      requestedVersion: 'rights-1',
    });
    expect(allowed).toEqual({
      allowed: true,
      policyVersion: 'rights-1',
      reason: 'policy version pinned and verified',
    });
    const unpinned = await source.verdict({
      licensePolicyId: 'rights-verified-only',
      provider: 'gmgn',
      operation: 'token_security',
    });
    expect(unpinned.allowed).toBe(false);
  });

  it('the verdict doubles as the cache-key license component', async () => {
    const verdict = await source.verdict({
      licensePolicyId: 'rights-verified-only',
      provider: 'gmgn',
      operation: 'token_security',
      requestedVersion: 'rights-1',
    });
    // The exact-cache lookup refuses entries whose stored
    // license_policy_version differs from this component.
    expect(verdict.policyVersion).toBe('rights-1');
  });
});
