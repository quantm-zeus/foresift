/**
 * Structural proof surface for the permanent read-only discovery boundary (FR-DISC-006, FR-DISC-008).
 * Scans for prohibited LLM/agent imports and execution/wallet capabilities.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanDiscoveryUniverseSources,
  assertDiscoveryUniverseReadOnly,
  DISCOVERY_UNIVERSE_PROHIBITED_IMPORT_PATTERNS,
  DISCOVERY_UNIVERSE_PROHIBITED_CAPABILITY_IDENTIFIERS,
} from '../src/read-only-guard.ts';

const SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src',
);

describe('Discovery Universe Read-Only Structural Guard (FR-DISC-006, FR-DISC-008)', () => {
  it('exposes prohibited import and capability lists', () => {
    expect(DISCOVERY_UNIVERSE_PROHIBITED_IMPORT_PATTERNS.length).toBeGreaterThan(5);
    expect(DISCOVERY_UNIVERSE_PROHIBITED_CAPABILITY_IDENTIFIERS).toContain('signTransaction');
    expect(DISCOVERY_UNIVERSE_PROHIBITED_CAPABILITY_IDENTIFIERS).toContain('executeTrade');
    expect(DISCOVERY_UNIVERSE_PROHIBITED_CAPABILITY_IDENTIFIERS).toContain('privateKey');
  });

  it('passes on clean source content without throwing', () => {
    const cleanSources = {
      'source-profiles.ts': `
        import { DiscError } from '@foresift/domain';
        export function registerProfile() { return true; }
      `,
    };
    expect(scanDiscoveryUniverseSources(cleanSources)).toEqual([]);
    expect(() => assertDiscoveryUniverseReadOnly(cleanSources)).not.toThrow();
  });

  it('detects prohibited model/LLM imports', () => {
    const prohibitedImportSources = {
      'llm-helper.ts': `
        import { OpenAI } from '@openai/api';
        export const x = 1;
      `,
    };
    const findings = scanDiscoveryUniverseSources(prohibitedImportSources);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('PROHIBITED_IMPORT');
    expect(findings[0]?.evidence).toBe('@openai/api');

    expect(() => assertDiscoveryUniverseReadOnly(prohibitedImportSources)).toThrow(
      /DISCOVERY_READ_ONLY_SURFACE_VIOLATION/i,
    );
  });

  it('detects prohibited execution and transaction signing capabilities', () => {
    const prohibitedCapabilitySources = {
      'signer.ts': `
        export function doSign() {
          const key = privateKey;
          signTransaction(key);
        }
      `,
    };
    const findings = scanDiscoveryUniverseSources(prohibitedCapabilitySources);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.kind === 'PROHIBITED_CAPABILITY')).toBe(true);

    expect(() => assertDiscoveryUniverseReadOnly(prohibitedCapabilitySources)).toThrow(
      /DISCOVERY_READ_ONLY_SURFACE_VIOLATION/i,
    );
  });

  it('verifies that the entire discovery-universe/src source tree has zero violations', () => {
    const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'));
    const sourceMap: Record<string, string> = {};
    for (const file of files) {
      sourceMap[file] = readFileSync(path.join(SRC_DIR, file), 'utf8');
    }

    const findings = scanDiscoveryUniverseSources(sourceMap);
    expect(findings).toEqual([]);
    expect(() => assertDiscoveryUniverseReadOnly(sourceMap)).not.toThrow();
  });
});
