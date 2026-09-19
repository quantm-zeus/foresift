import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson } from '@foresift/persistence';

export interface SbomComponent {
  readonly type: 'library';
  readonly name: string;
  readonly version: string;
  readonly hashes: readonly { readonly alg: string; readonly content: string }[];
}
export interface DeterministicSbom {
  readonly bomFormat: 'CycloneDX';
  readonly specVersion: '1.5';
  readonly version: 1;
  readonly components: readonly SbomComponent[];
  readonly componentInventoryHash: string;
}

const sha256 = (text: string): string =>
  `sha256:${createHash('sha256').update(text).digest('hex')}`;

/** Parse only pnpm's stable `packages:` keys and integrity values; no YAML runtime is needed. */
export function projectPnpmLockToSbom(lockText: string): DeterministicSbom {
  const packageSection =
    lockText.split(/\npackages:\s*\n/u)[1]?.split(/\nsnapshots:\s*\n/u)[0] ?? '';
  const lines = packageSection.split(/\r?\n/);
  const components: SbomComponent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^  (?:'([^']+)'|([^']+?))\s*:\s*$/.exec(lines[index] ?? '');
    if (match === null) continue;
    const key = match[1] ?? match[2] ?? '';
    const splitAt = key.lastIndexOf('@');
    if (splitAt <= 0) continue;
    const name = key.slice(0, splitAt);
    const version = key.slice(splitAt + 1);
    let integrity = '';
    for (
      let cursor = index + 1;
      cursor < lines.length && !/^  (?:'[^']+'|[^ '][^:]*?)\s*:/.test(lines[cursor] ?? '');
      cursor += 1
    ) {
      integrity = /integrity:\s*([^,}\s]+)/.exec(lines[cursor] ?? '')?.[1] ?? integrity;
    }
    const hashes =
      integrity === ''
        ? [{ alg: 'SHA-256', content: sha256(key).slice(7) }]
        : [
            {
              alg: integrity.split('-')[0]?.toUpperCase() ?? 'SHA-512',
              content: integrity.split('-').slice(1).join('-'),
            },
          ];
    components.push({ type: 'library', name, version, hashes });
  }
  components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const inventory = components.map(({ name, version, hashes }) => ({ name, version, hashes }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    components,
    componentInventoryHash: sha256(canonicalJson(inventory)),
  };
}

export async function buildSbom(lockPath = 'pnpm-lock.yaml'): Promise<DeterministicSbom> {
  return projectPnpmLockToSbom(await readFile(lockPath, 'utf8'));
}

export const generateSbom = projectPnpmLockToSbom;
