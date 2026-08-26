/**
 * Tool registry (FR-CORE-001; PRD §16.3). Immutable `(name, version)`
 * entries with sha256 definition-hash pinning over the canonical JSON of the
 * definition metadata (the `execute` function is never part of the hash — it
 * is not serializable and carries no normative semantics), snapshot
 * versioning over an in-memory view, additive-only retirement, and
 * persistence to the Phase-B `core.core_tool_registry` table whose triggers
 * refuse normative mutation and deletion.
 *
 * Registration refuses a duplicate `(name, version)` whose hash differs;
 * same-hash re-registration is an idempotent no-op (INV-009 retry semantics).
 * Every definition passes the prohibited-capability screen before it can be
 * inserted, and refusals are forwarded to the injected audit sink.
 */
import { ForesiftError, type ActionClass, type ToolProfileId } from '@foresift/domain';
import type { ToolDefinitionMetadata } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { ToolDefinitionMetadataSchema } from '@foresift/shared-schemas';
import { ProhibitedCapabilityScreen, type ProhibitedRefusalSink } from './prohibited.ts';

/** A registered tool: validated metadata plus its opaque execution function. */
export interface RegisteredTool {
  readonly metadata: ToolDefinitionMetadata;
  readonly execute: (input: unknown) => Promise<unknown>;
}

/**
 * Registry view entry. Definitions hydrated from the database by another
 * process carry no `execute` — only this process's registrations are
 * executable; resolution for dispatch stays in-process.
 */
export interface RegistryEntry {
  readonly metadata: ToolDefinitionMetadata;
  readonly definitionHash: string;
  readonly retiredAt: string | null;
  readonly execute?: (input: unknown) => Promise<unknown>;
}

export interface RegistrySnapshot {
  /** Monotonic mutation counter — bumps on every register/retire/hydrate. */
  readonly version: number;
  readonly entries: readonly RegistryEntry[];
}

interface RegistryRow {
  tool_name: string;
  tool_version: string;
  definition_hash: string;
  action_class: ActionClass;
  profiles: string[];
  required_scopes: string[];
  cache_policy_id: string;
  quota_policy_id: string;
  license_policy_id: string;
  registered_at: string;
  retired_at: string | null;
}

const ROW_COLUMNS = `tool_name, tool_version, definition_hash, action_class, profiles,
                      required_scopes, cache_policy_id, quota_policy_id, license_policy_id,
                      registered_at, retired_at`;

function rowToMetadata(row: RegistryRow): ToolDefinitionMetadata {
  // The registry row is the projection of the metadata that registration
  // persisted; rebuild the strict shape so consumers always see schema-valid
  // metadata even for definitions hydrated from storage.
  return ToolDefinitionMetadataSchema.parse({
    name: row.tool_name,
    version: row.tool_version,
    title: row.tool_name,
    description: `hydrated from core.core_tool_registry (${row.definition_hash})`,
    actionClass: row.action_class,
    profiles: row.profiles as ToolProfileId[],
    requiredScopes: row.required_scopes,
    cachePolicyId: row.cache_policy_id,
    quotaPolicyId: row.quota_policy_id,
    licensePolicyId: row.license_policy_id,
    estimatedCost: {},
    inputSchemaJson: {},
    outputSchemaJson: {},
  });
}

function isUniqueViolation(err: unknown): boolean {
  return String((err as { message?: string })?.message ?? '')
    .toLowerCase()
    .includes('unique constraint');
}

export interface ToolCoreRegistryOptions {
  readonly engine: DatabaseEngine;
  readonly screen?: ProhibitedCapabilityScreen;
  readonly refusalSink?: ProhibitedRefusalSink;
  /** Injectable clock for registered_at/retired_at stamps. */
  readonly now?: () => string;
}

