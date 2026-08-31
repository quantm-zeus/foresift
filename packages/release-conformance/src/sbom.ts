import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@foresift/persistence';
export interface SbomComponent {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly type: 'npm' | 'workspace';
}
export interface SbomProjection {
  readonly bomFormat: 'CycloneDX';
  readonly specVersion: '1.5';
  readonly components: readonly SbomComponent[];
  readonly inventoryHash: string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function generateSbomFromLockfile(lockfilePath: string): SbomProjection {
  const text = readFileSync(lockfilePath, 'utf8');
  const section = text.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0] ?? '';
  const lines = section.split(/\r?\n/);
  const components: SbomComponent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^  '([^']+)':$/.exec(lines[i]!) ?? /^  ([^\s][^:]+):$/.exec(lines[i]!);
    if (!match) continue;
    const key = match[1]!;
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const name = key.slice(0, at),
      version = key.slice(at + 1);
    let integrity = '';
    for (
      let j = i + 1;
      j < Math.min(lines.length, i + 8) && !/^  (?:'[^']+'|[^\s][^:]+):$/.test(lines[j]!);
      j++
    ) {
      const found = /integrity:\s*([^},\s]+)/.exec(lines[j]!);
      if (found) {
        integrity = found[1]!;
        break;
      }
    }
    components.push({ name, version, integrity: integrity || `sha256:${hash(key)}`, type: 'npm' });
  }
  components.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version) ||
      a.integrity.localeCompare(b.integrity),
  );
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    components,
    inventoryHash: hash(canonicalJson(components)),
  };
}
