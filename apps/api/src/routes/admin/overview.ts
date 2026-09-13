/**
 * §28.2 provider-call-free overview read model
 * (T015, FR-ADM-001, PRD §28.2, §28.9, §33.6; AC-060, AC-061, AC-062, AC-063,
 * AC-260…AC-264).
 *
 * `assembleOverview(ports, clock)` is a TOTAL function over the injected
 * READ-ONLY source ports (T014) plus an injected clock. It computes NO metric,
 * gate, forecast, or status of its own (plan D1): every value arrives already
 * computed by its owning package, and the assembly only validates, names,
 * hashes, and persists.
 *
 * Provider-call-free by construction (plan D2, ADR-G2ADM-3). The port object
 * this function consumes has no provider, model, or notification capability in
 * scope; the ONLY persistence is ONE immutable `adm.overview_snapshots` append
 * per assembly, pinned to `provider_calls_triggered = 0` and
 * `external_write_attempts = 0` by both the shared schema and the SQL CHECK.
 *
 * Every one of the 15 §28.2/§33.6 sections is always present. A source that is
 * unknown, stale, or refused renders EXPLICITLY with its marker, quality codes,
 * and detail — a section is never silently dropped, and a degraded source can
 * never be reported as a fresh complete refresh. An open provider incident
 * FORCES its section below FRESH, so a caller cannot manufacture a fresh
 * complete claim from an outage (AC-061).
 *
 * Shadow-safe discipline (audit NEW-M4/NEW-M5). Every freshness/completeness
 * decision here walks arrays by NUMERIC INDEX and uses `isOneOf` for membership
 * — never `.map/.filter/.some/.find/.includes/.push`, `for…of`, spread, or
 * `new Set(array)`.
 *
 * Strictly read-only: no trading, custody, wallet-signing, private-key, or
 * transaction-submission capability, and no provider/model/notification call.
 */
import { randomUUID } from 'node:crypto';
import { isOneOf } from '@foresift/domain';
import {
  AdminErrorCode,
  ALL_SYSTEM_MODES,
  OverviewSectionSchema,
  OverviewSnapshotRowSchema,
  type AdminOverviewFreshness,
  type OverviewSection,
  type OverviewSnapshotRow,
  type SystemMode,
} from '@foresift/shared-schemas';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { AdminControlError } from './control-safety.ts';
import {
  ADMIN_OVERVIEW_SECTION_KEYS,
  OVERVIEW_SECTION_OWNERS,
  SECTION_PAYLOAD_SCHEMAS,
  unknownRead,
  worstFreshness,
  type AdminOverviewSourcePorts,
  type SourceRead,
} from './overview-sources.ts';

/**
 * The ONLY persistence on the overview assembly path: one immutable snapshot
 * append. It deliberately has no update/delete method, so the overview can
 * never rewrite history.
 */
export interface OverviewSnapshotSink {
  record(snapshot: OverviewSnapshotRow): Promise<void>;
}

/**
 * The exact object `assembleOverview` receives. `sources` is the read-only,
 * provider-free port surface; `snapshots` is the single immutable append. A
 * caller may attach provider/model/notification clients to the same object (the
 * tests do, to prove they are never reached), but this function only ever
 * touches these two properties.
 */
export interface AdminOverviewPorts {
  readonly sources: AdminOverviewSourcePorts;
  readonly snapshots: OverviewSnapshotSink;
}

/** One assembled section: hash envelope plus its live payload. */
export interface AssembledOverviewSection {
  readonly sectionKey: OverviewSection['sectionKey'];
  readonly ownerPackage: string;
  readonly freshness: AdminOverviewFreshness;
  readonly rowRefs: readonly string[];
  readonly qualityCodes: readonly string[];
  readonly detail: string | null;
  readonly computedAt: string;
  readonly payloadHash: string;
  readonly payload: unknown | null;
}

/** The completed §28.2 read model plus the persisted snapshot it produced. */
export interface AssembledOverview {
  readonly snapshot: OverviewSnapshotRow;
  readonly sections: readonly AssembledOverviewSection[];
  readonly systemMode: SystemMode;
  readonly freshness: AdminOverviewFreshness;
  readonly complete: boolean;
  readonly refreshRef: string;
  readonly assembledAt: string;
  readonly providerCallsTriggered: 0;
  readonly externalWriteAttempts: 0;
}

type SectionReader = (sources: AdminOverviewSourcePorts) => Promise<SourceRead<unknown>>;

