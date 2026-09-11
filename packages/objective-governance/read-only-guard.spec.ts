/**
 * Unit and structural scanner tests for read-only guard (T015, FR-OBJ-001, FR-OBJ-004).
 *
 * Covers:
 * - Prohibited import detection: model providers, agent runtimes, wallets, trade executors, custody
 * - Prohibited capability detection: transaction construction, signing, submission, private keys, trading
 * - Float literal detection: decimal, leading-dot, exponent forms on the integer-only objective path
 * - Comment & string literal immunity: prose, docstrings, and error messages do not trigger false positives
 * - Source scanner assertions and attestation structure
 * - Live codebase scan: ensures production sources in objective-governance and shadow-portfolio are clean
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OBJ_GOVERNANCE_FLOAT_LITERAL_PATTERN,
  OBJ_GOVERNANCE_PROHIBITED_IDENTIFIERS,
  OBJ_GOVERNANCE_PROHIBITED_IMPORT_PATTERNS,
  assertObjectiveGovernanceReadOnly,
  objectiveGovernanceReadOnlyAttestation,
  scanObjectiveGovernanceSources,
} from './read-only-guard.ts';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SHADOW_PORTFOLIO_SRC_DIR = path.resolve(PKG_DIR, '../shadow-portfolio/src');

describe('objective-governance read-only guard: pattern constants and vocabulary', () => {
  it('exports frozen prohibited import patterns and prohibited identifier list', () => {
    expect(Object.isFrozen(OBJ_GOVERNANCE_PROHIBITED_IMPORT_PATTERNS)).toBe(true);
    expect(Object.isFrozen(OBJ_GOVERNANCE_PROHIBITED_IDENTIFIERS)).toBe(true);
    expect(OBJ_GOVERNANCE_PROHIBITED_IMPORT_PATTERNS.length).toBeGreaterThan(0);
    expect(OBJ_GOVERNANCE_PROHIBITED_IDENTIFIERS.length).toBe(11);
    expect(OBJ_GOVERNANCE_FLOAT_LITERAL_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe('objective-governance read-only guard: prohibited import detection (FR-OBJ-001, FR-OBJ-004)', () => {
  it('returns no findings for clean source files with valid domain imports', () => {
    const cleanSources = {
      'src/math.ts': `
        import { assertIntegerMicros, floorDiv } from '@foresift/domain';
        export function computeUtility(micros: bigint): bigint {
          return floorDiv(micros, 1000n);
        }
      `,
    };

    const findings = scanObjectiveGovernanceSources(cleanSources);
    expect(findings).toEqual([]);
    expect(() => assertObjectiveGovernanceReadOnly(cleanSources)).not.toThrow();
  });

  it('detects prohibited model provider imports (@openai, @anthropic-ai, model-provider)', () => {
    const badSources = {
      'src/openai-leak.ts': `import OpenAI from '@openai/api';`,
      'src/anthropic-leak.ts': `import { Anthropic } from '@anthropic-ai/sdk';`,
      'src/provider-leak.ts': `import { Provider } from 'model-provider/client';`,
    };

    const findings = scanObjectiveGovernanceSources(badSources);
    expect(findings.length).toBe(3);
    expect(findings.every((f) => f.kind === 'PROHIBITED_IMPORT')).toBe(true);
    expect(findings.map((f) => f.modulePath)).toEqual([
      'src/anthropic-leak.ts',
      'src/openai-leak.ts',
      'src/provider-leak.ts',
    ]);
  });

  it('detects prohibited execution/agent/wallet/custody imports', () => {
    const badSources = {
      'src/agent.ts': `import { Agent } from '@agent/runtime';`,
      'src/wallet.ts': `import { Keypair } from '@solana-wallet/core';`,
      'src/executor.ts': `import { Executor } from 'pkg-trade-executor';`,
      'src/custody.ts': `export * from 'my-custody/lib';`,
    };

    const findings = scanObjectiveGovernanceSources(badSources);
    expect(findings.length).toBe(4);
    expect(findings.every((f) => f.kind === 'PROHIBITED_IMPORT')).toBe(true);
  });
});

describe('objective-governance read-only guard: prohibited capability identifier detection', () => {
  it('detects all eleven prohibited capability identifiers in code', () => {
    for (const identifier of OBJ_GOVERNANCE_PROHIBITED_IDENTIFIERS) {
      const source = {
        [`src/test-${identifier}.ts`]: `
          function testFn() {
            const val = ${identifier}();
            return val;
          }
        `,
      };

      const findings = scanObjectiveGovernanceSources(source);
      expect(findings.length).toBe(1);
      expect(findings[0]?.kind).toBe('PROHIBITED_CAPABILITY');
      expect(findings[0]?.evidence).toBe(identifier);
    }
  });

  it('ignores prohibited identifiers inside comments and string literals', () => {
    const sourcesWithCommentsAndStrings = {
      'src/comments.ts': `
        // Prohibited: buildTransaction, sendTransaction, privateKey
        /*
         * Multi-line comment mentioning:
         * constructTransaction, signTransaction, submitTransaction,
         * seedPhrase, placeOrder, executeTrade, transferFunds, custodyWallet
         */
        const description1 = 'This mentions sendTransaction in a string';
        const description2 = "This mentions privateKey and placeOrder";
        const description3 = \`This mentions custodyWallet and transferFunds\`;
        export const validInteger = 1000n;
      `,
    };

    const findings = scanObjectiveGovernanceSources(sourcesWithCommentsAndStrings);
    expect(findings).toEqual([]);
    expect(() => assertObjectiveGovernanceReadOnly(sourcesWithCommentsAndStrings)).not.toThrow();
  });
});

