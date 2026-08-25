import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideWriterEngine, emitEngineFiles } from '../../scripts/automation/exec-agy-writer.mjs';

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const dir = mkdtempSync(join(tmpdir(), 'agy-engine-'));

describe('hybrid writer-engine decision (V4 §25/§30)', () => {
  it('defaults to CLAUDE without opt-in', () => {
    expect(decideWriterEngine('shard-1', { env: {}, hasAgy: true })).toBe('CLAUDE');
    expect(decideWriterEngine('shard-1', { env: { FORESIFT_AGY_LANES: '' }, hasAgy: true })).toBe(
      'CLAUDE',
    );
  });

  it('routes AGY only with BOTH opt-in and a runnable binary', () => {
    const env = { FORESIFT_AGY_LANES: 'shard-1, shard-2' };
    expect(decideWriterEngine('shard-1', { env, hasAgy: true })).toBe('AGY');
    expect(decideWriterEngine('shard-2', { env, hasAgy: true })).toBe('AGY');
    // fail closed: opted in but binary missing ⇒ CLAUDE
    expect(decideWriterEngine('shard-1', { env, hasAgy: false })).toBe('CLAUDE');
  });

  it('never routes the serial core lane to AGY, even when listed', () => {
    const env = { FORESIFT_AGY_LANES: 'core' };
    expect(decideWriterEngine('core', { env, hasAgy: true })).toBe('CLAUDE');
    expect(decideWriterEngine('', { env, hasAgy: true })).toBe('CLAUDE');
  });
});

describe('engine-file emission (prep-time routing tokens)', () => {
  const graphWithShards = join(dir, 'g1.json');
  writeFileSync(graphWithShards, JSON.stringify({ shards: [{ id: 'core' }, { id: 'shard-1' }] }));
  const graphCoreOnly = join(dir, 'g2.json');
  writeFileSync(graphCoreOnly, JSON.stringify({ shards: [{ id: 'core' }] }));

  it('emits CLAUDE by default for present lanes', () => {
    const out = emitEngineFiles(graphWithShards, dir);
    expect(out).toEqual({ 'shard-1': 'CLAUDE', 'shard-2': 'NO SHARD-2 THIS WAVE' });
    expect(readFileSync(join(dir, 'engine-shard-1.txt'), 'utf8')).toBe('CLAUDE');
  });

  it('empty lanes carry the EXACT brief-emitter sentinel so both engines stay off', () => {
    emitEngineFiles(graphCoreOnly, dir);
    // equality with the brief emitters' literal is load-bearing: the writer
    // gates key on these tokens to keep empty waves at zero AI dispatch.
    expect(readFileSync(join(dir, 'engine-shard-1.txt'), 'utf8')).toBe('NO SHARD-1 THIS WAVE');
    expect(readFileSync(join(dir, 'engine-shard-2.txt'), 'utf8')).toBe('NO SHARD-2 THIS WAVE');
  });

  it('opt-in with binary routes AGY into the engine file', () => {
    process.env.FORESIFT_AGY_LANES = 'shard-1';
    try {
      const out = emitEngineFiles(graphWithShards, dir, ['shard-1'], { hasAgy: true });
      expect(out['shard-1']).toBe('AGY');
    } finally {
      delete process.env.FORESIFT_AGY_LANES;
    }
  });
});
