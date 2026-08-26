/**
 * T115: adapter registration — descriptor-mandatory, prohibited-capability
 * refusal, unknown-class refusal, wholesale bundle-exposure refusal, and the
 * negativeCapabilities metadata attached to every registered operation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import { OperationRegistry } from '@foresift/provider-lifecycle';

const ts = (value: string): UtcTimestamp => value as UtcTimestamp;
import {
  AdapterRegistrar,
  ProvAdapterErrorCode,
  createGmgnAdapterManifest,
  GMGN_OPERATIONS,
} from '../src/index.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let registry: OperationRegistry;
let registrar: AdapterRegistrar;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  registry = new OperationRegistry(engine, {
    now: () => ts('2026-08-26T12:00:00Z'),
    nowEpochMs: () => Date.parse('2026-08-26T12:00:00Z'),
  });
  registrar = new AdapterRegistrar({ registry });
  await registry.registerProvider({
    providerId: 'gmgn',
    displayName: 'GMGN (query-only)',
    providerGroup: 'market-intel',
  });
});

afterAll(async () => {
  await db.close();
});

/** Indexed catalog entry with an undefined guard for noUncheckedIndexedAccess. */
function gmgnOperationAt(manifest: ReturnType<typeof createGmgnAdapterManifest>, index: number) {
  const entry = manifest.operations[index];
  if (entry === undefined) throw new Error(`GMGN manifest has no operation at ${String(index)}`);
  return entry;
}

describe('T115 adapter registration', () => {
  it('registers the full GMGN query manifest with allowlist entries derived', async () => {
    const result = await registrar.register(createGmgnAdapterManifest());
    expect(result.adapterId).toBe('gmgn-query-readonly');
    expect(result.registeredOperationIds).toEqual([
      'token.security',
      'token.top_traders',
      'token.pair_stats',
    ]);
    expect(result.allowlistEntries).toHaveLength(3);
    for (const entry of result.allowlistEntries) {
      expect(entry).toMatchObject({
        host: 'api.gmgn.ai',
        port: 443,
        scheme: 'https',
        plane: 'COLLECTOR',
      });
    }
  });

  it('attaches the negative-capability metadata to every registered operation', async () => {
    const rows = await engine.query<{ negative_capabilities: string[]; capability_class: string }>(
      `SELECT negative_capabilities, capability_class FROM prov.prov_operations
       WHERE provider_id = 'gmgn' ORDER BY operation_id`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows.rows) {
      expect(row.capability_class).toBe('READ_MARKET');
      expect([...row.negative_capabilities].sort()).toEqual([
        'PROHIBITED_CUSTODY',
        'PROHIBITED_SIGN',
        'PROHIBITED_SUBMIT',
        'PROHIBITED_TRANSACTION_BUILD',
      ]);
    }
  });

  it('refuses catalog entries without an allowlist descriptor', async () => {
    const manifest = createGmgnAdapterManifest();
    const first = gmgnOperationAt(manifest, 0);
    await expect(
      registrar.register({
        adapterId: 'no-descriptor',
        providerId: 'gmgn',
        plane: manifest.plane,
        operations: [{ ...first, descriptor: null }],
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_ALLOWLIST_REQUIRED });
  });

  it('refuses descriptors attached to a DIFFERENT operation id', async () => {
    const manifest = createGmgnAdapterManifest();
    const second = gmgnOperationAt(manifest, 1);
    // Catalog descriptors are REQUIRED there, so this is definitely present.
    const wrongDescriptor = GMGN_OPERATIONS[0]?.descriptor;
    if (wrongDescriptor === undefined) throw new Error('GMGN catalog is empty');
    await expect(
      registrar.register({
        adapterId: 'crossed-descriptor',
        providerId: 'gmgn',
        plane: 'COLLECTOR',
        operations: [
          {
            operation: second.operation,
            responseSchemaId: second.responseSchemaId,
            responseSchema: second.responseSchema,
            descriptor: wrongDescriptor,
          },
          second,
        ],
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_ALLOWLIST_REQUIRED });
  });

  it('refuses a prohibited capability class outright', async () => {
    const first = gmgnOperationAt(createGmgnAdapterManifest(), 0);
    await expect(
      registrar.register({
        adapterId: 'prohibited-capability',
        providerId: 'gmgn',
        plane: 'COLLECTOR',
        operations: [
          {
            ...first,
            operation: { ...first.operation, capabilityClass: 'PROHIBITED_SIGN' as never },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_CAPABILITY_PROHIBITED });
  });

  it('refuses capability classes outside the vocabulary', async () => {
    const first = gmgnOperationAt(createGmgnAdapterManifest(), 0);
    await expect(
      registrar.register({
        adapterId: 'unknown-capability',
        providerId: 'gmgn',
        plane: 'COLLECTOR',
        operations: [
          { ...first, operation: { ...first.operation, capabilityClass: 'TELEPORT' as never } },
        ],
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_CAPABILITY_UNKNOWN });
  });

  it('refuses wholesale multi-operation bundle exposure', async () => {
    const first = gmgnOperationAt(createGmgnAdapterManifest(), 0);
    await expect(
      registrar.register({
        adapterId: 'bundle-exposure',
        providerId: 'gmgn',
        plane: 'COLLECTOR',
        operations: [{ ...first, bundleOperationIds: ['token.security', 'token.top_traders'] }],
      }),
    ).rejects.toMatchObject({ code: ProvAdapterErrorCode.PROV_ADAPTER_BUNDLE_EXPOSURE_REFUSED });
  });

  it('re-registers identically without conflict (idempotent)', async () => {
    const again = await registrar.register(createGmgnAdapterManifest());
    expect(again.registeredOperationIds).toHaveLength(3);
  });
});