describe('objective-governance read-only guard: float detection on the objective path (ADR-OBJ-01)', () => {
  it('detects decimal, leading-dot, exponent, and underscored float literals', () => {
    const floatCases = [
      { code: 'const rate = 0.05;', expectedEvidence: '0.0' },
      { code: 'const pi = 3.14159;', expectedEvidence: '3.1' },
      { code: 'const half = .5;', expectedEvidence: '.5' },
      { code: 'const exp1 = 1e6;', expectedEvidence: '1e6' },
      { code: 'const exp2 = 2.5e-3;', expectedEvidence: '2.5' },
      { code: 'const underscored = 1_000.50;', expectedEvidence: '1_000.5' },
    ];

    for (let i = 0; i < floatCases.length; i++) {
      const testCase = floatCases[i]!;
      const sources = {
        [`src/float-${i}.ts`]: testCase.code,
      };

      const findings = scanObjectiveGovernanceSources(sources);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings.some((f) => f.kind === 'FLOAT_LITERAL')).toBe(true);
    }
  });

  it('allows integer micro-units, bigint literals, and underscored integers', () => {
    const cleanIntegerSources = {
      'src/integers.ts': `
        export const ZERO = 0;
        export const ZERO_BIGINT = 0n;
        export const ONE = 1;
        export const ONE_MILLION = 1_000_000;
        export const ONE_MILLION_BIGINT = 1_000_000n;
        export const NEGATIVE_MICROS = -50_000n;
        export const LARGE_BIGINT = 1234567890123456789n;
      `,
    };

    const findings = scanObjectiveGovernanceSources(cleanIntegerSources);
    expect(findings).toEqual([]);
    expect(() => assertObjectiveGovernanceReadOnly(cleanIntegerSources)).not.toThrow();
  });

  it('ignores float patterns inside comments and string literals', () => {
    const cleanProseSources = {
      'src/disclosure.ts': `
        // Note: 95.0% confidence interval used in literature (z = 1.644853626951)
        /* Decimal score threshold was 0.75 in exploratory prototype */
        export const MSG = 'Expected return is 0.05 per capital-day';
        export const VALUE_MICROS = 50_000n;
      `,
    };

    const findings = scanObjectiveGovernanceSources(cleanProseSources);
    expect(findings).toEqual([]);
  });
});

describe('objective-governance read-only guard: assertions and attestation (FR-OBJ-001…010)', () => {
  it('throws structured error with JSON findings when violations are present', () => {
    const violatingSources = {
      'src/violating.ts': `
        import { sendTransaction } from '@solana-wallet/core';
        const floatVal = 0.5;
      `,
    };

    expect(() => assertObjectiveGovernanceReadOnly(violatingSources)).toThrow(
      /OBJ_GOVERNANCE_READ_ONLY_VIOLATION:/,
    );

    try {
      assertObjectiveGovernanceReadOnly(violatingSources);
    } catch (err) {
      expect((err as Error).message).toContain('PROHIBITED_IMPORT');
      expect((err as Error).message).toContain('FLOAT_LITERAL');
    }
  });

  it('provides the certified read-only attestation contract', () => {
    const attestation = objectiveGovernanceReadOnlyAttestation();
    expect(attestation.constructsTransactions).toBe(false);
    expect(attestation.submitsTransactions).toBe(false);
    expect(attestation.signsTransactions).toBe(false);
    expect(attestation.holdsCustody).toBe(false);
    expect(attestation.invokesModelsOrAgents).toBe(false);
    expect(attestation.objectivePathFloatFree).toBe(true);
  });
});

describe('objective-governance read-only guard: live codebase verification', () => {
  it('scans all production TypeScript sources in objective-governance and confirms zero violations', () => {
    const sourcesToScan: Record<string, string> = {};

    // Root-level source files in package (excluding test files)
    const rootFiles = readdirSync(PKG_DIR).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
    for (const file of rootFiles) {
      sourcesToScan[`packages/objective-governance/${file}`] = readFileSync(
        path.join(PKG_DIR, file),
        'utf8',
      );
    }

    // src/ directory files
    const srcDir = path.join(PKG_DIR, 'src');
    if (existsSync(srcDir)) {
      const srcFiles = readdirSync(srcDir).filter(
        (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
      );
      for (const file of srcFiles) {
        sourcesToScan[`packages/objective-governance/src/${file}`] = readFileSync(
          path.join(srcDir, file),
          'utf8',
        );
      }
    }

    expect(Object.keys(sourcesToScan).length).toBeGreaterThan(5);
    const findings = scanObjectiveGovernanceSources(sourcesToScan);
    expect(findings).toEqual([]);
    expect(() => assertObjectiveGovernanceReadOnly(sourcesToScan)).not.toThrow();
  });

  it('scans shadow-portfolio/src and confirms zero violations', () => {
    if (!existsSync(SHADOW_PORTFOLIO_SRC_DIR)) {
      return;
    }

    const sourcesToScan: Record<string, string> = {};
    const srcFiles = readdirSync(SHADOW_PORTFOLIO_SRC_DIR).filter((f) => f.endsWith('.ts'));
    for (const file of srcFiles) {
      sourcesToScan[`packages/shadow-portfolio/src/${file}`] = readFileSync(
        path.join(SHADOW_PORTFOLIO_SRC_DIR, file),
        'utf8',
      );
    }

    expect(Object.keys(sourcesToScan).length).toBeGreaterThan(0);
    const findings = scanObjectiveGovernanceSources(sourcesToScan);
    expect(findings).toEqual([]);
    expect(() => assertObjectiveGovernanceReadOnly(sourcesToScan)).not.toThrow();
  });
});
