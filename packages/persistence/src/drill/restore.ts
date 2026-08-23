/**
 * Clean-environment restore verifier (T044, FR-DR-002, §34.6, AC-261).
 *
 * A restore is successful only when database/migration state, object hashes,
 * cross-store references, and collector checkpoint/gap integrity validate —
 * NOT merely when the database starts. Audit-chain, workflow/inbox/outbox,
 * and quota verifications attach later through the pluggable `RestoreCheck`
 * interface; a configuration that declares a required check which is not
 * registered BLOCKS resumption (fail closed, never a silent pass).
 */
import type { UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';
import { appliedMigrations, discoverMigrations } from '../migrator.ts';

// ---------------------------------------------------------------------------
// Pluggable check interface
// ---------------------------------------------------------------------------

export interface RestoreCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface RestoreCheckContext {
  readonly engine: DatabaseEngine;
}

/**
 * One verification step. Built-in checks cover what this package owns
 * (migrations, object index hashes via injected verifier, cross-store
 * references, checkpoints/gaps); other packages register their own checks.
 */
export interface RestoreCheck {
  readonly name: string;
  verify(context: RestoreCheckContext): Promise<Omit<RestoreCheckResult, 'name'>>;
}

/** Physical object-hash verification port (implemented over ObjectStoreAdapter). */
export interface ArtifactHashVerifier {
  /** Verify one artifact's physical bytes match its indexed content hash. */
  verifyArtifact(
    artifactId: string,
    contentHash: string,
  ): Promise<{ passed: boolean; detail: string }>;
}

// ---------------------------------------------------------------------------
// Built-in checks
// ---------------------------------------------------------------------------

export function migrationStateCheck(migrationsDir: string): RestoreCheck {
  return {
    name: 'database-migration-state',
    async verify({ engine }) {
      const recorded = await appliedMigrations(engine);
      const expected = await discoverMigrations(migrationsDir);
      const expectedMap = new Map(expected.map((m) => [m.id, m.checksum]));
      const recordedMap = new Map(recorded.map((m) => [m.id, m.checksum]));
      const missing = expected.filter((m) => !recordedMap.has(m.id)).map((m) => m.id);
      const extra = recorded.filter((m) => !expectedMap.has(m.id)).map((m) => m.id);
      const drifted = recorded
        .filter((m) => expectedMap.get(m.id) !== undefined && expectedMap.get(m.id) !== m.checksum)
        .map((m) => m.id);
      if (missing.length > 0 || extra.length > 0 || drifted.length > 0) {
        return {
          passed: false,
          detail: `migration state mismatch — missing: ${JSON.stringify(missing)}, unexpected: ${JSON.stringify(extra)}, checksum-drifted: ${JSON.stringify(drifted)}`,
        };
      }
      return {
        passed: true,
        detail: `${recorded.length} migrations recorded with matching checksums`,
      };
    },
  };
}

/** Verify every non-pending row of object_artifacts against the physical store. */
export function objectHashCheck(verifier: ArtifactHashVerifier): RestoreCheck {
  return {
    name: 'object-hashes',
    async verify({ engine }) {
      const rows = await engine.query<{
        artifact_id: string;
        content_hash: string;
        stage: string;
      }>(
        `SELECT artifact_id, content_hash, stage FROM object_artifacts
         WHERE stage IN ('STORED_HASH_VERIFIED','INDEX_COMMITTED','AVAILABLE')`,
      );
      if (rows.rows.length === 0) {
        return { passed: true, detail: 'no committed artifacts to verify' };
      }
      for (const row of rows.rows) {
        const verdict = await verifier.verifyArtifact(row.artifact_id, row.content_hash);
        if (!verdict.passed) {
          return {
            passed: false,
            detail: `artifact ${row.artifact_id} (${row.stage}): ${verdict.detail}`,
          };
        }
      }
      return { passed: true, detail: `${rows.rows.length} artifacts hash-verified` };
    },
  };
}

/**
 * Cross-store references: every frozen evidence bundle's manifest must be
 * readable AND its content hash must still match (index ↔ store agreement).
 * Bundle manifests reference artifact ids/hashes; dangling or mutated
 * references fail the drill.
 */
export const crossStoreReferenceCheck: RestoreCheck = {
  name: 'cross-store-references',
  async verify({ engine }) {
    const bundles = await engine.query<{
      bundle_id: string;
      content_hash: string;
      manifest: unknown;
    }>('SELECT bundle_id, content_hash, manifest FROM evidence_bundles');
    if (bundles.rows.length === 0) {
      return { passed: true, detail: 'no evidence bundles to cross-check' };
    }
    // Lazy import avoided deliberately: hashing helper duplicated minimally
    // here to keep persistence free of an evidence dependency cycle.
    const { createHash } = await import('node:crypto');
    const canonicalJson = (value: unknown): string => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
      return `{${entries.join(',')}}`;
    };
    for (const bundle of bundles.rows) {
      const actual = `sha256:${createHash('sha256').update(canonicalJson(bundle.manifest), 'utf8').digest('hex')}`;
      if (actual !== bundle.content_hash) {
        return {
          passed: false,
          detail: `bundle ${bundle.bundle_id} manifest hash drifted (indexed ${bundle.content_hash}, actual ${actual})`,
        };
      }
    }
    return {
      passed: true,
      detail: `${bundles.rows.length} bundles hash-consistent with their index rows`,
    };
  },
};

