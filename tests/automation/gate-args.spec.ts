import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGateArgs } from '../../scripts/automation/schema.mjs';

// Regression coverage for the live package-gate failure of 2026-08-23: the
// gate-router then invoked `pnpm foresift:gate -- --package <id>`; pnpm v11
// forwarded the bare `--` separator verbatim into the shell command, and node
// passed it through to process.argv — so the gate's parser counted the
// separator as an unexpected positional and failed closed with a usage error
// (exit 2) BEFORE any verification check ran. ADR-0007 normalized the call
// sites to the separator-free form (`pnpm foresift:gate --package <id>`, the
// form now documented in AUTOPILOT.md and the workflow YAML); the parser
// retains tolerance for a forwarded separator so any stale caller still
// reaches verification instead of a usage error.

const GATE = join(import.meta.dirname, '../../scripts/automation/foresift-gate.mjs');

describe('parseGateArgs', () => {
  it('accepts the workflow invocation form with the forwarded -- separator', () => {
    const args = parseGateArgs(['--', '--package', 'g0-contracts-data-truth']);
    expect(args.package).toBe('g0-contracts-data-truth');
    expect(args._).toEqual([]);
  });

  it('accepts the direct invocation form without a separator', () => {
    expect(parseGateArgs(['--package', 'g0-x']).package).toBe('g0-x');
  });

  it('parses the milestone flag with and without a separator', () => {
    expect(parseGateArgs(['--milestone']).milestone).toBe(true);
    expect(parseGateArgs(['--', '--milestone']).milestone).toBe(true);
  });

  it('still collects unknown positionals so the caller can fail closed', () => {
    const args = parseGateArgs(['junk', '--', '--package', 'g0-x']);
    expect(args.package).toBe('g0-x');
    expect(args._).toEqual(['junk']);
  });

  it('yields an undefined package when --package has no value', () => {
    expect(parseGateArgs(['--package']).package).toBeUndefined();
  });
});

describe('foresift-gate argument contract (fail-closed, pre-verification exits)', () => {
  it('gets past argument parsing for the exact live invocation shape', () => {
    // A nonexistent package id proves the separator no longer trips the usage
    // guard: the gate must reach package lookup and fail with the
    // package-not-in-milestone block, not the usage error.
    const res = spawnSync(process.execPath, [GATE, '--', '--package', 'definitely-not-a-package'], {
      encoding: 'utf8',
    });
    expect(res.stderr).toMatch(/not in current milestone/);
    expect(res.stderr).not.toMatch(/^usage:/m);
  });

  it('still rejects unexpected positional arguments with the usage error', () => {
    const res = spawnSync(process.execPath, [GATE, 'junk', '--', '--package', 'g0-x'], {
      encoding: 'utf8',
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/^usage:/m);
  });

  it('still rejects a missing package/milestone selection with the usage error', () => {
    const res = spawnSync(process.execPath, [GATE], { encoding: 'utf8' });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/^usage:/m);
  });
});
