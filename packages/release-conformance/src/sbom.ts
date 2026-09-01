/** Deterministic, dependency-free projection of a pnpm v9 lockfile. @requirement FR-TRACE-006 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function splitPackageLocator(locator: string): { name: string; version: string } | undefined {
  const withoutPeerSuffix = locator.replace(/\(.+\)$/, '');
  const separator = withoutPeerSuffix.lastIndexOf('@');
  if (separator <= 0) return undefined;
  return {
    name: withoutPeerSuffix.slice(0, separator),
    version: withoutPeerSuffix.slice(separator + 1),
  };
}

/**
 * Pnpm's lockfile is YAML, but the package inventory uses a deliberately tiny,
 * stable subset: keys below `packages:` plus their optional integrity value.
 * Parsing that subset avoids making release verification depend on a YAML library.
 */
export async function generateSbomFromLockfile(lockfilePath: string): Promise<SbomProjection> {
  const text = await readFile(lockfilePath, 'utf8');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const components: SbomComponent[] = [];
  let inPackages = false;
  let current: SbomComponent | undefined;

  const finish = (): void => {
    if (current) components.push(current);
    current = undefined;
  };

  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^[A-Za-z][^:]*:\s*$/.test(line)) break;

    const packageKey = line.match(/^  ['"]?(.+?)['"]?:\s*$/);
    if (packageKey) {
      finish();
      const parsed = splitPackageLocator(packageKey[1]);
      if (parsed) current = { ...parsed, integrity: '', type: 'npm' };
      continue;
    }
    const integrity = line.match(/^\s+integrity:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (current && integrity) current = { ...current, integrity: integrity[1] };
  }
  finish();

  const unique = new Map<string, SbomComponent>();
  for (const component of components) {
    const normalized = component.integrity
      ? component
      : { ...component, integrity: `sha256:${sha256(`${component.name}@${component.version}`)}` };
    unique.set(`${normalized.name}\0${normalized.version}\0${normalized.integrity}`, normalized);
  }
  const sorted = [...unique.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version) ||
      left.integrity.localeCompare(right.integrity),
  );
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    components: sorted,
    inventoryHash: sha256(JSON.stringify(sorted)),
  };
}
