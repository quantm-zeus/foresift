// Incident B (2026-09-10): after the OOM kill, the watcher respawned a bare
// `claude --resume ...` into a tmux pane whose PATH excludes ~/.local/bin
// (Claude lives at ~/.local/bin/claude) — the pane died 127 and the watcher
// failed. Regressions (hermetic: stubbed tmux/pgrep, scrubbed PATH without
// ~/.local/bin, fake HOME):
//   - every spawn path (new-session, dead-pane respawn, live-pane send-keys)
//     uses a validated ABSOLUTE binary: $CLAUDE_BIN > PATH > $HOME/.local/bin;
//   - with no binary anywhere the watcher fails LOUD (exit 1 + FATAL log)
//     instead of spawning a corpse pane;
//   - no spawn line ever carries a bare `claude` command again (static tripwire).
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCHER = join(repoRoot, 'scripts', 'automation', 'maintainer-watcher.sh');

const SESSION_ID = 'sess-hermetic-1';

let FX = '';

function writeStub(path: string, body: string) {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  FX = mkdtempSync(join(tmpdir(), 'maintainer-watcher-'));
  const fakebin = join(FX, 'fakebin');
  mkdirSync(fakebin, { recursive: true });
  // tmux stub: records argv, emulates session/pane state via env. The
  // watcher invokes `tmux -L <socket> <subcommand>`, so the stub shifts past
  // the -L pair before dispatching on the real subcommand.
  writeStub(
    join(fakebin, 'tmux'),
    `echo "tmux $*" >> "$TMUX_STUB_LOG"
if [ "$1" = "-L" ]; then shift 2; fi
case "$1" in
  has-session) exit "\${TMUX_STUB_HAS_SESSION:-1}" ;;
  display-message) printf '%s' "\${TMUX_STUB_PANE_DEAD:-1}"; exit 0 ;;
  new-session|respawn-pane|send-keys) exit 0 ;;
  *) exit 0 ;;
esac`,
  );
  // pgrep stub: first call reports absence (no live maintainer), later calls
  // report presence (the launched Claude materialized) — deterministic, no
  // races, and the watcher's 5s verification sleep bounds each launch test.
  writeStub(
    join(fakebin, 'pgrep'),
    `n=$(cat "$PGREP_COUNT" 2>/dev/null || echo 0)
echo $((n + 1)) > "$PGREP_COUNT"
[ "$n" -ge 1 ] && exit 0 || exit 1`,
  );
  const home = join(FX, 'home');
  mkdirSync(join(home, '.local', 'state', 'foresift', 'maintainer'), { recursive: true });
  mkdirSync(join(home, 'repo', 'specs', 'implementation'), { recursive: true });
  writeFileSync(
    join(home, '.local', 'state', 'foresift', 'maintainer', 'receipt.json'),
    JSON.stringify({
      currentClaudeSessionId: SESSION_ID,
      intentionalStop: false,
      repo: join(home, 'repo'),
    }),
  );
  writeFileSync(
    join(home, 'repo', 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify({ packages: [{ id: 'g1-outcome-evaluation', status: 'RUNNING' }] }),
  );
});

afterEach(() => {
  try {
    rmSync(FX, { recursive: true, force: true });
  } catch {}
});

function plantClaude(home: string) {
  const dir = join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'claude');
  writeStub(bin, 'echo "fake claude $*"');
  return bin;
}

function runWatcher(opts: { home: string; extraEnv?: Record<string, string> }) {
  const tmuxLog = join(FX, 'tmux.log');
  const env: Record<string, string> = {
    // Scrubbed PATH: /usr/bin:/bin carry jq/grep/flock/date/sleep/id/tmux
    // but NEVER ~/.local/bin — the Incident B condition.
    PATH: `${join(FX, 'fakebin')}:/usr/bin:/bin`,
    HOME: opts.home,
    TMUX_STUB_LOG: tmuxLog,
    PGREP_COUNT: join(FX, 'pgrep.count'),
    FORESIFT_MAINTAINER_WATCHER_LOCK: join(FX, 'watcher.lock'),
    FORESIFT_MAINTAINER_TMUX_SOCKET: 'hermetic-test-socket',
    ...(opts.extraEnv ?? {}),
  };
  const r = spawnSync('/bin/bash', [WATCHER], { encoding: 'utf8', env });
  const logPath = join(opts.home, '.local', 'state', 'foresift', 'maintainer', 'watcher.log');
  return {
    status: r.status,
    stderr: r.stderr ?? '',
    tmuxLog: existsSync(tmuxLog) ? readFileSync(tmuxLog, 'utf8') : '',
    watcherLog: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '',
  };
}

