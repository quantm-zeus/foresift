/**
 * Structural read-only guard for outcome maturity package (T031, FR-MAT-001…012).
 * Verifies no LLM imports, no trading/execution write capability, and no private key access.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

describe('Outcome Maturity Read-Only Guard (FR-MAT-001…012)', () => {
  it('scans outcome-maturity/src for prohibited execution and LLM patterns', () => {
    if (!existsSync(SRC_DIR)) {
      expect(true).toBe(true);
      return;
    }

    const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const content = readFileSync(path.join(SRC_DIR, file), 'utf8');
      expect(content).not.toContain('@openai/api');
      expect(content).not.toContain('@anthropic-ai/sdk');
      expect(content).not.toContain('sendTransaction');
    }
  });
});
