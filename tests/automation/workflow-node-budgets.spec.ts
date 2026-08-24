import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression coverage for defect #8 (live run 14ed21bdde69, 2026-08-24): the
// gate-repair loop's `repair-targeted-recheck` bash node carried NO explicit
// timeout, so archon applied its 120 s bash default and killed the node mid
// recheck — while a single targeted TESTS-category verification measures
// ~282 s under contention on this box. The run therefore could never convert
// a successful AI repair into a green verdict; every real repair would die at
// exactly that node. Fail-closed held (no attestation, no PR), but the loop
// was structurally fail-always.
//
// Invariant pinned here: any bash node in a Foresift workflow whose body runs
// one of the heavyweight verifiers (package-targeted-verify.mjs,
// package-full-gate.mjs) MUST declare its own explicit `timeout:` of at least
// 10 minutes, so budgets are chosen deliberately instead of inheriting the
// 120 s default. Sibling evidence for right-sizing: repair-final-full and
// gate-router both carry 1800000 ms for the same verifier family.

const ROOT = join(import.meta.dirname, '../..');
const PACKAGE_WORKFLOW = join(
  ROOT,
  '.archon/workflows/foresift/foresift-work-package-optimized.yaml',
);
const WORKFLOWS = [PACKAGE_WORKFLOW];

/** Minimum deliberate budget (ms) a heavy-verifier bash node must declare. */
const MIN_HEAVY_BUDGET_MS = 600_000;
const HEAVY_VERIFIERS = /(package-targeted-verify|package-full-gate)\.mjs/;

type Block = { id: string; indent: number; body: string };

/**
 * Split workflow YAML text into node blocks by scanning `- id:` marks.
 * A block spans from its mark to the next mark at equal or shallower
 * indentation, so nested loop-body nodes become their own blocks and their
 * keys are excluded from the parent's scan range.
 */
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
    const { line, indent, id } = mark;
    let end = lines.length;
    for (let j = k + 1; j < marks.length; j++) {
      const next = marks[j];
      if (next && next.indent <= indent) {
        end = next.line;
        break;
      }
    }
    blocks.push({ id, indent, body: lines.slice(line + 1, end).join('\n') });
  }
  return blocks;
}

describe('workflow bash nodes running heavyweight verifiers declare explicit budgets', () => {
  it('gives every package-targeted-verify / package-full-gate bash node a >=10 min timeout', () => {
    const offenders: string[] = [];
    for (const file of WORKFLOWS) {
      const text = readFileSync(file, 'utf8');
      for (const block of nodeBlocks(text)) {
        // Own-level bash body only: the anchor requires a line that is
        // exactly whitespace + `bash:`, which neither `until_bash:` nor any
        // deeper nested node's content satisfies.
        const hasOwnBash = /^ *bash:/m.test(block.body);
        if (!hasOwnBash || !HEAVY_VERIFIERS.test(block.body)) continue;
        const t = block.body.match(/^ *timeout:\s*(\d+)/m);
        if (!t) {
          offenders.push(`${block.id}: no explicit timeout (inherits archon's 120 s bash default)`);
          continue;
        }
        const ms = Number(t[1]);
        if (ms < MIN_HEAVY_BUDGET_MS) {
          offenders.push(`${block.id}: timeout ${ms} ms < ${MIN_HEAVY_BUDGET_MS} ms`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the repaired repair-targeted-recheck budget at the full-gate level', () => {
    const text = readFileSync(PACKAGE_WORKFLOW, 'utf8');
    const block = nodeBlocks(text).find((b) => b.id === 'repair-targeted-recheck');
    expect(block).toBeDefined();
    expect(block?.body).toMatch(/^ *timeout:\s*1800000/m);
    // And the sibling that runs the exact-head FULL gate keeps its budget too,
    // so raising this node's did not come out of someone else's hide.
    const sibling = nodeBlocks(text).find((b) => b.id === 'repair-final-full');
    expect(sibling?.body).toMatch(/^ *timeout:\s*1800000/m);
  });
});