describe('maintainer watcher CLAUDE_BIN durability (Incident B)', () => {
  // Launch-path tests ride the watcher's 5s post-launch verification sleep —
  // beyond bun's 5s default per-test timeout.
  const LAUNCH_TIMEOUT = { timeout: 30000 };

  test('new-session uses the absolute $HOME/.local/bin fallback when PATH lacks claude', () => {
    const home = join(FX, 'home');
    const bin = plantClaude(home);
    const r = runWatcher({ home });
    expect(r.status).toBe(0);
    expect(r.tmuxLog).toContain('new-session');
    expect(r.tmuxLog).toContain(`${bin} --resume ${SESSION_ID}`);
    // a bare spawn would read `"claude --resume`; the absolute form reads
    // `"/abs/.../claude --resume` — the quoted-bare form must be absent.
    expect(r.tmuxLog).not.toContain('"claude --resume');
    // the fresh-session path exits immediately after spawning (nothing to
    // verify yet) — the log names the resolved binary for auditability.
    expect(r.watcherLog).toContain(
      `recreated tmux foresift-maintainer resuming ${SESSION_ID} via ${bin}`,
    );
  });

  test('dead-pane respawn uses the absolute binary, not a bare claude', LAUNCH_TIMEOUT, () => {
    const home = join(FX, 'home');
    const bin = plantClaude(home);
    const r = runWatcher({
      home,
      extraEnv: { TMUX_STUB_HAS_SESSION: '0', TMUX_STUB_PANE_DEAD: '1' },
    });
    expect(r.status).toBe(0);
    expect(r.tmuxLog).toContain('respawn-pane');
    expect(r.tmuxLog).toContain(`${bin} --resume ${SESSION_ID}`);
    expect(r.watcherLog).toContain('respawned dead pane');
  });

  test('live-pane send-keys types the absolute binary, not a bare claude', LAUNCH_TIMEOUT, () => {
    const home = join(FX, 'home');
    const bin = plantClaude(home);
    const r = runWatcher({
      home,
      extraEnv: { TMUX_STUB_HAS_SESSION: '0', TMUX_STUB_PANE_DEAD: '0' },
    });
    expect(r.status).toBe(0);
    expect(r.tmuxLog).toContain('send-keys');
    expect(r.tmuxLog).toContain(`${bin} --resume ${SESSION_ID}`);
    expect(r.watcherLog).toContain('relaunched claude');
  });

  test('explicit CLAUDE_BIN wins over the HOME fallback', () => {
    const home = join(FX, 'home');
    plantClaude(home);
    const customDir = join(FX, 'custombin');
    mkdirSync(customDir, { recursive: true });
    const custom = join(customDir, 'claude');
    writeStub(custom, 'echo "custom claude $*"');
    const r = runWatcher({ home, extraEnv: { CLAUDE_BIN: custom } });
    expect(r.status).toBe(0);
    expect(r.tmuxLog).toContain(`${custom} --resume ${SESSION_ID}`);
    expect(r.tmuxLog).not.toContain(join(home, '.local', 'bin', 'claude'));
  });

  test('fail LOUD with no spawn attempt when no binary resolves anywhere', () => {
    const home = join(FX, 'home'); // no .local/bin/claude planted, CLAUDE_BIN unset
    const r = runWatcher({ home });
    expect(r.status).toBe(1);
    expect(r.watcherLog).toMatch(/FATAL: no executable claude binary/);
    expect(r.tmuxLog).toBe(''); // never attempted a spawn
  });

  test('static tripwire: every tmux spawn line resolves through CLAUDE_BIN_RESOLVED', () => {
    // join backslash continuations so multi-line spawns read as one line
    const text = readFileSync(WATCHER, 'utf8').replace(/\\\n\s*/g, ' ');
    const spawnLines = text
      .split('\n')
      .filter((l) => /new-session|respawn-pane|send-keys/.test(l) && /--resume/.test(l));
    expect(spawnLines.length).toBeGreaterThan(0);
    for (const l of spawnLines) expect(l).toContain('CLAUDE_BIN_RESOLVED');
    // any remaining bare `claude --resume` occurrence must be a liveness
    // PATTERN (pgrep substring match on the full cmdline, which the absolute
    // binary still satisfies) or a log string — never a spawned command.
    const bare = text
      .split('\n')
      .filter((l) => l.includes('claude --resume') && !l.includes('CLAUDE_BIN'));
    for (const l of bare) expect(l).toMatch(/pgrep|^[^a-z]*note /);
  });
});
