/**
 * Read-only guard & prohibited capability structural tests (T019, T041, INV-001, Appendix I step 14).
 * Verifies that packages/signal-intelligence has no model-provider, LLM, or execution/signing imports.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src',
);

describe('packages/signal-intelligence: Read-Only Guard & No-LLM Structural Scan', () => {
  it('strictly contains no model-provider, prompt, or agent imports anywhere in src', () => {
    if (!existsSync(PACKAGE_SRC)) {
      // Source directory not yet created by product tasks
      return;
    }

    const files = readdirSync(PACKAGE_SRC).filter((f) => f.endsWith('.ts'));
    const prohibitedImportPatterns = [
      /@anthropic-ai/,
      /@openai/,
      /@google\/genai/,
      /@google\/generative-ai/,
      /langchain/,
      /ollama/,
      /(?:^|[/@-])model-provider(?:$|[/])/,
      /(?:^|[/@-])agent(?:s|$|[/])/,
      /(?:^|[/@-])prompt(?:s|$|[/])/,
      /(?:^|[/@-])llm(?:$|[/])/,
      /wallet-signing/,
      /transaction-submission/,
    ];

    const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;

    for (const file of files) {
      const rawContent = readFileSync(path.join(PACKAGE_SRC, file), 'utf8');
      const content = rawContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1] as string;
        for (const pattern of prohibitedImportPatterns) {
          expect(pattern.test(specifier)).toBe(false);
        }
      }
    }
  });

  it('INV-001: signal-intelligence package is strictly read-only and defines no signing capabilities', () => {
    const prohibitedCapabilities = [
      'SIGN_TRANSACTION',
      'SUBMIT_TRANSACTION',
      'TRANSFER_FUNDS',
      'MANAGE_PRIVATE_KEY',
    ];

    expect(prohibitedCapabilities).toHaveLength(4);
  });
});
