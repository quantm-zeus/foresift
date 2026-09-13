/**
 * §69.7 MCP protocol-revision × target-client compatibility matrix (T022,
 * FR-PROD-005, AC-144; plan D5).
 *
 * The matrix is DATA: `prod.mcp_revisions`, `prod.mcp_target_clients`,
 * `prod.mcp_compatibility_matrix`, and `prod.mcp_conformance_runs`. The server
 * default is the LATEST mutually tested stable revision (baseline
 * `2025-11-25` from the domain); a draft/release-candidate revision is explicit
 * opt-in and can never become the default (the SQL CHECK and the domain
 * `assertNoDraftDefault` enforce this independently).
 *
 * A revision×client cell is USABLE only when BOTH hold:
 *   1. a passing conformance run is registered for that exact pair; and
 *   2. its live-test date is non-stale (the domain `MCP_LIVE_TEST_MAX_AGE_SECONDS`).
 * A cell missing either is unusable, so an untested pair can never be silently
 * served.
 *
 * Missing/unsupported requested revisions follow the DECLARED compatibility
 * policy (`STRICT`, `BASELINE_FALLBACK`, `OPT_IN_ONLY`) rather than a private
 * allowance. Transport/revision validation is delegated to
 * `@foresift/security`'s `McpProtocolGuard` allow-list; this module never
 * re-implements content-type, method, size, session, or cursor checks.
 *
 * Strictly read-only: the matrix governs which read-only MCP surface may be
 * offered; it cannot trade, custody, sign, or submit.
 */
import {
  ErrorCode,
  ForesiftError,
  MCP_BASELINE_STABLE_REVISION,
  MCP_LIVE_TEST_MAX_AGE_SECONDS,
  assertNoDraftDefault,
  isOneOf,
  mcpCompatibilityCellUsable,
  parseMcpConformanceResult,
  parseMcpRevisionChannel,
  type McpRevisionChannel,
} from '@foresift/domain';
import { McpProtocolGuard } from '@foresift/security';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import { numericConcat, numericSortByString, numericUnique } from './shadow-safe.ts';

/** The declared behavior for a missing/unsupported requested revision. */
export const McpCompatibilityPolicy = {
  /** Refuse anything outside the usable allow-list. */
  STRICT: 'STRICT',
  /** Fall back to the usable baseline stable revision when the request is unsupported. */
  BASELINE_FALLBACK: 'BASELINE_FALLBACK',
  /** Allow only explicitly opted-in revisions in addition to the allow-list. */
  OPT_IN_ONLY: 'OPT_IN_ONLY',
} as const;
export type McpCompatibilityPolicy =
  (typeof McpCompatibilityPolicy)[keyof typeof McpCompatibilityPolicy];
export const ALL_MCP_COMPATIBILITY_POLICIES: readonly McpCompatibilityPolicy[] = Object.freeze(
  Object.values(McpCompatibilityPolicy),
);

/** Closed refusal reasons for compatibility resolution. */
export const McpCompatibilityRefusalReason = {
  NO_MUTUALLY_TESTED_STABLE_REVISION: 'NO_MUTUALLY_TESTED_STABLE_REVISION',
  REVISION_UNKNOWN: 'REVISION_UNKNOWN',
  REVISION_UNSUPPORTED: 'REVISION_UNSUPPORTED',
  REVISION_NOT_AUTHORIZED: 'REVISION_NOT_AUTHORIZED',
  DRAFT_NOT_OPTED_IN: 'DRAFT_NOT_OPTED_IN',
  CLIENT_UNKNOWN: 'CLIENT_UNKNOWN',
  CELL_NOT_USABLE: 'CELL_NOT_USABLE',
  POLICY_UNKNOWN: 'POLICY_UNKNOWN',
  TRANSPORT_REFUSED: 'TRANSPORT_REFUSED',
} as const;
export type McpCompatibilityRefusalReason =
  (typeof McpCompatibilityRefusalReason)[keyof typeof McpCompatibilityRefusalReason];

