/**
 * Read-only guard & prohibited capability structural tests (T019, T041, INV-001, Appendix I step 14).
 * Verifies that packages/signal-intelligence has no model-provider, LLM, or execution/signing imports.
 *
 * Traces: FR-SIG-006, FR-SIG-003, AC-154.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReadOnlyDeterministicSurface,
  scanSignalIntelligenceSources,
  SIGNAL_INTELLIGENCE_ALLOWED_IMPORT_PREFIXES,
  SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES,
  SIGNAL_INTELLIGENCE_PROHIBITED_IMPORT_PATTERNS,
} from '../src/read-only-guard.ts';

const PACKAGE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src',
);

function loadAllSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  if (!existsSync(PACKAGE_SRC)) {
    return sources;
  }
  const files = readdirSync(PACKAGE_SRC).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    sources[file] = readFileSync(path.join(PACKAGE_SRC, file), 'utf8');
  }
  return sources;
}

describe('packages/signal-intelligence: Read-Only Guard & No-LLM Structural Scan (T019, T041, AC-154)', () => {
  it('landed product surface strictly passes assertReadOnlyDeterministicSurface with 0 findings', () => {
    const sources = loadAllSources();
    expect(Object.keys(sources).length).toBeGreaterThan(0);

    // Filter out the scanner definition module itself (which defines the prohibited tokens)
    const productSources = Object.fromEntries(
      Object.entries(sources).filter(([file]) => !file.endsWith('read-only-guard.ts')),
    );
    expect(Object.keys(productSources).length).toBeGreaterThan(10);

    const findings = scanSignalIntelligenceSources(productSources);
    expect(findings).toEqual([]);

    expect(() => assertReadOnlyDeterministicSurface(productSources)).not.toThrow();
  });

  it('strictly contains no model-provider, prompt, or agent imports across all landed modules', () => {
    const sources = loadAllSources();
    const importRegex = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;

    const prohibitedModulePrefixes = [
      '@anthropic-ai',
      '@openai',
      '@google/genai',
      '@google/generative-ai',
      'langchain',
      'ollama',
      '@foresift/model-provider',
      'prompt-template',
      'wallet-signing',
      'transaction-submission',
    ];

    for (const [moduleFile, content] of Object.entries(sources)) {
      // Strip comments so docstrings mentioning policy do not false-positive
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const match of stripped.matchAll(importRegex)) {
        const importSpecifier = match[1] as string;

        // Check against prohibited prefixes
        for (const prohibited of prohibitedModulePrefixes) {
          expect(importSpecifier.startsWith(prohibited)).toBe(false);
        }

        // Check against regex patterns
        for (const pattern of SIGNAL_INTELLIGENCE_PROHIBITED_IMPORT_PATTERNS) {
          expect(pattern.test(importSpecifier)).toBe(false);
        }

        // Verify import is either an allowed prefix or node standard library
        const isAllowedWorkspace = SIGNAL_INTELLIGENCE_ALLOWED_IMPORT_PREFIXES.some((prefix) =>
          importSpecifier.startsWith(prefix),
        );
        const isNodeBuiltin = importSpecifier.startsWith('node:');
        expect(isAllowedWorkspace || isNodeBuiltin).toBe(true);
      }
    }
  });

  it('INV-001: signal-intelligence package is strictly read-only and defines no signing capabilities', () => {
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('wallet signing');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('private key handling');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('transaction construction');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('transaction submission');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('custody');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('trading execution');
  });

  it('negative: scanner detects and refuses injected prohibited model/agent imports', () => {
    const prohibitedSyntheticSources: Record<string, string> = {
      'violating-agent.ts': "import { createAgent } from '@foresift/agents';",
      'violating-prompt.ts': "import { Prompt } from '@foresift/prompts';",
      'violating-provider.ts': "import { Provider } from '@foresift/model-provider';",
      'violating-llm.ts': "import { query } from './llm/helper';",
    };

    const findings = scanSignalIntelligenceSources(prohibitedSyntheticSources);
    expect(findings.length).toBe(4);
    for (const finding of findings) {
      expect(finding.kind).toBe('PROHIBITED_IMPORT');
    }

    expect(() => assertReadOnlyDeterministicSurface(prohibitedSyntheticSources)).toThrow(
      /READ_ONLY_DETERMINISTIC_SURFACE_VIOLATION/,
    );
  });

  it('negative: scanner detects and refuses injected prohibited execution/signing capabilities', () => {
    const capabilityViolations: Record<string, string> = {
      'violating-signing.ts': 'export function sign(msg: string) { return signTransaction(msg); }',
      'violating-submission.ts': 'export function send(payload: any) { submitTransaction(payload); }',
      'violating-key.ts': 'export const secret = privateKey;',
      'violating-phrase.ts': 'export const seed = seedPhrase;',
      'violating-order.ts': 'export function order() { placeOrder(); }',
      'violating-trade.ts': 'export function trade() { executeTrade(); }',
    };

    const findings = scanSignalIntelligenceSources(capabilityViolations);
    expect(findings.length).toBe(6);
    for (const finding of findings) {
      expect(finding.kind).toBe('PROHIBITED_CAPABILITY');
    }

    expect(() => assertReadOnlyDeterministicSurface(capabilityViolations)).toThrow(
      /READ_ONLY_DETERMINISTIC_SURFACE_VIOLATION/,
    );
  });

  it('scanner ignores comments and docstrings so descriptive policy text does not self-trigger', () => {
    const syntheticDocstringSource: Record<string, string> = {
      'docs-module.ts': `
        /**
         * Documentation stating we do not use model-provider, openai, or signTransaction.
         * // Also single line comments mentioning privateKey or executeTrade.
         */
        import { ForesiftError } from '@foresift/domain';
        export const valid = true;
      `,
    };

    const findings = scanSignalIntelligenceSources(syntheticDocstringSource);
    expect(findings).toEqual([]);
    expect(() => assertReadOnlyDeterministicSurface(syntheticDocstringSource)).not.toThrow();
  });
});
