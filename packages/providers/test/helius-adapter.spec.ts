/**
 * Helius adapter + decoder-authority suite (FR-PROV-007, AC-256, T118):
 * raw getTransaction and standard signature-history are the authoritative
 * paths; LOCAL decoding is deterministic and refuses incomplete coverage;
 * the DEPRECATED enhanced parser runs ONLY under a valid migration
 * exception; and the security package's landed decoder-authority validator
 * passes against THIS package's REAL catalog entries in the normative
 * configuration while refusing enhanced-parser-as-authority configurations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { fixedClock, type ClockPort } from '@foresift/domain';
import { ProvErrorCode } from '@foresift/provider-lifecycle';
import {
  DeprecationRules,
  MigrationExceptions,
  VerificationTtlService,
} from '@foresift/provider-lifecycle';
import { ProhibitedCapabilityError, SecErrorCode, validateDecoderAuthority } from '@foresift/security';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterContract } from '../src/adapter-contract.ts';
import { AdapterRegistrar } from '../src/registration.ts';
import {
  ENHANCED_PARSE_OPERATION_ID,
  HELIUS_HOST,
  HELIUS_OPERATIONS,
  HELIUS_PROVIDER,
} from '../src/operation-catalogs/helius.catalog.ts';
import { HeliusAdapter, heliusDecoderAuthorityConfig } from '../src/adapters/helius-adapter.ts';
import { assertDeterministicCoverage } from '../src/helius-decoding.ts';
import {
  ENHANCED_PARSED_FIXTURE,
  fixtureFetch,
  jsonResponse,
  PUBLIC_IP,
  rawTransactionFixture,
  staticResolver,
  SUPPORTED_RAW_TX_PROGRAMS,
  UNSUPPORTED_PROGRAM_ID,
} from './fixtures.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const T0 = Date.parse('2026-06-01T00:00:00Z');

function manualClock(startEpochMs: number): { clock: ClockPort; moveTo: (ms: number) => void } {
  let current = startEpochMs;
  return {
    clock: {
      now: () => new Date(current).toISOString().replace('.000Z', 'Z') as ReturnType<ClockPort['now']>,
      nowEpochMs: () => current,
    },
    moveTo: (ms) => {
      current = ms;
    },
  };
}

let db: PGlite;
let engine: DatabaseEngine;

function heliusContract(): AdapterContract {
  return new AdapterContract({
    descriptors: HELIUS_OPERATIONS.map((e) => e.allowlist),
    resolver: staticResolver({ [HELIUS_HOST]: [PUBLIC_IP] }),
  });
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  // The REAL registry entries land through the normal registration path.
  await new AdapterRegistrar({ engine }).registerAdapter({
    providerId: HELIUS_PROVIDER.providerId,
    displayName: HELIUS_PROVIDER.displayName,
    providerGroup: HELIUS_PROVIDER.providerGroup,
    exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
    operations: [...HELIUS_OPERATIONS],
  });
});

afterAll(async () => {
  await db.close();
});

describe('raw/history authoritative paths', () => {
  it('raw getTransaction flows end-to-end and decodes LOCALLY with full coverage', async () => {
    const adapter = new HeliusAdapter({
      contract: heliusContract(),
      fetch: fixtureFetch((request) =>
        request.url.includes('/v0/transactions/')
          ? jsonResponse(rawTransactionFixture(SUPPORTED_RAW_TX_PROGRAMS))
          : jsonResponse({}, { status: 404 }),
      ),
    });
    const raw = (await adapter.rawGetTransaction({
      signature: '4RfYfixtureRawTxSignature0000000000000000000000000',
    })) as { signature: string };
    expect(raw.signature).toContain('4RfY');

    const decoded = adapter.decodeLocally(raw as never);
    expect(decoded.fullyCovered).toBe(true);
    expect(decoded.instructions.map((i) => i.kind)).toEqual(['SPL_TOKEN_TRANSFER', 'SYSTEM_TRANSFER']);
    expect(() => assertDeterministicCoverage(decoded)).not.toThrow();
  });

  it('standard signature history is a separate declared operation', async () => {
    const seen: string[] = [];
    const adapter = new HeliusAdapter({
      contract: heliusContract(),
      fetch: fixtureFetch((request) => {
        seen.push(request.url);
        return jsonResponse({ history: [{ signature: 'sig-1', slot: 1 }] });
      }),
    });
    const history = (await adapter.signatureHistory({
      address: '9xQeWvG816bUx9EPSjvfHUwkQ4mB2uJ7u6FwWcpGRnoT',
      query: { limit: '25' },
    })) as { history: unknown[] };
    expect(history.history).toHaveLength(1);
    expect(seen[0]).toContain('/v0/addresses/');
  });

  it('incomplete local coverage refuses — provider parsing never fills the gap', () => {
    const adapter = new HeliusAdapter({
      contract: heliusContract(),
      fetch: fixtureFetch(() => jsonResponse({})),
    });
    const decoded = adapter.decodeLocally(
      rawTransactionFixture([SUPPORTED_RAW_TX_PROGRAMS[0]!, UNSUPPORTED_PROGRAM_ID]) as never,
    );
    expect(decoded.fullyCovered).toBe(false);
    expect(decoded.unsupportedProgramIds).toEqual([UNSUPPORTED_PROGRAM_ID]);
    try {
      assertDeterministicCoverage(decoded);
      expect.unreachable('coverage assertion must refuse');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ProvErrorCode.PROV_DECODING_COVERAGE_INCOMPLETE);
    }
  });

  it('the plan-gated historical scan stays DISABLED for STRICT_FREE consumption', async () => {
    const clock = fixedClock(new Date(T0).toISOString().replace('.000Z', 'Z') as never);
    const verification = new VerificationTtlService({ engine, clock });
    const rules = new DeprecationRules({ engine, clock, verification });
    const scanEntry = HELIUS_OPERATIONS.find((e) => e.definition.operationId === 'helius/historical-signature-scan')!;
    // allowedInStrictFree=false AND paidFallbackAllowed=false → NOT_ELIGIBLE.
    expect(
      await rules.strictFreeAvailability(scanEntry.definition),
    ).toMatchObject({ allowed: false, reason: 'NOT_ELIGIBLE' });
    // The authoritative raw operation IS eligible by flag but needs CURRENT plan proof.
    const rawEntry = HELIUS_OPERATIONS.find((e) => e.definition.operationId === 'helius/raw-get-transaction')!;
    expect(await rules.strictFreeAvailability(rawEntry.definition)).toMatchObject({
      allowed: false,
      reason: 'PLAN_UNPROVEN',
    });
    await verification.configureTtl('helius', 'PRICING_PLAN', 3600);
    await verification.record({
      providerId: 'helius',
      operationId: 'helius/raw-get-transaction',
      operationVersion: '1.0.0',
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['pricing/helius-free-tier'],
    });
    expect(await rules.strictFreeAvailability(rawEntry.definition)).toMatchObject({
      allowed: true,
      reason: 'PLAN_VERIFIED',
    });
  });
});

describe('DEPRECATED enhanced parser: exception-gated, never authoritative', () => {
  it('refuses fail-closed without a gate, without an exception; runs under a valid one', async () => {
    const fixtureFetchServingEnhanced = fixtureFetch((request) =>
      request.url.includes('/v0/enhanced/')
        ? jsonResponse(ENHANCED_PARSED_FIXTURE)
        : jsonResponse({}, { status: 404 }),
    );

    // No gate wired at all → refuse.
    const ungated = new HeliusAdapter({ contract: heliusContract(), fetch: fixtureFetchServingEnhanced });
    await expect(ungated.enhancedTransactionParse({ signature: 'sig-x' })).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
    });

    // Gate wired but NO valid migration exception → refuse.
    const { clock, moveTo } = manualClock(T0);
    const exceptions = new MigrationExceptions({ engine, clock });
    const rules = new DeprecationRules({ engine, clock, exceptions });
    const gated = new HeliusAdapter({
      contract: heliusContract(),
      fetch: fixtureFetchServingEnhanced,
      enhancedParserGate: rules,
    });
    await expect(gated.enhancedTransactionParse({ signature: 'sig-x' })).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
    });

    // A valid bounded exception re-permits use as non-authoritative evidence…
    await exceptions.grant({
      providerId: 'helius',
      operationId: ENHANCED_PARSE_OPERATION_ID,
      approver: 'operator-a',
      replacementPlanRef: 'plan/migrate-to-raw-get-transaction',
      replacementOperationId: 'helius/raw-get-transaction',
      exceptionExpiresAt: '2026-07-01T00:00:00Z',
      evidenceRefs: ['ticket/enhanced-parser-retirement'],
    });
    const parsed = (await gated.enhancedTransactionParse({ signature: 'sig-x' })) as typeof ENHANCED_PARSED_FIXTURE;
    expect(parsed.type).toBe('SWAP');

    // …and the instant it lapses it authorizes nothing again.
    moveTo(Date.parse('2026-07-01T00:00:01Z'));
    await expect(gated.enhancedTransactionParse({ signature: 'sig-y' })).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
    });
  });
});

describe('T118: decoder-authority validator against REAL catalog entries', () => {
  it('the normative raw/history + local-decoding configuration passes', () => {
    const config = heliusDecoderAuthorityConfig({
      acknowledgedDeprecations: [ENHANCED_PARSE_OPERATION_ID],
    });
    const verdict = validateDecoderAuthority(config);
    expect(verdict.ok).toBe(true);
    // Raw getTransaction (SOLE) + standard history (PRIMARY) are the authorities.
    expect(verdict.authoritativeDecoderIds.sort()).toEqual([
      'helius/raw-get-transaction',
      'helius/signature-history-standard',
    ]);
    // The deprecated entry is present but NON-authoritative.
    const enhanced = config.decoders.find((d) => d.id === ENHANCED_PARSE_OPERATION_ID)!;
    expect(enhanced.status).toBe('DEPRECATED');
    expect(enhanced.authority).toBe('FALLBACK');
  });

  it('enhanced-parser-as-SOLE and as-PRIMARY configurations are REFUSED', () => {
    for (const authority of ['SOLE', 'PRIMARY'] as const) {
      expect(() =>
        validateDecoderAuthority(
          heliusDecoderAuthorityConfig({
            authorityOverrides: { [ENHANCED_PARSE_OPERATION_ID]: authority },
            acknowledgedDeprecations: [ENHANCED_PARSE_OPERATION_ID],
          }),
        ),
      ).toThrowError(ProhibitedCapabilityError);
    }
  });

  it('deprecated entries without the raw+local pass enabled are REFUSED', () => {
    expect(() =>
      validateDecoderAuthority(
        heliusDecoderAuthorityConfig({
          rawOperationLocalDecodingEnabled: false,
          acknowledgedDeprecations: [ENHANCED_PARSE_OPERATION_ID],
        }),
      ),
    ).toThrowError(ProhibitedCapabilityError);
  });

  it('running the deprecated entry without explicit acknowledgement is REFUSED', () => {
    try {
      validateDecoderAuthority(heliusDecoderAuthorityConfig({}));
      expect.unreachable('unacknowledged deprecation must refuse');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(SecErrorCode.SEC_DECODER_AUTHORITY_INVALID);
    }
  });
});
