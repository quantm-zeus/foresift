import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for defect #10 (live run dc67e884, 2026-08-24): the
// convergence judge died on "produced no assistant output — the provider
// stream closed without yielding content". Archon's retry classification
// treats that message as UNKNOWN (it matches no TRANSIENT pattern like
// timeout/429/econnreset), and UNKNOWN errors are only retried when a node
// explicitly declares `on_error: all`. With no retry stanza, one silent
// provider hiccup killed an otherwise fully green run (review approved,
// FULL gate passed, PR open) at its judge node.
//
// Invariant pinned here: every provider-backed node (`prompt:` or
// `command:`) in a Foresift work-package workflow MUST declare an explicit
// retry stanza with `on_error: all` and >= 2 attempts, chosen deliberately
// instead of inheriting the default classification. FATAL patterns (auth,
// permission) still take priority inside archon, so this never retries
// non-retryable failures.

const ROOT = join(import.meta.dirname, '../..');
const WORKFLOWS = [
  join(ROOT, '.archon/workflows/foresift/foresift-work-package-optimized.yaml'),
  join(ROOT, '.archon/workflows/foresift/foresift-work-package.yaml'),
];

type Block = { id: string; body: string };

/** Split workflow YAML text into node blocks by scanning `- id:` marks; each
 * block extends to the next mark at equal or shallower indentation. */
function nodeBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const marks: { line: number; indent: number; id: string }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)- id: (\S+)/);
    const indentText = m?.[1];
    const id = m?.[2];
    if (indentText && id) marks.push({ line: i, indent: indentText.length, id });
  });
  const blocks: Block[] = [];
  for (let k = 0; k < marks.length; k++) {
    const mark = marks[k];
    if (!mark) continue;
    let end = lines.length;
    for (let j = k + 1; j < marks.length; j++) {
      const next = marks[j];
      if (next && next.indent <= mark.indent) {
        end = next.line;
        break;
      }
    }
    blocks.push({ id: mark.id, body: lines.slice(mark.line + 1, end).join('\n') });
  }
  return blocks;
}

describe('provider-backed workflow nodes declare explicit retries (defect #10)', () => {
  for (const file of WORKFLOWS) {
    it(`gives every prompt/command node in ${file.split('/').pop()} on_error: all with >=2 attempts`, () => {
      const text = readFileSync(file, 'utf8');
      const offenders: string[] = [];
      for (const block of nodeBlocks(text)) {
        // Provider-backed = own-level `prompt:` or `command:` key. The anchor
        // requires whitespace + key, so `until_bash:` and nested content do
        // not count.
        const isProviderBacked = /^ *(prompt|command):/m.test(block.body);
        if (!isProviderBacked) continue;
        const retryBlock = block.body.match(/^ *retry:\n((?: .*~?\n?)*)/m);
        if (!retryBlock) {
          offenders.push(`${block.id}: no explicit retry stanza`);
          continue;
        }
        const cfg = retryBlock[1] ?? '';
        const attempts = cfg.match(/max_attempts:\s*(\d+)/)?.[1];
        const mode = cfg.match(/on_error:\s*(\w+)/)?.[1];
        if (!attempts || Number(attempts) < 2)
          offenders.push(`${block.id}: retry.max_attempts missing or < 2`);
        if (mode !== 'all')
          offenders.push(
            `${block.id}: retry.on_error must be "all" (default transient classification misses empty-stream UNKNOWN failures)`,
          );
      }
      expect(offenders).toEqual([]);
    });
  }
});