export class ToolCoreRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly rows = new Map<string, RegistryRow>();
  private snapshotVersion = 0;

  constructor(private readonly opts: ToolCoreRegistryOptions) {}

  private key(name: string, version: string): string {
    return `${name}@${version}`;
  }

  /** sha256 over THE canonical JSON of the metadata — execute excluded. */
  static definitionHash(metadata: ToolDefinitionMetadata): string {
    return sha256Text(canonicalJson(metadata));
  }

  /**
   * Register a definition. Order is fail-closed: schema parse → prohibited
   * screen (audited on refusal) → duplicate-hash check → SQL insert.
   */
  async register(definition: RegisteredTool): Promise<RegistryEntry> {
    const metadata = ToolDefinitionMetadataSchema.parse(definition.metadata);
    const hash = ToolCoreRegistry.definitionHash(metadata);
    const now = this.opts.now?.() ?? new Date().toISOString();

    const verdict = (this.opts.screen ?? new ProhibitedCapabilityScreen()).screenWithReport(
      {
        name: metadata.name,
        title: metadata.title,
        description: metadata.description,
        inputSchemaJson: metadata.inputSchemaJson,
        outputSchemaJson: metadata.outputSchemaJson,
        actionClass: metadata.actionClass,
        toolVersion: metadata.version,
      },
      now,
    );
    if (!verdict.ok) {
      await this.opts.refusalSink?.recordProhibitedRefusal(verdict.event);
      throw new ForesiftError('TOOL_DEFINITION_PROHIBITED', 'tool definition refused', {
        toolName: verdict.event.toolName,
        toolVersion: verdict.event.toolVersion,
        refusalJson: JSON.stringify(verdict.event),
      });
    }

    try {
      await this.opts.engine.query(
        `INSERT INTO core.core_tool_registry
           (tool_name, tool_version, definition_hash, action_class, profiles,
            required_scopes, cache_policy_id, quota_policy_id, license_policy_id,
            registered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          metadata.name,
          metadata.version,
          hash,
          metadata.actionClass,
          metadata.profiles,
          metadata.requiredScopes,
          metadata.cachePolicyId,
          metadata.quotaPolicyId,
          metadata.licensePolicyId,
          now,
        ],
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.opts.engine.query<RegistryRow>(
        `SELECT ${ROW_COLUMNS} FROM core.core_tool_registry
         WHERE tool_name = $1 AND tool_version = $2`,
        [metadata.name, metadata.version],
      );
      const priorHash = existing.rows[0]?.definition_hash;
      if (priorHash !== hash) {
        throw new ForesiftError(
          'TOOL_DEFINITION_DUPLICATE_HASH',
          'duplicate version registered with a different definition hash',
          { toolName: metadata.name, toolVersion: metadata.version },
        );
      }
      // Same-hash re-registration: idempotent convergence. Adopt the persisted
      // row into THIS instance's view (another process/instance may have
      // inserted it), keeping any locally bound execute.
      const row = existing.rows[0]!;
      if (!this.tools.has(this.key(metadata.name, metadata.version))) {
        this.tools.set(this.key(metadata.name, metadata.version), definition);
      }
      this.rows.set(this.key(metadata.name, metadata.version), row);
      this.snapshotVersion += 1;
      return this.requireEntry(metadata.name, metadata.version);
    }

    this.tools.set(this.key(metadata.name, metadata.version), {
      ...definition,
      metadata,
    });
    this.rows.set(this.key(metadata.name, metadata.version), {
      tool_name: metadata.name,
      tool_version: metadata.version,
      definition_hash: hash,
      action_class: metadata.actionClass,
      profiles: [...metadata.profiles],
      required_scopes: [...metadata.requiredScopes],
      cache_policy_id: metadata.cachePolicyId,
      quota_policy_id: metadata.quotaPolicyId,
      license_policy_id: metadata.licensePolicyId,
      registered_at: now,
      retired_at: null,
    });
    this.snapshotVersion += 1;
    return this.requireEntry(metadata.name, metadata.version);
  }

  /** Hydrate rows persisted by any process. Executable only in-process defs. */
  async hydrate(): Promise<number> {
    const result = await this.opts.engine.query<RegistryRow>(
      `SELECT ${ROW_COLUMNS} FROM core.core_tool_registry ORDER BY tool_name, tool_version`,
    );
    for (const row of result.rows) {
      this.rows.set(this.key(row.tool_name, row.tool_version), row);
      this.tools.delete(this.key(row.tool_name, row.tool_version));
    }
    this.snapshotVersion += 1;
    return result.rows.length;
  }

  /** Exact-version resolve; omit `version` for the newest non-retired one. */
  resolve(name: string, version?: string): RegistryEntry | undefined {
    if (version !== undefined) return this.entryFor(name, version);
    let best: RegistryEntry | undefined;
    for (const entry of this.snapshot().entries) {
      if (entry.metadata.name !== name || entry.retiredAt !== null) continue;
      if (best === undefined || entry.metadata.version > best.metadata.version) best = entry;
    }
    return best;
  }

  /** Non-retired entries visible to the given §16.9 profile. */
  listByProfile(profileId: ToolProfileId): RegistryEntry[] {
    return this.snapshot()
      .entries.filter(
        (entry) => entry.retiredAt === null && entry.metadata.profiles.includes(profileId),
      )
      .sort((a, b) =>
        `${a.metadata.name}@${a.metadata.version}`.localeCompare(
          `${b.metadata.name}@${b.metadata.version}`,
        ),
      );
  }

  /** Additive retirement — refuses unknown or already-retired entries. */
  async retire(name: string, version: string, retiredAt?: string): Promise<void> {
    const at = retiredAt ?? this.opts.now?.() ?? new Date().toISOString();
    const result = await this.opts.engine.query(
      `UPDATE core.core_tool_registry SET retired_at = $3
       WHERE tool_name = $1 AND tool_version = $2 AND retired_at IS NULL
       RETURNING tool_version`,
      [name, version, at],
    );
    if (result.rows.length === 0) {
      throw new ForesiftError('REGISTRY_ENTRY_UNKNOWN', 'retirement matched no live row', {
        toolName: name,
        toolVersion: version,
      });
    }
    const row = this.rows.get(this.key(name, version));
    if (row) this.rows.set(this.key(name, version), { ...row, retired_at: at });
    this.snapshotVersion += 1;
  }

  snapshot(): RegistrySnapshot {
    const entries: RegistryEntry[] = [];
    for (const [key, row] of this.rows) {
      const tool = this.tools.get(key);
      entries.push({
        metadata: tool?.metadata ?? rowToMetadata(row),
        definitionHash: row.definition_hash,
        retiredAt: row.retired_at,
        ...(tool ? { execute: tool.execute } : {}),
      });
    }
    entries.sort((a, b) =>
      `${a.metadata.name}@${a.metadata.version}`.localeCompare(
        `${b.metadata.name}@${b.metadata.version}`,
      ),
    );
    return { version: this.snapshotVersion, entries };
  }

  private entryFor(name: string, version: string): RegistryEntry | undefined {
    return this.snapshot().entries.find(
      (entry) => entry.metadata.name === name && entry.metadata.version === version,
    );
  }

  private requireEntry(name: string, version: string): RegistryEntry {
    const entry = this.entryFor(name, version);
    if (!entry) {
      throw new ForesiftError('REGISTRY_ENTRY_UNKNOWN', 'registry entry vanished after write', {
        toolName: name,
        toolVersion: version,
      });
    }
    return entry;
  }
}
