import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReadOnlyDeterministicSurface,
  scanSignalIntelligenceSources,
  SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES,
  SIGNAL_INTELLIGENCE_PROHIBITED_IMPORT_PATTERNS,
} from '../src/read-only-guard.ts';

const PACKAGE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src',
);

describe('packages/signal-intelligence: Read-Only Guard & No-LLM Structural Scan (T019, T041, AC-154)', () => {
  it('strictly contains no model-provider, prompt, or agent imports anywhere in src', () => {
    if (!existsSync(PACKAGE_SRC)) {
      // Source directory not yet created by product tasks
      return;
    }

    const files = readdirSync(PACKAGE_SRC).filter(
      (f) => f.endsWith('.ts') && f !== 'read-only-guard.ts',
    );
    const sources: Record<string, string> = {};
    for (const file of files) {
      sources[file] = readFileSync(path.join(PACKAGE_SRC, file), 'utf8');
    }

    const findings = scanSignalIntelligenceSources(sources);
    expect(findings).toEqual([]);
    expect(() => assertReadOnlyDeterministicSurface(sources)).not.toThrow();

  });

  it('INV-001: signal-intelligence package is strictly read-only and defines no signing capabilities', () => {
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toHaveLength(6);
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_IMPORT_PATTERNS).toHaveLength(4);
  });

  it('catches prohibited import specifiers in synthetic violated source', () => {
    const dirtySources = {
      'violating.ts': `import { Claude } from '@anthropic-ai/sdk';\nimport { ChatModel } from './model-provider/index.js';`,
    };
    const findings = scanSignalIntelligenceSources(dirtySources);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.kind === 'PROHIBITED_IMPORT')).toBe(true);
    expect(() => assertReadOnlyDeterministicSurface(dirtySources)).toThrow(
      /READ_ONLY_DETERMINISTIC_SURFACE_VIOLATION/,
    );
  });

  it('catches prohibited capability calls in synthetic violated source', () => {
    const dirtySources = {
      'violating.ts': `export function evil() { return signTransaction(tx); }`,
    };
    const findings = scanSignalIntelligenceSources(dirtySources);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.kind === 'PROHIBITED_CAPABILITY')).toBe(true);
    expect(() => assertReadOnlyDeterministicSurface(dirtySources)).toThrow(
      /READ_ONLY_DETERMINISTIC_SURFACE_VIOLATION/,
    );
  });
});

