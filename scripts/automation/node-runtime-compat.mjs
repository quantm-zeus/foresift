#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const checks = [];
function check(name, condition) {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(`NODE_RUNTIME_COMPAT_FAILED: ${name}`);
}

check('node-major-24', Number(process.versions.node.split('.')[0]) === 24);
check('buffer-roundtrip', Buffer.from('foresift').toString('utf8') === 'foresift');
check('crypto-sha256', createHash('sha256').update('foresift').digest('hex').length === 64);
check('crypto-random', randomBytes(16).length === 16);
const chunks = [];
for await (const chunk of Readable.from(['fore', 'sift'])) chunks.push(chunk);
check('node-stream', chunks.join('') === 'foresift');
const dir = mkdtempSync(join(tmpdir(), 'foresift-node-compat-'));
try {
  const file = join(dir, 'roundtrip.txt');
  writeFileSync(file, 'node-24');
  check('node-fs', readFileSync(file, 'utf8') === 'node-24');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(import.meta.url.startsWith("file:")?"ok":"bad")'], {
  encoding: 'utf8',
});
check('node-esm-child-process', child.status === 0 && child.stdout === 'ok');
process.stdout.write(JSON.stringify({ schema: 'foresift/node-runtime-compat@1', passed: true, checks }) + '\n');
