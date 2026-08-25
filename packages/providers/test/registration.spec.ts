/**
 * Adapter registration suite (FR-PROV-004, AC-254): prohibited capability
 * classes and wholesale bundle exposure refuse outright, catalog entries
 * without allowlist descriptors refuse, every registered operation carries
 * the negativeCapabilities metadata floor (verified against PERSISTED
 * truth), and descriptor/definition mismatches refuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { ProvErrorCode } from '@foresift/provider-lifecycle';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterRegistrar } from '../src/registration.ts';
import { GMGN_OPERATIONS } from '../src/operation-catalogs/gmgn.catalog.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let registrar: AdapterRegistrar;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  registrar = new AdapterRegistrar({ engine });
});

afterAll(async () => {
  await db.close();
});

describe('wholesale exposure + descriptor requirements (FR-PROV-004)', () => {
  it('refuses wholesale bundle exposure before inspecting any entry', async () => {
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn',
        displayName: 'GMGN',
        exposure: { kind: 'WHOLESALE_BUNDLE', ref: 'npm/@gmgn/sdk-whole' },
        operations: [],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_WHOLESALE_BUNDLE_REFUSED });
  });

  it('refuses catalog entries that lack an allowlist descriptor', async () => {
    const stripped = GMGN_OPERATIONS.map((entry) => ({ definition: entry.definition }));
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn',
        displayName: 'GMGN',
        exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
        // Deliberately descriptor-less shape (JS callers can produce this).
        operations: stripped as unknown as typeof GMGN_OPERATIONS,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_ALLOWLIST_DESCRIPTOR_MISSING });
  });

  it('refuses descriptors naming a different operation than the entry defines', async () => {
    const [first] = GMGN_OPERATIONS;
    const mismatched = {
      definition: first!.definition,
      allowlist: { ...first!.allowlist, operationId: 'gmgn/something-else' },
    };
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn',
        displayName: 'GMGN',
        exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
        operations: [mismatched],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID });
  });
});

describe('capability-class vocabulary enforcement (§15.2, §41.1)', () => {
  it('refuses PROHIBITED_* classes outright — never enableable by configuration', async () => {
    const [first] = GMGN_OPERATIONS;
    for (const prohibited of [
      'PROHIBITED_SIGN',
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ] as const) {
      const poisoned = {
        definition: { ...first!.definition, capabilityClass: prohibited },
        allowlist: first!.allowlist,
      };
      await expect(
        registrar.registerAdapter({
          providerId: 'gmgn-forbidden',
          displayName: 'GMGN forbidden variant',
          exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
          operations: [poisoned],
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED });
    }
  });

  it('refuses capability classes outside the vocabulary entirely', async () => {
    const [first] = GMGN_OPERATIONS;
    const nonsense = {
      definition: { ...first!.definition, capabilityClass: 'READ_ASTRAL_PLANE' as never },
      allowlist: first!.allowlist,
    };
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn-nonsense',
        displayName: 'GMGN nonsense variant',
        exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
        operations: [nonsense],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_DEFINITION_INVALID });
  });
});

describe('registered metadata + idempotence', () => {
  it('registers the real GMGN catalog with negativeCapabilities persisted on EVERY operation', async () => {
    const registered = await registrar.registerAdapter({
      providerId: 'gmgn',
      displayName: 'GMGN (query-only)',
      providerGroup: 'external-provider',
      exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
      operations: [...GMGN_OPERATIONS],
    });
    expect(registered.operations).toHaveLength(GMGN_OPERATIONS.length);

    // Persisted truth carries the negative-capability metadata floor.
    const rows = await engine.query<{ operation_id: string; negative_capabilities: string[] }>(
      "SELECT operation_id, negative_capabilities FROM prov.prov_operations WHERE provider_id = 'gmgn'",
    );
    expect(rows.rows).toHaveLength(GMGN_OPERATIONS.length);
    for (const row of rows.rows) {
      for (const required of [
        'no-trading',
        'no-custody',
        'no-signing',
        'no-private-key-handling',
        'no-transaction-submission',
      ]) {
        expect(row.negative_capabilities).toContain(required);
      }
    }

    // Re-registration is idempotent (identical definitions).
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn',
        displayName: 'GMGN (query-only)',
        providerGroup: 'external-provider',
        exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
        operations: [...GMGN_OPERATIONS],
      }),
    ).resolves.toBeDefined();
  });

  it('refuses duplicate operations inside one registration and empty catalogs', async () => {
    const [first] = GMGN_OPERATIONS;
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn-dupes',
        displayName: 'dupes',
        exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
        operations: [
          { definition: first!.definition, allowlist: first!.allowlist },
          { definition: first!.definition, allowlist: first!.allowlist },
        ],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID });
    await expect(
      registrar.registerAdapter({
        providerId: 'gmgn-empty',
        displayName: 'empty',
        exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
        operations: [],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ADAPTER_CATALOG_INVALID });
  });
});
