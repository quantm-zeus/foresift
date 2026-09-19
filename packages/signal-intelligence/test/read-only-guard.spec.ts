/**
 * Read-only guard & prohibited capability structural tests (T019, T041, INV-001, Appendix I step 14).
 * Verifies that packages/signal-intelligence has no model-provider, LLM, or execution/signing imports.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReadOnlyDeterministicSurface,
  scanSignalIntelligenceSources,
  SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES,
} from '../src/read-only-guard.ts';

const PACKAGE_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src',
);

describe('packages/signal-intelligence: Read-Only Guard & No-LLM Structural Scan', () => {
  it('strictly contains no model-provider, prompt, or agent imports anywhere in src', () => {
    if (!existsSync(PACKAGE_SRC)) {
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

  it('detects injected prohibited imports and capabilities (negative verification)', () => {
    const maliciousSources = {
      'bad-agent.ts': `import { LLMClient } from '@foresift/model-provider';`,
      'bad-signer.ts': `export function sendTransaction() { return true; }`,
    };

    const findings = scanSignalIntelligenceSources(maliciousSources);
    expect(findings.length).toBe(2);
    expect(findings[0]?.kind).toBe('PROHIBITED_IMPORT');
    expect(findings[1]?.kind).toBe('PROHIBITED_CAPABILITY');
    expect(() => assertReadOnlyDeterministicSurface(maliciousSources)).toThrow(
      /READ_ONLY_DETERMINISTIC_SURFACE_VIOLATION/,
    );
  });

  it('INV-001: signal-intelligence package is strictly read-only and defines no signing capabilities', () => {
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('wallet signing');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES).toContain('trading execution');
    expect(SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES.length).toBeGreaterThanOrEqual(6);
  });
});