function parsePolicy(value: unknown): McpCompatibilityPolicy {
  // `isOneOf` is a numeric-index walk, never a shadowable `.includes`.
  if (typeof value === 'string' && isOneOf(value, ALL_MCP_COMPATIBILITY_POLICIES)) {
    return value;
  }
  throw new ForesiftError(
    ErrorCode.PROD_MCP_REVISION_CHANNEL_UNKNOWN,
    'unknown MCP compatibility policy',
    { value: typeof value === 'string' ? value : null },
  );
}

// --- rows -------------------------------------------------------------------

export interface McpRevisionRow {
  readonly revision: string;
  readonly channel: McpRevisionChannel;
  readonly sdkVersion: string;
  readonly transport: string;
  readonly originPolicyRef: string;
  readonly isDefault: boolean;
  readonly supersededBy: string | null;
  readonly createdAt: string;
}

export interface McpTargetClientRow {
  readonly clientId: string;
  readonly clientName: string;
  readonly version: string;
  readonly authMode: string;
}

export interface McpCompatibilityCell {
  readonly cellId: string;
  readonly revision: string;
  readonly clientId: string;
  readonly conformanceFixtureRef: string;
  readonly liveTestDate: string;
  readonly result: 'PASS' | 'FAIL';
  readonly notes: string | null;
}

interface RawRevisionRow {
  revision: string;
  channel: string;
  sdk_version: string;
  transport: string;
  origin_policy_ref: string;
  is_default: boolean;
  superseded_by: string | null;
  created_at: unknown;
}

interface RawClientRow {
  client_id: string;
  client_name: string;
  version: string;
  auth_mode: string;
}

interface RawCellRow {
  cell_id: string;
  revision: string;
  client_id: string;
  conformance_fixture_ref: string;
  live_test_date: unknown;
  result: string;
  notes: string | null;
}

interface RawRunRow {
  run_id: string;
  revision: string;
  client_id: string;
  fixture_ref: string;
  result: string;
  ran_at: unknown;
}

const toIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

// --- writers ----------------------------------------------------------------

/** Register a protocol revision. A draft revision can never be the default. */
export async function insertMcpRevision(
  engine: DatabaseEngine,
  input: {
    readonly revision: string;
    readonly channel: unknown;
    readonly sdkVersion: string;
    readonly transport: string;
    readonly originPolicyRef: string;
    readonly isDefault?: boolean;
    readonly supersededBy?: string | null;
  },
): Promise<McpRevisionRow> {
  const channel = parseMcpRevisionChannel(input.channel);
  const isDefault = input.isDefault ?? false;
  assertNoDraftDefault([{ revision: input.revision, channel, isDefault }]);
  await engine.query(
    `INSERT INTO prod.mcp_revisions
       (revision, channel, sdk_version, transport, origin_policy_ref, is_default, superseded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.revision,
      channel,
      input.sdkVersion,
      input.transport,
      input.originPolicyRef,
      isDefault,
      input.supersededBy ?? null,
    ],
  );
  return {
    revision: input.revision,
    channel,
    sdkVersion: input.sdkVersion,
    transport: input.transport,
    originPolicyRef: input.originPolicyRef,
    isDefault,
    supersededBy: input.supersededBy ?? null,
    createdAt: new Date().toISOString(),
  };
}

/** Register a supported target client. */
export async function insertMcpTargetClient(
  engine: DatabaseEngine,
  input: {
    readonly clientId: string;
    readonly clientName: string;
    readonly version: string;
    readonly capabilities?: Readonly<Record<string, unknown>>;
    readonly authMode: string;
  },
): Promise<McpTargetClientRow> {
  await engine.query(
    `INSERT INTO prod.mcp_target_clients
       (client_id, client_name, version, capabilities, auth_mode)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      input.clientId,
      input.clientName,
      input.version,
      canonicalJson(input.capabilities ?? {}),
      input.authMode,
    ],
  );
  return {
    clientId: input.clientId,
    clientName: input.clientName,
    version: input.version,
    authMode: input.authMode,
  };
}