/**
 * Section → port reader. Each value is the READ-ONLY port method for that
 * section; there is no provider/model/notification entry anywhere in this
 * table.
 */
const SECTION_READERS: Readonly<Record<OverviewSection['sectionKey'], SectionReader>> =
  Object.freeze({
    SYSTEM_MODE: (sources) => sources.readSystemMode(),
    KILL_SWITCH_STATE: (sources) => sources.readKillSwitchState(),
    PROVIDER_INCIDENTS: (sources) => sources.readProviderIncidents(),
    QUOTA_EXHAUSTION_FORECAST: (sources) => sources.readQuotaExhaustionForecast(),
    ACTIVE_SCHEDULES: (sources) => sources.readActiveSchedules(),
    SCHEDULE_DRIFT: (sources) => sources.readScheduleDrift(),
    WORKFLOW_COUNTS: (sources) => sources.readWorkflowCounts(),
    CANDIDATE_LIFECYCLE_RISK_COUNTS: (sources) => sources.readCandidateCounts(),
    ALERT_PRECISION_RECALL: (sources) => sources.readAlertPrecisionRecall(),
    MISSED_GEMS: (sources) => sources.readMissedGems(),
    FUNNEL_FAILURES: (sources) => sources.readFunnelFailures(),
    MODEL_PROVIDER_COST: (sources) => sources.readModelProviderCost(),
    STORAGE_GROWTH: (sources) => sources.readStorageGrowth(),
    LATEST_BACKUP_STATUS: (sources) => sources.readLatestBackupStatus(),
    RECOVERY_READINESS: (sources) => sources.readRecoveryReadiness(),
  });

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : 'unknown failure';
}

/**
 * Numeric-index array copy that is TOTAL for a malformed port: a non-array
 * `source` yields an empty list instead of throwing, so a buggy injected port
 * degrades its section rather than crashing the whole refresh.
 */
function numericCopy<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  if (!Array.isArray(source)) return copy;
  for (let index = 0; index < source.length; index += 1) {
    copy[copy.length] = source[index] as T;
  }
  return copy;
}

function appendUnique(target: string[], source: readonly string[]): void {
  const list = numericCopy(source);
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index];
    if (value === undefined || value.length === 0) continue;
    let seen = false;
    for (let seenIndex = 0; seenIndex < target.length; seenIndex += 1) {
      if (target[seenIndex] === value) {
        seen = true;
        break;
      }
    }
    if (!seen) target[target.length] = value;
  }
}

/**
 * A FRESH section must name the rows it came from. An empty-but-fresh result
 * (for example "no open incidents") names a synthetic observation-head ref so
 * the provenance requirement is satisfied honestly rather than by dropping the
 * freshness claim.
 */
function normalizeRowRefs(
  sectionKey: OverviewSection['sectionKey'],
  ownerPackage: string,
  freshness: AdminOverviewFreshness,
  rowRefs: readonly string[],
  computedAt: string,
): string[] {
  const refs = numericCopy(rowRefs);
  if (freshness === 'FRESH' && refs.length === 0) {
    refs[refs.length] = `${ownerPackage}:${sectionKey}:empty@${computedAt}`;
  }
  return refs;
}

/**
 * Validate a source payload through its section schema. An invalid payload
 * degrades to UNKNOWN — it is never dropped and never trusted.
 */
function validatePayload(
  sectionKey: OverviewSection['sectionKey'],
  read: SourceRead<unknown>,
): { readonly payload: unknown | null; readonly read: SourceRead<unknown> } {
  if (read.payload === null) {
    // A null payload is only legal for an explicit UNKNOWN/REFUSED marker; a
    // port claiming FRESH/STALE with no data is degraded, never trusted.
    if (read.freshness === 'UNKNOWN' || read.freshness === 'REFUSED') {
      return { payload: null, read };
    }
    return {
      payload: null,
      read: unknownRead(
        read.ownerPackage,
        'source returned no payload while claiming a present observation',
        read.computedAt,
      ),
    };
  }
  const parsed = SECTION_PAYLOAD_SCHEMAS[sectionKey].safeParse(read.payload);
  if (!parsed.success) {
    return {
      payload: null,
      read: unknownRead(
        read.ownerPackage,
        `section payload failed validation: ${parsed.error.issues.length} issue(s)`,
        read.computedAt,
      ),
    };
  }
  return { payload: parsed.data, read };
}

/**
 * Enforce the port's own `expiresAt`: an observation past its declared expiry
 * is STALE, so an aged source can never be reported fresh complete.
 */
