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
  mcpCompatibilityCellUsable,
  parseMcpConformanceResult,
  parseMcpRevisionChannel,
  type McpRevisionChannel,
} from '@foresift/domain';
import { McpProtocolGuard } from '@foresift/security';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';

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
export const ALL_MCP_COMPATIBILITY_POLICIES: readonly McpCompatibilityPolicy[] =
  Object.values(McpCompatibilityPolicy);

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
  if (
    typeof value === 'string' &&
    (ALL_MCP_COMPATIBILITY_POLICIES as readonly string[]).includes(value)
  ) {
    return value as McpCompatibilityPolicy;
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
  return result.rows.map((row) => ({
    revision: row.revision,
    channel: parseMcpRevisionChannel(row.channel),
    sdkVersion: row.sdk_version,
    transport: row.transport,
    originPolicyRef: row.origin_policy_ref,
    isDefault: row.is_default,
    supersededBy: row.superseded_by,
    createdAt: toIso(row.created_at),
  }));
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
  return result.rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    version: row.version,
    authMode: row.auth_mode,
  }));
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
  return result.rows.map((row) => ({
    cellId: row.cell_id,
    revision: row.revision,
    clientId: row.client_id,
    conformanceFixtureRef: row.conformance_fixture_ref,
    liveTestDate: toIso(row.live_test_date),
    result: parseMcpConformanceResult(row.result),
    notes: row.notes,
  }));
}

/** A cell's usability verdict with its typed refusal reason. */
export interface CellUsability {
  readonly revision: string;
  readonly clientId: string;
  readonly usable: boolean;
  readonly reason: McpCompatibilityRefusalReason | null;
}

/**
 * Usability of one revision×client pair: a passing conformance RUN plus a
 * non-stale PASS cell. Missing either refuses.
 */
export function cellUsability(input: {
  readonly cell: McpCompatibilityCell | undefined;
  readonly passingRuns: readonly { readonly revision: string; readonly clientId: string }[];
  readonly revision: string;
  readonly clientId: string;
  readonly now: string;
  readonly maxAgeSeconds?: number;
}): CellUsability {
  const { cell, revision, clientId, now } = input;
  const hasRun = input.passingRuns.some(
    (run) => run.revision === revision && run.clientId === clientId,
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
  if (!hasRun) {
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
    input.maxAgeSeconds ?? MCP_LIVE_TEST_MAX_AGE_SECONDS,
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
  readonly usableRevisions: readonly string[];
  readonly cells: readonly CellUsability[];
  readonly transportOriginPolicyRef: string;
}

/**
 * Resolve the active compatibility matrix: the latest mutually tested stable
 * revision (never a draft), the per-cell usability verdicts, and the transport
 * origin-policy reference of the resolved revision.
 */
export async function resolveCompatibilityMatrix(
  engine: DatabaseEngine,
  input: { readonly now: string; readonly optInDraftRevision?: string },
): Promise<McpCompatibilityResolution> {
  const revisions = await mcpRevisions(engine);
  const clients = await mcpTargetClients(engine);
  const cells = await mcpCompatibilityCells(engine);
  const runs = await engine.query<RawRunRow>(
    `SELECT run_id, revision, client_id, fixture_ref, result, ran_at
       FROM prod.mcp_conformance_runs
      WHERE result = 'PASS'`,
  );
  const passingRuns = runs.rows.map((row) => ({ revision: row.revision, clientId: row.client_id }));
  const cellByPair = new Map<string, McpCompatibilityCell>(
    cells.map((cell) => [`${cell.revision}\u0000${cell.clientId}`, cell]),
  );

  const usabilityFor = (revision: string): readonly CellUsability[] =>
    clients.map((client) =>
      cellUsability({
        cell: cellByPair.get(`${revision}\u0000${client.clientId}`),
        passingRuns,
        revision,
        clientId: client.clientId,
        now: input.now,
      }),
    );

  const isMutuallyTested = (revision: string): boolean => {
    if (clients.length === 0) return false;
    return usabilityFor(revision).every((cell) => cell.usable);
  };

  const stable = revisions.filter(
    (revision) =>
      revision.channel === 'STABLE' &&
      revision.supersededBy === null &&
      isMutuallyTested(revision.revision),
  );
  const orderedStable = [...stable].sort((a, b) =>
    a.revision < b.revision ? 1 : a.revision > b.revision ? -1 : 0,
  );
  const latest = orderedStable[0];
  if (latest === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'no mutually tested stable MCP revision is usable; the server cannot default a revision (§69.7)',
      { reason: McpCompatibilityRefusalReason.NO_MUTUALLY_TESTED_STABLE_REVISION },
    );
  }

  let optInRevision: string | null = null;
  if (input.optInDraftRevision !== undefined) {
    const draft = revisions.find((revision) => revision.revision === input.optInDraftRevision);
    if (draft === undefined) {
      throw new ForesiftError(
        ErrorCode.PROD_MCP_REVISION_CHANNEL_UNKNOWN,
        `opted-in MCP revision ${input.optInDraftRevision} is not registered`,
        { reason: McpCompatibilityRefusalReason.REVISION_UNKNOWN },
      );
    }
    if (draft.channel !== 'DRAFT') {
      throw new ForesiftError(
        ErrorCode.PROD_MCP_DRAFT_DEFAULT,
        `revision ${input.optInDraftRevision} is not a draft/RC revision`,
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
    optInRevision = draft.revision;
  }

  const usableRevisions = orderedStable.map((revision) => revision.revision);
  const defaultRevision = latest.revision;
  const defaultRow = revisions.find((revision) => revision.revision === defaultRevision);
  return {
    defaultRevision,
    defaultChannel: defaultRow?.channel ?? 'STABLE',
    optInRevision,
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
  const resolution = await resolveCompatibilityMatrix(engine, { now: input.now });
  const optIn = input.optInRevisions ?? [];
  const allowedRevisions = [...new Set([...resolution.usableRevisions, ...optIn])];
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
      const baselineUsable = resolution.usableRevisions.includes(MCP_BASELINE_STABLE_REVISION);
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