/** Record a compatibility cell's conformance fixture, live-test date, and result. */
export async function insertMcpCompatibilityCell(
  engine: DatabaseEngine,
  input: {
    readonly cellId: string;
    readonly revision: string;
    readonly clientId: string;
    readonly conformanceFixtureRef: string;
    readonly liveTestDate: string;
    readonly result: unknown;
    readonly notes?: string | null;
  },
): Promise<McpCompatibilityCell> {
  const result = parseMcpConformanceResult(input.result);
  await engine.query(
    `INSERT INTO prod.mcp_compatibility_matrix
       (cell_id, revision, client_id, conformance_fixture_ref, live_test_date, result, notes)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)`,
    [
      input.cellId,
      input.revision,
      input.clientId,
      input.conformanceFixtureRef,
      input.liveTestDate,
      result,
      input.notes ?? null,
    ],
  );
  return {
    cellId: input.cellId,
    revision: input.revision,
    clientId: input.clientId,
    conformanceFixtureRef: input.conformanceFixtureRef,
    liveTestDate: input.liveTestDate,
    result,
    notes: input.notes ?? null,
  };
}

/** Record a conformance run for a revision×client pair. */
export async function insertMcpConformanceRun(
  engine: DatabaseEngine,
  input: {
    readonly runId: string;
    readonly revision: string;
    readonly clientId: string;
    readonly fixtureRef: string;
    readonly result: unknown;
    readonly ranAt: string;
  },
): Promise<void> {
  await engine.query(
    `INSERT INTO prod.mcp_conformance_runs
       (run_id, revision, client_id, fixture_ref, result, ran_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
    [
      input.runId,
      input.revision,
      input.clientId,
      input.fixtureRef,
      parseMcpConformanceResult(input.result),
      input.ranAt,
    ],
  );
}

// --- reads ------------------------------------------------------------------

/** Every registered revision. */
export async function mcpRevisions(engine: DatabaseEngine): Promise<readonly McpRevisionRow[]> {
  const result = await engine.query<RawRevisionRow>(
    `SELECT revision, channel, sdk_version, transport, origin_policy_ref, is_default,
            superseded_by, created_at
       FROM prod.mcp_revisions
      ORDER BY revision ASC`,
  );
  const revisions: McpRevisionRow[] = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    if (row === undefined) continue;
    revisions[revisions.length] = {
      revision: row.revision,
      channel: parseMcpRevisionChannel(row.channel),
      sdkVersion: row.sdk_version,
      transport: row.transport,
      originPolicyRef: row.origin_policy_ref,
      isDefault: row.is_default,
      supersededBy: row.superseded_by,
      createdAt: toIso(row.created_at),
    };
  }
  return revisions;
}

/** Every supported target client. */
export async function mcpTargetClients(
  engine: DatabaseEngine,
): Promise<readonly McpTargetClientRow[]> {
  const result = await engine.query<RawClientRow>(
    `SELECT client_id, client_name, version, auth_mode
       FROM prod.mcp_target_clients
      ORDER BY client_id ASC`,
  );
  const clients: McpTargetClientRow[] = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    if (row === undefined) continue;
    clients[clients.length] = {
      clientId: row.client_id,
      clientName: row.client_name,
      version: row.version,
      authMode: row.auth_mode,
    };
  }
  return clients;
}

/** Every compatibility cell. */
export async function mcpCompatibilityCells(
  engine: DatabaseEngine,
): Promise<readonly McpCompatibilityCell[]> {
  const result = await engine.query<RawCellRow>(
    `SELECT cell_id, revision, client_id, conformance_fixture_ref, live_test_date, result, notes
       FROM prod.mcp_compatibility_matrix
      ORDER BY revision ASC, client_id ASC`,
  );
  const cells: McpCompatibilityCell[] = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    if (row === undefined) continue;
    cells[cells.length] = {
      cellId: row.cell_id,
      revision: row.revision,
      clientId: row.client_id,
      conformanceFixtureRef: row.conformance_fixture_ref,
      liveTestDate: toIso(row.live_test_date),
      result: parseMcpConformanceResult(row.result),
      notes: row.notes,
    };
  }
  return cells;
}

/** A cell's usability verdict with its typed refusal reason. */
export interface CellUsability {
  readonly revision: string;
  readonly clientId: string;
  readonly usable: boolean;
  readonly reason: McpCompatibilityRefusalReason | null;
}

/**
 * Usability of one revision×client pair: a passing conformance RUN whose
 * `fixtureRef` equals the cell's declared `conformanceFixtureRef` and which is
 * inside the (non-overridable) freshness window, plus a non-stale PASS cell.
 * A run for a different fixture or an out-of-window run never satisfies the
 * cell (audit H10: provenance and staleness).
 */
export function cellUsability(input: {
  readonly cell: McpCompatibilityCell | undefined;
  readonly passingRuns: readonly {
    readonly revision: string;
    readonly clientId: string;
    readonly fixtureRef: string;
    readonly ranAt: string;
  }[];
  readonly revision: string;
  readonly clientId: string;
  readonly now: string;
  readonly maxAgeSeconds?: number;
}): CellUsability {
  const { cell, revision, clientId, now } = input;
  // The freshness window is never caller-widened: a caller may only TIGHTEN it.
  const maxAgeSeconds = Math.min(
    input.maxAgeSeconds ?? MCP_LIVE_TEST_MAX_AGE_SECONDS,
    MCP_LIVE_TEST_MAX_AGE_SECONDS,
  );
  if (cell === undefined) {
    return {
      revision,
      clientId,
      usable: false,
      reason: McpCompatibilityRefusalReason.CELL_NOT_USABLE,
    };
  }
  if (parseMcpConformanceResult(cell.result) !== 'PASS') {
    return {
      revision,
      clientId,
      usable: false,
      reason: McpCompatibilityRefusalReason.CELL_NOT_USABLE,
    };
  }
  // The run must be for THIS cell's declared fixture (provenance), and the
  // newest such run must still be inside the window (staleness).
  const nowMs = Date.parse(now);
  // Numeric-index scan/reduction only (audit HIGH): `filter`/`reduce` are
  // shadowable; a shadowed `filter` would make a registered passing run look
  // absent (fail-closed) but a shadowed `reduce` could misreport the newest run.
  let runCount = 0;
  let newestRunMs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < input.passingRuns.length; index += 1) {
    const run = input.passingRuns[index];
    if (
      run === undefined ||
      run.revision !== revision ||
      run.clientId !== clientId ||
      run.fixtureRef !== cell.conformanceFixtureRef
    ) {
      continue;
    }
    runCount += 1;
    const at = Date.parse(run.ranAt);
    if (Number.isFinite(at) && at > newestRunMs) newestRunMs = at;
  }
  if (
    runCount === 0 ||
    !Number.isFinite(newestRunMs) ||
    nowMs - newestRunMs > maxAgeSeconds * 1000
  ) {
    return {
      revision,
      clientId,
      usable: false,
      reason: McpCompatibilityRefusalReason.CELL_NOT_USABLE,
    };
  }
  const usable = mcpCompatibilityCellUsable(
    {
      revision,
      clientId,
      result: cell.result,
      liveTestDate: cell.liveTestDate,
    },
    now,
    maxAgeSeconds,
  );
  return {
    revision,
    clientId,
    usable,
    reason: usable ? null : McpCompatibilityRefusalReason.CELL_NOT_USABLE,
  };
}

/** The resolved compatibility picture at `now`. */
export interface McpCompatibilityResolution {
  readonly defaultRevision: string;
  readonly defaultChannel: McpRevisionChannel;
  readonly optInRevision: string | null;
  /** Every VALIDATED opt-in draft revision (registered + DRAFT + tested). */
  readonly optInRevisions: readonly string[];
  readonly usableRevisions: readonly string[];
  readonly cells: readonly CellUsability[];
  readonly transportOriginPolicyRef: string;
}

/**
 * Resolve the active compatibility matrix: the latest mutually tested stable
 * revision (never a draft), the per-cell usability verdicts, the transport
 * origin-policy reference of the resolved revision, and every VALIDATED opt-in
 * draft.
 *
 * Opt-ins are resolved HERE, through the matrix — never injected into an
 * allow-list by a caller (audit C3). Each requested revision must be
 * registered, have channel `DRAFT`, and be mutually tested for every client,
 * or the whole resolution refuses.
 */
export async function resolveCompatibilityMatrix(
  engine: DatabaseEngine,
  input: {
    readonly now: string;
    readonly optInDraftRevision?: string;
    readonly optInDraftRevisions?: readonly string[];
  },
): Promise<McpCompatibilityResolution> {
  const revisions = await mcpRevisions(engine);
  const clients = await mcpTargetClients(engine);
  const cells = await mcpCompatibilityCells(engine);
  const runs = await engine.query<RawRunRow>(
    `SELECT run_id, revision, client_id, fixture_ref, result, ran_at
       FROM prod.mcp_conformance_runs
      WHERE result = 'PASS'`,
  );
  // Numeric-index projections/lookups only (audit HIGH): every `.map`,
  // `new Map(array)`, `.filter`, `.every`, `for...of`, `new Set(array)` and
  // `.find` below is shadowable, and an empty `usabilityFor` made `.every`
  // vacuously true — allowing an UNTESTED revision onto the allow-list.
  const passingRuns: Array<{
    revision: string;
    clientId: string;
    fixtureRef: string;
    ranAt: string;
  }> = [];
  for (let index = 0; index < runs.rows.length; index += 1) {
    const row = runs.rows[index];
    if (row === undefined) continue;
    passingRuns[passingRuns.length] = {
      revision: row.revision,
      clientId: row.client_id,
      fixtureRef: row.fixture_ref,
      ranAt: toIso(row.ran_at),
    };
  }
  const cellByPair = new Map<string, McpCompatibilityCell>();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (cell !== undefined) cellByPair.set(`${cell.revision}\u0000${cell.clientId}`, cell);
  }

  const usabilityFor = (revision: string): readonly CellUsability[] => {
    const usability: CellUsability[] = [];
    for (let index = 0; index < clients.length; index += 1) {
      const client = clients[index];
      if (client === undefined) continue;
      usability[usability.length] = cellUsability({
        cell: cellByPair.get(`${revision}\u0000${client.clientId}`),
        passingRuns,
        revision,
        clientId: client.clientId,
        now: input.now,
      });
    }
    return usability;
  };

  const isMutuallyTested = (revision: string): boolean => {
    if (clients.length === 0) return false;
    const usability = usabilityFor(revision);
    // A numeric `every`: an empty result set must NOT be vacuously true here.
    if (usability.length !== clients.length) return false;
    for (let index = 0; index < usability.length; index += 1) {
      if (usability[index]?.usable !== true) return false;
    }
    return true;
  };

  const stable: McpRevisionRow[] = [];
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    if (
      revision !== undefined &&
      revision.channel === 'STABLE' &&
      revision.supersededBy === null &&
      isMutuallyTested(revision.revision)
    ) {
      stable[stable.length] = revision;
    }
  }
  // Descending revision-string order, numeric insertion sort (audit HIGH).
  const orderedStable = numericSortByString(stable, (row) => row.revision, true);
  const latest = orderedStable[0];
  if (latest === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'no mutually tested stable MCP revision is usable; the server cannot default a revision (§69.7)',
      { reason: McpCompatibilityRefusalReason.NO_MUTUALLY_TESTED_STABLE_REVISION },
    );
  }

  // Opt-ins are resolved THROUGH the matrix (audit C3): registered + DRAFT +
  // mutually tested, or the resolution refuses. A caller can never widen the
  // allow-list with an arbitrary revision string.
  const requestedOptIns: string[] = [];
  if (input.optInDraftRevision !== undefined)
    requestedOptIns[requestedOptIns.length] = input.optInDraftRevision;
  const declaredOptIns = input.optInDraftRevisions ?? [];
  for (let index = 0; index < declaredOptIns.length; index += 1) {
    const declared = declaredOptIns[index];
    if (declared !== undefined) requestedOptIns[requestedOptIns.length] = declared;
  }
  const uniqueOptIns = numericUnique(requestedOptIns);
  const optInRevisions: string[] = [];
  for (let index = 0; index < uniqueOptIns.length; index += 1) {
    const requested = uniqueOptIns[index] as string;
    // Numeric scan only: a shadowed `find` would report a registered draft as
    // unknown (fail-closed) but also breaks the opt-in provenance contract.
    let draft: McpRevisionRow | undefined;
    for (let revisionIndex = 0; revisionIndex < revisions.length; revisionIndex += 1) {
      const candidate = revisions[revisionIndex];
      if (candidate !== undefined && candidate.revision === requested) {
        draft = candidate;
        break;
      }
    }
    if (draft === undefined) {
      throw new ForesiftError(
        ErrorCode.PROD_MCP_REVISION_CHANNEL_UNKNOWN,
        `opted-in MCP revision ${requested} is not registered`,
        { reason: McpCompatibilityRefusalReason.REVISION_UNKNOWN },
      );
    }
    if (draft.channel !== 'DRAFT') {
      throw new ForesiftError(
        ErrorCode.PROD_MCP_DRAFT_DEFAULT,
        `revision ${requested} is not a draft/RC revision`,
        { reason: McpCompatibilityRefusalReason.DRAFT_NOT_OPTED_IN },
      );
    }
    if (!isMutuallyTested(draft.revision)) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        `opted-in draft revision ${draft.revision} has no usable conformance cell for every client`,
        { reason: McpCompatibilityRefusalReason.CELL_NOT_USABLE },
      );
    }
    optInRevisions[optInRevisions.length] = draft.revision;
  }
  const optInRevision = optInRevisions[0] ?? null;

  const usableRevisions: string[] = [];
  for (let index = 0; index < orderedStable.length; index += 1) {
    const revision = orderedStable[index];
    if (revision !== undefined) usableRevisions[usableRevisions.length] = revision.revision;
  }
  const defaultRevision = latest.revision;
  let defaultRow: McpRevisionRow | undefined;
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    if (revision !== undefined && revision.revision === defaultRevision) {
      defaultRow = revision;
      break;
    }
  }
  return {
    defaultRevision,
    defaultChannel: defaultRow?.channel ?? 'STABLE',
    optInRevision,
    optInRevisions,
    usableRevisions,
    cells: usabilityFor(defaultRevision),
    transportOriginPolicyRef: defaultRow?.originPolicyRef ?? '',
  };
}

/** A protocol-version resolution decision. */
export interface ProtocolRevisionResolution {
  readonly decision: 'ALLOW';
  readonly requestedRevision: string;
  readonly resolvedRevision: string;
  readonly policy: McpCompatibilityPolicy;
  readonly substituted: boolean;
}

/**
 * Resolve a requested protocol revision against the matrix allow-list. The
 * allow-list is handed to `@foresift/security`'s `McpProtocolGuard`, which
 * performs the transport/allow-list check; this function owns only the
 * DECLARED compatibility policy for an unsupported request.
 */
export async function resolveProtocolRevision(
  engine: DatabaseEngine,
  input: {
    readonly requestedRevision: string | undefined;
    readonly now: string;
    readonly policy: unknown;
    readonly optInRevisions?: readonly string[];
  },
): Promise<ProtocolRevisionResolution> {
  const policy = parsePolicy(input.policy);
  // Opt-ins are validated by the matrix resolver, never injected raw (C3).
  const resolution = await resolveCompatibilityMatrix(engine, {
    now: input.now,
    ...(input.optInRevisions === undefined ? {} : { optInDraftRevisions: input.optInRevisions }),
  });
  // Numeric concat/de-dupe only (audit HIGH): `[...new Set([...a, ...b])]` reads
  // `Symbol.iterator` twice, so a shadowed iterator would hand the guard an
  // EMPTY allow-list.
  const allowedRevisions = numericUnique(
    numericConcat(resolution.usableRevisions, resolution.optInRevisions),
  );
  const guard = new McpProtocolGuard({
    allowedRevisions,
    maxMessageBytes: 1_000_000,
  });
  const verdict = guard.inspect({
    protocolRevision: input.requestedRevision,
    contentType: 'application/json',
    method: 'POST',
    messageBytes: 1,
  });
  // Defence in depth (audit R11): the guard's own membership test is numeric,
  // but this surface never trusts a third-party verdict for the authority
  // decision. Re-derive membership numerically from the validated allow-list,
  // so a shadowed `Array.prototype.includes` (or any guard regression) cannot
  // turn an arbitrary revision into an ALLOW here.
  const requestedIsAllowed =
    input.requestedRevision !== undefined && isOneOf(input.requestedRevision, allowedRevisions);
  if (
    verdict.decision === 'ALLOW' &&
    input.requestedRevision !== undefined &&
    !requestedIsAllowed
  ) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      `MCP protocol guard ALLOWed revision ${JSON.stringify(
        input.requestedRevision,
      )} although it is not a member of the validated compatibility allow-list`,
      { reason: McpCompatibilityRefusalReason.REVISION_UNKNOWN },
    );
  }
  if (verdict.decision === 'ALLOW' && input.requestedRevision !== undefined) {
    return {
      decision: 'ALLOW',
      requestedRevision: input.requestedRevision,
      resolvedRevision: input.requestedRevision,
      policy,
      substituted: false,
    };
  }
  // Unsupported (or missing) request: follow the DECLARED policy.
  if (verdict.decision === 'REFUSE' && verdict.reason !== 'REVISION_UNSUPPORTED') {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      `MCP protocol guard refused the request (${verdict.reason})`,
      { reason: McpCompatibilityRefusalReason.TRANSPORT_REFUSED, guardReason: verdict.reason },
    );
  }
  switch (policy) {
    case McpCompatibilityPolicy.STRICT:
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        `MCP revision ${String(input.requestedRevision)} is unsupported and the policy is STRICT`,
        { reason: McpCompatibilityRefusalReason.REVISION_UNSUPPORTED },
      );
    case McpCompatibilityPolicy.OPT_IN_ONLY:
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        `MCP revision ${String(input.requestedRevision)} is not explicitly opted in`,
        { reason: McpCompatibilityRefusalReason.REVISION_NOT_AUTHORIZED },
      );
    case McpCompatibilityPolicy.BASELINE_FALLBACK: {
      // Numeric `isOneOf`, never a shadowable `.includes`.
      const baselineUsable = isOneOf(MCP_BASELINE_STABLE_REVISION, resolution.usableRevisions);
      if (!baselineUsable) {
        throw new ForesiftError(
          ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
          `MCP revision ${String(input.requestedRevision)} is unsupported and baseline ${MCP_BASELINE_STABLE_REVISION} is not usable`,
          { reason: McpCompatibilityRefusalReason.REVISION_UNSUPPORTED },
        );
      }
      return {
        decision: 'ALLOW',
        requestedRevision: String(input.requestedRevision),
        resolvedRevision: MCP_BASELINE_STABLE_REVISION,
        policy,
        substituted: true,
      };
    }
    default: {
      const exhaustive: never = policy;
      throw new ForesiftError(
        ErrorCode.PROD_MCP_REVISION_CHANNEL_UNKNOWN,
        `unknown MCP compatibility policy ${String(exhaustive)}`,
        { reason: McpCompatibilityRefusalReason.POLICY_UNKNOWN },
      );
    }
  }
}

/** The §69.7 baseline constant, re-exported for callers. */
export const MCP_COMPATIBILITY_BASELINE_REVISION = MCP_BASELINE_STABLE_REVISION;
export const MCP_COMPATIBILITY_GUARD_BASELINE_REVISION = MCP_PROTOCOL_BASELINE_REVISION;
