/**
 * §64.3 registry construction over the signed program-support manifests.
 *
 * This is the assembly seam between the signed manifests (from
 * `@foresift/program-decoders` fixtures/providers, read-only) and the
 * `PoolMathAdapterRegistry`. It refuses `SHADOW`/`DEGRADED` manifests as
 * adapter sources and derives support state from manifest capability —
 * a DEGRADED manifest degrades its adapter automatically (FR-EXEC-021).
 */
import { AdapterSupportState, ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import type { ProgramSupportManifest } from '@foresift/shared-schemas';
import type { PoolMathAdapter } from './adapter-contract.ts';
import type { AdapterBinding } from './adapter-contract.ts';
import { PoolMathAdapterRegistry } from './adapter-contract.ts';

export function buildAdapterRegistry(
  bindings: readonly {
    readonly manifest: ProgramSupportManifest;
    readonly adapter: PoolMathAdapter;
  }[],
): PoolMathAdapterRegistry {
  const prepared: AdapterBinding[] = bindings.map((binding) => {
    const { manifest, adapter } = binding;
    if (manifest.poolMathAdapterVersion !== undefined && manifest.poolMathAdapterVersion !== adapter.version) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        manifestId: manifest.manifestId,
        manifestAdapterVersion: manifest.poolMathAdapterVersion,
        adapterVersion: adapter.version,
      });
    }
    const supportState =
      manifest.capabilityState === 'ACTIVE'
        ? AdapterSupportState.AVAILABLE
        : manifest.capabilityState === 'DEGRADED'
          ? AdapterSupportState.DEGRADED
          : AdapterSupportState.UNAVAILABLE;
    return { manifest, adapter, supportState };
  });
  return new PoolMathAdapterRegistry(prepared);
}