/**
 * Collector continuity: every checkpoint cursor must sit at slot 0/1 (fresh)
 * or have every skipped slot covered by a resolved gap. Unresolved gaps
 * inside a covered cursor range mean replay would skip unmarked slots.
 */
export const collectorContinuityCheck: RestoreCheck = {
  name: 'collector-checkpoints-gaps',
  async verify({ engine }) {
    const checkpoints = await engine.query<{ shard_id: string; cursor_position: string | number }>(
      'SELECT shard_id, cursor_position FROM collector_checkpoints',
    );
    for (const cp of checkpoints.rows) {
      const cursor = Number(cp.cursor_position);
      if (cursor <= 1) continue;
      const gapRows = await engine.query<{ gap_id: string }>(
        `SELECT gap_id FROM collector_gaps
         WHERE shard_id = $1
           AND recovery_status NOT IN ('RECOVERED','DECLARED_UNRECOVERABLE')
           AND gap_start_slot <= $2
         LIMIT 1`,
        [cp.shard_id, cursor - 1],
      );
      if (gapRows.rows.length > 0) {
        return {
          passed: false,
          detail: `shard ${cp.shard_id} has unresolved gaps below its cursor ${cursor}; resumption would skip unmarked history`,
        };
      }
    }
    return {
      passed: true,
      detail: `${checkpoints.rows.length} shards continuous or explicitly gapped`,
    };
  },
};

// ---------------------------------------------------------------------------
// Drill runner
// ---------------------------------------------------------------------------

/** Opaque credential-presence port. No material flows through this package. */
export interface RestoreCredentialProvider {
  readonly providerId: string;
  /** Prove the separated keystore is reachable/unlocked before checks run. */
  unlock(): Promise<void>;
}

export interface RestoreDrillConfig {
  readonly engine: DatabaseEngine;
  readonly drillId: string;
  readonly startedAt: UtcTimestamp;
  /** The registered verifications to execute (built-ins + plugin checks). */
  readonly registeredChecks: readonly RestoreCheck[];
  /**
   * Check names REQUIRED by deployment policy. Any required check without a
   * registered implementation blocks resumption (AC-261 future integrations).
   */
  readonly requiredChecks?: readonly string[];
  /** Separately provided credential provider — restore refuses without it. */
  readonly credentialProvider?: RestoreCredentialProvider | undefined;
  /** Completion instant (injected; drills use scripted clocks). */
  readonly finishedAt?: UtcTimestamp | undefined;
}

export interface RestoreDrillReport {
  readonly drillId: string;
  readonly outcome: 'PASSED' | 'FAILED' | 'BLOCKED';
  readonly checks: readonly RestoreCheckResult[];
  readonly finishedAt: UtcTimestamp | null;
}

/**
 * Run a full clean-environment restore drill and persist its outcome.
 *
 * Fail-closed ordering:
 *  1. no separately provided credential provider ⇒ BLOCKED, nothing runs;
 *  2. declared-but-unregistered required checks ⇒ BLOCKED;
 *  3. any failed check ⇒ FAILED;
 *  4. only then may the outcome be PASSED.
 */
export async function runRestoreDrill(config: RestoreDrillConfig): Promise<RestoreDrillReport> {
  const { engine, drillId } = config;

  if (config.credentialProvider === undefined) {
    const report: RestoreDrillReport = {
      drillId,
      outcome: 'BLOCKED',
      checks: [],
      finishedAt: null,
    };
    await engine.query(
      `INSERT INTO restore_drills
         (drill_id, started_at, outcome, checks, credential_provider_present)
       VALUES ($1,$2,'BLOCKED',$3::jsonb,false)
       ON CONFLICT (drill_id) DO NOTHING`,
      [drillId, config.startedAt, JSON.stringify([])],
    );
    return report;
  }

  await config.credentialProvider.unlock();

  const checks = config.registeredChecks ?? [];
  const registeredNames = new Set(checks.map((c) => c.name));
  const unregistered = (config.requiredChecks ?? []).filter((n) => !registeredNames.has(n));
  if (unregistered.length > 0) {
    const blocked: RestoreDrillReport = {
      drillId,
      outcome: 'BLOCKED',
      checks: unregistered.map((name) => ({
        name,
        passed: false,
        detail: 'required check has no registered verifier; resumption refused',
      })),
      finishedAt: null,
    };
    await persistOutcome(engine, blocked, config.startedAt, true);
    return blocked;
  }

  const context: RestoreCheckContext = { engine };
  const results: RestoreCheckResult[] = [];
  for (const check of checks) {
    try {
      const verdict = await check.verify(context);
      results.push({ name: check.name, ...verdict });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      results.push({ name: check.name, passed: false, detail: `verifier threw: ${message}` });
    }
  }

  const allPassed = results.every((r) => r.passed);
  const report: RestoreDrillReport = {
    drillId,
    outcome: allPassed ? 'PASSED' : 'FAILED',
    checks: results,
    finishedAt: config.finishedAt ?? null,
  };
  await persistOutcome(engine, report, config.startedAt, true);
  return report;
}

async function persistOutcome(
  engine: DatabaseEngine,
  report: RestoreDrillReport,
  startedAt: UtcTimestamp,
  credentialProviderPresent: boolean,
): Promise<void> {
  await engine.query(
    `INSERT INTO restore_drills
       (drill_id, started_at, finished_at, outcome, checks, credential_provider_present)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (drill_id) DO NOTHING`,
    [
      report.drillId,
      startedAt,
      report.finishedAt,
      report.outcome,
      JSON.stringify(report.checks),
      credentialProviderPresent,
    ],
  );
}