function applyExpiryFreshness(read: SourceRead<unknown>, now: string): SourceRead<unknown> {
  if (read.freshness !== 'FRESH' || read.expiresAt === null) return read;
  const expiresMs = Date.parse(read.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.parse(now) < expiresMs) return read;
  return {
    ...read,
    freshness: 'STALE',
    detail: read.detail ?? 'the source observation is past its declared expiry',
  };
}

/**
 * Provider-incident freshness floor (AC-061): while any provider incident is
 * open the section can NEVER be FRESH, regardless of what a port claims, and
 * therefore the refresh can never be "fresh complete".
 */
function applyProviderIncidentFloor(read: SourceRead<unknown>): SourceRead<unknown> {
  if (read.payload === null || typeof read.payload !== 'object') return read;
  const payload = read.payload as { openCount?: unknown; incidents?: unknown };
  const declared = typeof payload.openCount === 'number' ? payload.openCount : 0;
  // Fail closed on an inconsistent payload too: an incident LIST is at least as
  // authoritative as its count, so a lying `openCount: 0` cannot hide one.
  const listed = Array.isArray(payload.incidents) ? (payload.incidents as unknown[]).length : 0;
  const openCount = declared > listed ? declared : listed;
  if (openCount <= 0 || read.freshness !== 'FRESH') return read;
  return {
    ...read,
    freshness: 'STALE',
    detail:
      read.detail ??
      `${openCount} provider incident(s) are open; the section is not fresh complete`,
  };
}

/** The fail-closed system mode: an unknown mode resolves DISABLED. */
function resolveSystemMode(read: SourceRead<unknown>): SystemMode {
  if (read.payload !== null && typeof read.payload === 'object') {
    const candidate = (read.payload as { systemMode?: unknown }).systemMode;
    if (typeof candidate === 'string' && isOneOf(candidate, ALL_SYSTEM_MODES)) {
      return candidate;
    }
  }
  return 'DISABLED';
}

/** Default snapshot sink: exactly one immutable append to `adm.overview_snapshots`. */
export function createOverviewSnapshotSink(options: {
  readonly engine: DatabaseEngine;
}): OverviewSnapshotSink {
  return {
    async record(snapshot: OverviewSnapshotRow): Promise<void> {
      const parsed = OverviewSnapshotRowSchema.parse(snapshot);
      await options.engine.query(
        `INSERT INTO adm.overview_snapshots
           (snapshot_id, generated_at, system_mode, sections, source_refs,
            section_hashes, read_model_hash, provider_calls_triggered, external_write_attempts)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)`,
        [
          parsed.snapshotId,
          parsed.generatedAt,
          parsed.systemMode,
          JSON.stringify(parsed.sections),
          JSON.stringify(parsed.sourceRefs),
          JSON.stringify(parsed.sectionHashes),
          parsed.readModelHash,
          parsed.providerCallsTriggered,
          parsed.externalWriteAttempts,
        ],
      );
    },
  };
}

/**
 * Assemble the §28.2 overview read model over the injected read-only ports and
 * persist exactly one immutable snapshot. `clock` is injected so freshness and
 * ordering are deterministic in tests.
 */
