/** @requirement FR-TRACE-006 @acceptance AC-269 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface SbomComponent {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly type: 'npm';
}

export interface SbomProjection {
  readonly bomFormat: 'CycloneDX';
  readonly specVersion: '1.5';
  readonly components: readonly SbomComponent[];
  readonly inventoryHash: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function packageCoordinate(key: string): { name: string; version: string } | undefined {
  const coordinate = unquote(key).replace(/:$/, '');
  const separator = coordinate.lastIndexOf('@');
  if (separator <= 0 || separator === coordinate.length - 1) return undefined;
  const name = coordinate.slice(0, separator);
  const version = coordinate.slice(separator + 1).replace(/\(.+$/, '');
  return name && version ? { name, version } : undefined;
}

/**
 * Projects the lockfile package snapshots without a YAML runtime dependency. Only the stable
 * package key and its content integrity participate; importer layout and timestamps do not.
 */
export async function generateSbomFromLockfile(lockfilePath: string): Promise<SbomProjection> {
  const source = await readFile(lockfilePath, 'utf8');
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const packagesStart = lines.findIndex((line) => line === 'packages:');
  if (packagesStart < 0) throw new Error('pnpm lockfile has no packages section');

  const components: SbomComponent[] = [];
  for (let index = packagesStart + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^[^\s]/.test(line) && line.endsWith(':')) break;
    const match = line.match(/^  (.+):$/);
    if (!match) continue;
    const coordinate = packageCoordinate(match[1]!);
    if (!coordinate) continue;

    let integrity = '';
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const detail = lines[cursor]!;
      if (/^  \S/.test(detail) || /^[^\s]/.test(detail)) break;
      const integrityMatch = detail.match(/integrity:\s*([^,}\s]+)/);
      if (integrityMatch) {
        integrity = integrityMatch[1]!;
        break;
      }
    }
    components.push({ ...coordinate, integrity, type: 'npm' });
  }

  components.sort((left, right) =>
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version) ||
    left.integrity.localeCompare(right.integrity),
  );
  const canonicalInventory = JSON.stringify(components);
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    components,
    inventoryHash: sha256(canonicalInventory),
  };
}
