// Root-lockfile workspace-registration carve-out (live run 8f4aaa6d,
// 2026-09-04): a lane agent that touches an in-scope package legitimately
// runs `pnpm install`, and pnpm then registers the workspace importer in the
// ROOT pnpm-lock.yaml. The registration block is a mechanical mirror of the
// package's package.json (specifier `workspace:*`, version `link:../<dir>`),
// not authorship — but the guard had no carve-out for it, so
// guard-serial-1 failed deterministically with WRITE-AUTHORITY VIOLATION on
// pnpm-lock.yaml and the wave died (the same mechanical-mirror class as the
// root package.json fix, PR #63).
//
// Law under test: pnpm-lock.yaml is admitted ONLY when every change is an
// additive importer block mirroring an existing package.json; dependency
// bumps, removals, non-workspace specifiers, unknown sibling links, and
// out-of-importer edits all remain violations.
import { describe, test, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockfileWorkspaceRegistrationOnly } from '../../scripts/automation/wave-guard-lockfile.mjs';

function makeGit(root: string) {
  return (cmd: string) => {
    const r = spawnSync(`git ${cmd}`, { shell: true, cwd: root, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
  };
}

// Hermetic git fixture: packages/<dir>/package.json present at HEAD for the
// mirror check; nothing else needed.
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'lock-carve-fx-'));
  const run = (cmd: string) => {
    const r = spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture cmd failed: ${cmd}: ${r.stderr ?? r.stdout}`);
    return (r.stdout ?? '').trim();
  };
  run('git init -q');
  run('git config user.email t@t && git config user.name t');
  mkdirSync(join(root, 'packages/solana-security'), { recursive: true });
  writeFileSync(
    join(root, 'packages/solana-security/package.json'),
    JSON.stringify(
      {
        name: '@foresift/solana-security',
        dependencies: {
          '@foresift/domain': 'workspace:*',
          '@foresift/shared-schemas': 'workspace:*',
        },
      },
      null,
      2,
    ) + '\n',
  );
  run('git add -A && git commit -qm base');
  return { root, git: makeGit(root) };
}

const fixtures: Array<{ root: string }> = [];
afterEach(() => {
  for (const fx of fixtures) rmSync(fx.root, { recursive: true, force: true });
  fixtures.length = 0;
});

function fixture() {
  const fx = buildFixture();
  fixtures.push(fx);
  return fx;
}

// The exact importer-block diff shape observed live (run 8f4aaa6d, commit
// 96c6829 "chore(lockfile): record solana-security workspace importer links").
function registrationDiff(
  overrides: {
    importer?: string;
    specifier?: string;
    link?: string;
    extra?: string;
  } = {},
) {
  const importer = overrides.importer ?? 'packages/solana-security';
  const spec = overrides.specifier ?? 'workspace:*';
  const link = overrides.link ?? 'link:../domain';
  const extra = overrides.extra ?? '';
  return (
    [
      '@@ -392,6 +392,16 @@ importers:',
      '+  packages/solana-security:',
      '+    dependencies:',
      "+      '@foresift/domain':",
      '+        specifier: workspace:*',
      '+        version: link:../domain',
      "+      '@foresift/shared-schemas':",
      `+        specifier: ${spec}`,
      '+        version: link:../shared-schemas',
      '+',
      ...extra.split('\n').filter(Boolean),
      '',
    ]
      .join('\n')
      .replace('workspace:*', spec)
      .replace('link:../domain', link)
      .replace('packages/solana-security:', `${importer}:`) + '\n'
  );
}

describe('root-lockfile workspace-registration carve-out (run 8f4aaa6d regression)', () => {
  test('admits a pure additive importer block mirroring an existing package.json', () => {
    const fx = fixture();
    expect(lockfileWorkspaceRegistrationOnly(registrationDiff(), fx.root, fx.git)).toBe(true);
  });

  test('admits multi-importer registrations (several packages scaffolded)', () => {
    const fx = fixture();
    const diff = [
      '@@ -392,6 +392,14 @@ importers:',
      '+  packages/alpha:',
      '+    dependencies:',
      "+      '@foresift/domain':",
      '+        specifier: workspace:*',
      '+        version: link:../domain',
      '+',
      '+  packages/solana-security:',
      '+    dependencies:',
      "+      '@foresift/shared-schemas':",
      '+        specifier: workspace:*',
      '+        version: link:../shared-schemas',
      '+',
      '',
    ].join('\n');
    // packages/alpha does not exist in the fixture — only solana-security
    // mirrors. The unknown key must keep the whole diff a violation.
    expect(lockfileWorkspaceRegistrationOnly(diff, fx.root, fx.git)).toBe(false);
  });

  test('rejects dependency bumps outside the importers section', () => {
    const fx = fixture();
    const diff = `${registrationDiff()}@@ -900,7 +900,7 @@\n-        version: 3.25.76\n+        version: 3.26.0\n`;
    expect(lockfileWorkspaceRegistrationOnly(diff, fx.root, fx.git)).toBe(false);
  });

  test('rejects removals of existing importer content', () => {
    const fx = fixture();
    const diff = `${registrationDiff()}@@ -420,8 +420,6 @@\n-  packages/supply-confidence:\n-    dependencies:\n`;
    expect(lockfileWorkspaceRegistrationOnly(diff, fx.root, fx.git)).toBe(false);
  });

  test('rejects non-workspace specifiers (dependency authorship)', () => {
    const fx = fixture();
    expect(
      lockfileWorkspaceRegistrationOnly(registrationDiff({ specifier: '^9.9.9' }), fx.root, fx.git),
    ).toBe(false);
  });

  test('rejects links to non-existent sibling packages', () => {
    const fx = fixture();
    expect(
      lockfileWorkspaceRegistrationOnly(
        registrationDiff({ link: 'link:../not-a-package' }),
        fx.root,
        fx.git,
      ),
    ).toBe(false);
  });

  test('rejects added non-importer top-level sections', () => {
    const fx = fixture();
    const diff = `${registrationDiff({ extra: '+onlyBuiltDependencies:' })}\n`;
    expect(lockfileWorkspaceRegistrationOnly(diff, fx.root, fx.git)).toBe(false);
  });

  test('rejects an empty diff (nothing registered is not this carve-out)', () => {
    const fx = fixture();
    expect(lockfileWorkspaceRegistrationOnly('', fx.root, fx.git)).toBe(false);
  });

  test('rejects importer keys whose package.json is absent at head', () => {
    const fx = fixture();
    expect(
      lockfileWorkspaceRegistrationOnly(
        registrationDiff({ importer: 'packages/ghost-package' }),
        fx.root,
        fx.git,
      ),
    ).toBe(false);
  });
});

// ── writer-seam parity (run 38e80af1 regression, 2026-09-08) ─────────────────
// The carve-out law previously existed ONLY at the shard-guard seam
// (wave-guard.mjs). The AGY test writer's own ownership pre-flight
// (exec-agy-test-writer.mjs) re-classified the RAW changed paths with no
// carve-out, so a test lane whose `pnpm install` additively registered the
// workspace importer of a NEW package (created by an integrated
// implementation lane) was killed with AGY_PRODUCT_OWNERSHIP_VIOLATION —
// deterministically, on every retry. The law must hold at BOTH seams.
describe('writer-seam parity: AGY test lane admits a pure workspace-importer registration (run 38e80af1)', () => {
  test('the live failing diff shape passes the carve-out the writer seam now applies', () => {
    const fx = fixture();
    // Exactly the run 38e80af1 diff: packages/signal-intelligence importer
    // with four workspace links, no removals, no dependency bumps.
    const diff = [
      '@@ -434,6 +434,21 @@ importers:',
      '+  packages/signal-intelligence:',
      '+    dependencies:',
      "+      '@foresift/domain':",
      '+        specifier: workspace:*',
      '+        version: link:../domain',
      "+      '@foresift/evidence':",
      '+        specifier: workspace:*',
      '+        version: link:../evidence',
      "+      '@foresift/persistence':",
      '+        specifier: workspace:*',
      '+        version: link:../persistence',
      "+      '@foresift/shared-schemas':",
      '+        specifier: workspace:*',
      '+        version: link:../shared-schemas',
      '+',
      '',
    ].join('\n');
    // The fixture only carries packages/solana-security/package.json, so the
    // registration-only grammar itself cannot verify signal-intelligence
    // here — this test pins the WRITER-SEAM POLARITY instead: with the
    // registered package present the carve-out admits the diff, and the
    // ownership classification of the filtered path set is clean.
    mkdirSync(join(fx.root, 'packages/signal-intelligence'), { recursive: true });
    writeFileSync(
      join(fx.root, 'packages/signal-intelligence/package.json'),
      JSON.stringify(
        {
          name: '@foresift/signal-intelligence',
          dependencies: {
            '@foresift/domain': 'workspace:*',
            '@foresift/evidence': 'workspace:*',
            '@foresift/persistence': 'workspace:*',
            '@foresift/shared-schemas': 'workspace:*',
          },
        },
        null,
        2,
      ) + '\n',
    );
    fx.git(`add -A && git commit -qm "register signal-intelligence workspace importer"`);
    expect(lockfileWorkspaceRegistrationOnly(diff, fx.root, fx.git)).toBe(true);
  });

  test('a dependency bump in the lockfile is still refused at the writer seam', () => {
    const fx = fixture();
    const diff = [
      '@@ -900,7 +900,7 @@ importers:',
      '-        version: 3.25.76',
      '+        version: 3.26.0',
      '',
    ].join('\n');
    expect(lockfileWorkspaceRegistrationOnly(diff, fx.root, fx.git)).toBe(false);
  });
});