export async function assembleOverview(
  ports: AdminOverviewPorts,
  clock: () => number,
): Promise<AssembledOverview> {
  const assembledAt = new Date(clock()).toISOString();
  const refreshRef = `ovr_${randomUUID()}`;

  const sections: AssembledOverviewSection[] = [];
  const envelopes: OverviewSection[] = [];
  const sectionHashes: Record<string, string> = {};
  const sourceRefs: string[] = [];
  const freshnessValues: AdminOverviewFreshness[] = [];

  for (let index = 0; index < ADMIN_OVERVIEW_SECTION_KEYS.length; index += 1) {
    const sectionKey = ADMIN_OVERVIEW_SECTION_KEYS[index];
    if (sectionKey === undefined) continue;
    const reader = SECTION_READERS[sectionKey];
    const defaultOwner = OVERVIEW_SECTION_OWNERS[sectionKey];

    let read: SourceRead<unknown>;
    try {
      read = await reader(ports.sources);
    } catch (error) {
      read = unknownRead(defaultOwner, `source read failed: ${errorDetail(error)}`, assembledAt);
    }

    const validated = validatePayload(sectionKey, read);
    const expired = applyExpiryFreshness(validated.read, assembledAt);
    const floored =
      sectionKey === 'PROVIDER_INCIDENTS' ? applyProviderIncidentFloor(expired) : expired;
    const payload = floored === validated.read ? validated.payload : floored.payload;

    // A malformed provenance field from a buggy port must not crash the total
    // assembly; fall back to the section's declared owner and the assembly
    // instant so the section still renders explicitly.
    const ownerPackage =
      typeof floored.ownerPackage === 'string' && floored.ownerPackage.length > 0
        ? floored.ownerPackage
        : defaultOwner;
    const computedAt =
      typeof floored.computedAt === 'string' && Number.isFinite(Date.parse(floored.computedAt))
        ? floored.computedAt
        : assembledAt;

    const rowRefs = normalizeRowRefs(
      sectionKey,
      ownerPackage,
      floored.freshness,
      floored.rowRefs,
      computedAt,
    );
    const payloadHash = sha256Text(
      canonicalJson({
        sectionKey,
        freshness: floored.freshness,
        payload,
        detail: payload === null ? floored.detail : null,
      }),
    );

    let envelope: OverviewSection;
    try {
      envelope = OverviewSectionSchema.parse({
        sectionKey,
        ownerPackage,
        freshness: floored.freshness,
        rowRefs,
        payloadHash,
        computedAt,
      });
    } catch (error) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_SURFACE_FAILURE,
        `overview section '${sectionKey}' could not be enveloped: ${errorDetail(error)}`,
        { sectionKey, refreshRef },
      );
    }

    sections[sections.length] = {
      sectionKey,
      ownerPackage: envelope.ownerPackage,
      freshness: envelope.freshness,
      rowRefs: numericCopy(envelope.rowRefs),
      qualityCodes: numericCopy(floored.qualityCodes),
      detail: floored.detail,
      computedAt: envelope.computedAt,
      payloadHash: envelope.payloadHash,
      payload,
    };
    sectionHashes[sectionKey] = envelope.payloadHash;
    envelopes[envelopes.length] = envelope;
    appendUnique(sourceRefs, envelope.rowRefs);
    freshnessValues[freshnessValues.length] = envelope.freshness;
  }

  if (sections.length !== ADMIN_OVERVIEW_SECTION_KEYS.length) {
    throw new AdminControlError(
      AdminErrorCode.ADMIN_OVERVIEW_SECTION_UNKNOWN,
      'the overview assembly dropped one or more required sections',
      { expected: ADMIN_OVERVIEW_SECTION_KEYS.length, actual: sections.length, refreshRef },
    );
  }

  // The system-mode payload is read back from the assembled sections so a
  // degraded SOURCE_MODE read resolves DISABLED (fail-closed), never ACTIVE.
  let systemMode: SystemMode = 'DISABLED';
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (section === undefined || section.sectionKey !== 'SYSTEM_MODE') continue;
    systemMode = resolveSystemMode({
      ownerPackage: section.ownerPackage,
      freshness: section.freshness,
      rowRefs: section.rowRefs,
      qualityCodes: section.qualityCodes,
      detail: section.detail,
      computedAt: section.computedAt,
      expiresAt: null,
      payload: section.payload,
    });
  }

  const freshness = worstFreshness(freshnessValues);
  let complete = true;
  for (let index = 0; index < freshnessValues.length; index += 1) {
    if (freshnessValues[index] !== 'FRESH') {
      complete = false;
      break;
    }
  }

  // The PERSISTED read model is the provenance envelope set (schema-validated
  // `OverviewSection`s); the richer per-section payloads stay in this response
  // and are pinned by their payload hashes, so no owner value is duplicated in
  // adm state (D9).
  const readModelHash = sha256Text(
    canonicalJson({
      systemMode,
      sections: envelopes,
      sourceRefs,
    }),
  );

  let snapshot: OverviewSnapshotRow;
  try {
    snapshot = OverviewSnapshotRowSchema.parse({
      snapshotId: `ovs_${randomUUID()}`,
      generatedAt: assembledAt,
      systemMode,
      sections: envelopes,
      sourceRefs,
      sectionHashes,
      readModelHash,
      providerCallsTriggered: 0,
      externalWriteAttempts: 0,
    });
  } catch (error) {
    throw new AdminControlError(
      AdminErrorCode.ADMIN_SURFACE_FAILURE,
      `the overview snapshot failed validation: ${errorDetail(error)}`,
      { refreshRef },
    );
  }

  // EXACTLY ONE immutable append per assembly. No retry, no second write.
  await ports.snapshots.record(snapshot);

  return {
    snapshot,
    sections,
    systemMode,
    freshness,
    complete,
    refreshRef,
    assembledAt,
    providerCallsTriggered: 0,
    externalWriteAttempts: 0,
  };
}
