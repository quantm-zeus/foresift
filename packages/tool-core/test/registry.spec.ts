/**
 * Registry units over PGlite (FR-CORE-001): hash pinning over canonical
 * metadata JSON (execute excluded), duplicate-version refusal with differing
 * hash and idempotent same-hash convergence, prohibited screening wired ahead
 * of insert with audited refusals, snapshot versioning, list-by-profile,
 * additive retirement, and cross-instance hydration without execute.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import type { ToolDefinitionMetadata } from '@foresift/shared-schemas';
import { ToolCoreRegistry } from '../src/registry.ts';
import type { ProhibitedRefusalEvent } from '../src/prohibited.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, '../../../migrations');
const CATALOG = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../tests/fixtures/core/tool-catalog.json'), 'utf8'),
) as { domainTools: string[] };

const T0 = '2026-08-01T00:00:00Z';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

interface MetaOverrides {
  name?: string;
  version?: string;
  description?: string;
  profiles?: string[];
}

/** Schema-shaped fixture metadata; the registry re-parses it strictly. */
function metadata(over: MetaOverrides = {}): ToolDefinitionMetadata {
  const name = over.name ?? 'get_asset_identity';
  return {
    name,
    version: over.version ?? '1.0.0',
    title: name,
    description: over.description ?? `Fixture seed definition for ${name} (§16.9 catalog).`,
    actionClass: 'EXTERNAL_READ',
    profiles: over.profiles ?? ['discovery'],
    requiredScopes: ['assets:read'],
    cachePolicyId: 'exact-default',
    quotaPolicyId: 'strict-free-default',
    licensePolicyId: 'rights-verified-only',
    estimatedCost: {},
    inputSchemaJson: { type: 'object' },
    outputSchemaJson: { type: 'object' },
  } as unknown as ToolDefinitionMetadata;
}

const execute = async () => ({ ok: true });

function recordingSink() {
  const events: ProhibitedRefusalEvent[] = [];
  return {
    events,
    sink: {
      async recordProhibitedRefusal(event: ProhibitedRefusalEvent) {
        events.push(event);
      },
    },
  };
}

describe('tool registry registration + hash pinning', () => {
  it('registers a definition and pins its hash to canonical metadata JSON', async () => {
    const registry = new ToolCoreRegistry({ engine, now: () => T0 });
    const entry = await registry.register({ metadata: metadata(), execute });
    expect(entry.definitionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Hash covers ONLY the metadata — an equivalent definition with a fresh
    // execute closure produces the identical hash and converges idempotently.
    const entry2 = await registry.register({
      metadata: structuredClone(metadata()),
      execute: async () => ({ different: true }),
    });
    expect(entry2).toEqual(entry);
  });

  it('refuses duplicate version with a DIFFERING hash', async () => {
    const registry = new ToolCoreRegistry({ engine, now: () => T0 });
    await registry.register({ metadata: metadata({ name: 'dup_tool' }), execute });
    await expect(
      registry.register({
        metadata: metadata({ name: 'dup_tool', description: 'changed semantics' }),
        execute,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_DEFINITION_DUPLICATE_HASH' });
  });

  it('screens before insert: prohibited definitions are refused AND audited', async () => {
    const { events, sink } = recordingSink();
    const screened = new ToolCoreRegistry({ engine, refusalSink: sink, now: () => T0 });
    await expect(
      screened.register({ metadata: metadata({ name: 'execute_swap' }), execute }),
    ).rejects.toMatchObject({ code: 'TOOL_DEFINITION_PROHIBITED' });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasons.length).toBeGreaterThan(0);
    // Nothing reached storage.
    const rows = await engine.query(
      `SELECT * FROM core.core_tool_registry WHERE tool_name = 'execute_swap'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('keeps snapshot version monotonic across registrations', async () => {
    const registry = new ToolCoreRegistry({ engine, now: () => T0 });
    await registry.register({ metadata: metadata({ name: 'snap_a' }), execute });
    const v1 = registry.snapshot().version;
    await registry.register({ metadata: metadata({ name: 'snap_b' }), execute });
    expect(registry.snapshot().version).toBeGreaterThan(v1);
  });

  it('lists by profile only for live entries carrying that profile', async () => {
    const registry = new ToolCoreRegistry({ engine, now: () => T0 });
    await registry.register({
      metadata: metadata({ name: 'prof_a', profiles: ['market-research'] }),
      execute,
    });
    await registry.register({
      metadata: metadata({ name: 'prof_b', profiles: ['discovery'] }),
      execute,
    });
    const market = registry.listByProfile('market-research');
    expect(market.map((e) => e.metadata.name)).toContain('prof_a');
    expect(market.map((e) => e.metadata.name)).not.toContain('prof_b');
  });

  it('retires additively; retired entries leave resolution but stay stored', async () => {
    const registry = new ToolCoreRegistry({ engine, now: () => T0 });
    await registry.register({
      metadata: metadata({ name: 'retire_me', version: '1.0.0' }),
      execute,
    });
    await registry.register({
      metadata: metadata({ name: 'retire_me', version: '2.0.0' }),
      execute,
    });
    await registry.retire('retire_me', '2.0.0', '2026-08-02T00:00:00Z');
    expect(registry.resolve('retire_me')?.metadata.version).toBe('1.0.0');
    const rows = await engine.query(
      `SELECT tool_version FROM core.core_tool_registry
       WHERE tool_name = 'retire_me' AND retired_at IS NOT NULL`,
    );
    expect(rows.rows.map((r) => r.tool_version as string)).toEqual(['2.0.0']);
    // Retiring again refuses (no live row matches).
    await expect(registry.retire('retire_me', '2.0.0')).rejects.toMatchObject({
      code: 'REGISTRY_ENTRY_UNKNOWN',
    });
  });

  it('hydrates rows persisted by another instance without granting execute', async () => {
    const first = new ToolCoreRegistry({ engine, now: () => T0 });
    await first.register({ metadata: metadata({ name: 'hydrate_me' }), execute });
    const second = new ToolCoreRegistry({ engine, now: () => T0 });
    const count = await second.hydrate();
    expect(count).toBeGreaterThan(0);
    const entry = second.resolve('hydrate_me');
    expect(entry?.definitionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry?.execute).toBeUndefined(); // foreign process definitions are inert
    expect(first).toBeDefined();
  });

  it('seeds every §16.9 domain catalog name as a registrable fixture definition', async () => {
    const registry = new ToolCoreRegistry({ engine, now: () => T0 });
    let seeded = 0;
    for (const [i, name] of CATALOG.domainTools.entries()) {
      await registry.register({
        metadata: metadata({
          name,
          version: `9.${i}.0`, // unique versions: tests share one database
          profiles: i % 2 === 0 ? ['discovery'] : ['market-research'],
        }),
        execute,
      });
      seeded += 1;
    }
    expect(seeded).toBe(CATALOG.domainTools.length);
  });

  it('excludes unregistered names from resolution (fail-closed)', () => {
    const registry = new ToolCoreRegistry({ engine });
    expect(registry.resolve('never_registered')).toBeUndefined();
  });
});
