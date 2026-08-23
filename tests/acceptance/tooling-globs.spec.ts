import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Config-shape acceptance test (tasks T001/T002, foundation for FR-DATA-001…006
 * and FR-DR-001…002): root tooling configuration must be glob-driven so later G0
 * workspace packages are picked up with ZERO root-config edits.
 *
 * This spec reads the real root configs and asserts their glob shapes cover a
 * synthetic future package path. It intentionally does not edit any config.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const readRoot = (name: string): string => readFileSync(join(REPO_ROOT, name), 'utf8');

/**
 * Minimal glob matcher supporting exactly what the root tsconfig include list
 * uses: literal path segments, `*` (any run of characters within one segment),
 * and `**` spanning segment boundaries.
 */
function globToRegExp(glob: string): RegExp {
  let source = '';
  let i = 0;
  while (i < glob.length) {
    const rest = glob.slice(i);
    if (rest.startsWith('**')) {
      // `**/` matches zero or more whole segments; bare trailing `**` matches everything.
      if (glob[i + 2] === '/') {
        source += '(?:[^/]+/)*';
        i += 3;
      } else {
        source += '.*';
        i += 2;
      }
    } else if (glob[i] === '*') {
      source += '[^/]*';
      i += 1;
    } else {
      const ch = glob[i];
      if (ch === undefined) break;
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function tsconfigIncludeGlobs(): string[] {
  const raw = readRoot('tsconfig.json');
  const parsed = JSON.parse(raw) as { include?: unknown; exclude?: unknown };
  if (!Array.isArray(parsed.include)) throw new Error('root tsconfig.json has no include array');
  return parsed.include.map((g) => {
    if (typeof g !== 'string') throw new Error('non-string tsconfig include entry');
    return g;
  });
}

/** A package that does not exist yet — later G0 packages land exactly like this. */
const SYNTHETIC_FUTURE_PACKAGE_PATHS = [
  'packages/some-future-g0-package/src/index.ts',
  'packages/some-future-g0-package/src/repos/deep/nested/module.ts',
  'packages/some-future-g0-package/test/unit/thing.spec.ts',
  'tests/acceptance/AC-999.spec.ts',
  'tests/negative/AC-999.negative.spec.ts',
] as const;

describe('root tooling is glob-driven for future packages', () => {
  it('root tsconfig.json include globs pick up synthetic future package sources and tests', () => {
    const globs = tsconfigIncludeGlobs();
    const compiled = globs.map((g) => ({ glob: g, re: globToRegExp(g) }));

    for (const path of SYNTHETIC_FUTURE_PACKAGE_PATHS) {
      const matched = compiled.some(({ re }) => re.test(path));
      expect(matched, `path ${path} not covered by any include glob`).toBe(true);
    }
  });

  it('root tsconfig.json excludes build output and dependencies', () => {
    const parsed = JSON.parse(readRoot('tsconfig.json')) as { exclude?: unknown };
    expect(Array.isArray(parsed.exclude)).toBe(true);
    const exclude = (parsed.exclude as string[]).map((e) => e.toLowerCase());
    expect(exclude).toContain('node_modules');
    expect(exclude).toContain('dist');
  });

  it('pnpm-workspace.yaml covers every future packages/* directory', () => {
    const yaml = readRoot('pnpm-workspace.yaml');
    const entries = yaml
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim());
    expect(entries).toContain('packages/*');
    expect(entries).toContain('apps/*');
  });

  it('eslint flat config applies TypeScript rules via unrestricted **/*.ts globs', () => {
    const config = readRoot('eslint.config.js');
    // The flat config must not enumerate package dirs; a global pattern proves
    // new packages are linted with zero edits.
    expect(config).toContain("'**/*.ts'");
    expect(config).not.toContain("'packages/domain/**'");
    expect(config).not.toContain("'packages/persistence/**'");
  });
});
