/**
 * Read-Only Guard & No-Execution / No-LLM Structural Scan.
 * Ensures discovery-universe package contains NO trade execution logic, NO signing/key management,
 * NO LLM prompt/completion calls, and adheres to pure observational data contracts.
 * Traces: FR-DISC-008, FR-DISC-014.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_EXECUTION_SYMBOLS = [
  'sendTransaction',
  'signTransaction',
  'signAllTransactions',
  'Keypair.generate',
  'Keypair.fromSecretKey',
  'buildSwapInstruction',
  'executeTrade',
  'submitOrder',
  'privateKey',
  'secretKey',
];

const FORBIDDEN_LLM_SYMBOLS = [
  'generateContent',
  'createChatCompletion',
  'Anthropic',
  'OpenAI',
  'promptTemplate',
  'systemPrompt',
  'llmJudge',
];

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (fullPath.endsWith('.ts') && !fullPath.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Read-Only Guard & Structural Scan (FR-DISC-008, FR-DISC-014)', () => {
  const srcDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src',
  );

  const sourceFiles = getAllSourceFiles(srcDir);

  it('scans all src/ files in discovery-universe ensuring NO trade execution or transaction signing symbols', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      for (const symbol of FORBIDDEN_EXECUTION_SYMBOLS) {
        const found = content.includes(symbol);
        if (found) {
          throw new Error(
            `Security violation: Forbidden execution symbol '${symbol}' found in ${filePath}`,
          );
        }
        expect(found).toBe(false);
      }
    }
  });

  it('scans all src/ files in discovery-universe ensuring NO LLM completion / prompt generation calls', () => {
    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf8');
      for (const symbol of FORBIDDEN_LLM_SYMBOLS) {
        const found = content.includes(symbol);
        if (found) {
          throw new Error(
            `Architectural violation: Forbidden LLM symbol '${symbol}' found in ${filePath}`,
          );
        }
        expect(found).toBe(false);
      }
    }
  });

  it('verifies that discovery universe operates exclusively on observational / PIT telemetry contracts', () => {
    // Assert all source files are bounded to registry, attribution, retrospective, or aggregate paths
    const allowedFileBasenames = [
      'index.ts',
      'universe-registry.ts',
      'first-seen-attribution.ts',
      'aggregate-path.ts',
      'retrospective-classifier.ts',
      'source-profiles.ts',
      'coverage-metrics.ts',
      'recall-estimator.ts',
      'constraints.ts',
      'chain-access-gate.ts',
    ];

    for (const filePath of sourceFiles) {
      const baseName = path.basename(filePath);
      expect(allowedFileBasenames).toContain(baseName);
    }
  });
});
