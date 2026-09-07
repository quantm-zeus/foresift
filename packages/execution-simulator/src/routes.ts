/**
 * FR-EXEC-022 point-in-time route selection (AC-234).
 *
 * Retrospective route selection is refused: a route or pool that did not
 * exist at T_user_action cannot be selected for a historical simulation,
 * and a migration edge is routable only if its transition was known and
 * completed at the action slot. Selection is deterministic — eligible
 * candidates are ordered by (createdSlot, routeId) and the first eligible
 * route wins; ties are impossible because route ids are unique.
 *
 * Traces: FR-EXEC-022, AC-234.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';

/** A candidate route known to the simulator. */
export interface RouteCandidate {
  readonly routeId: string;
  /** Slot at which this route/pool was created (or first became known). */
  readonly createdSlot: number;
  /** The route's declared legs (non-empty). */
  readonly legs: readonly {
    readonly poolId: string;
    readonly poolCreatedSlot: number;
  }[];
  /** Migration edges this route can follow, with completion slots. */
  readonly migrationEdges?: readonly {
    readonly edgeId: string;
    readonly fromProgramVersion: string;
    readonly toProgramVersion: string;
    /** Slot at which the migration completed (from observation, not forecast). */
    readonly migrationCompletedSlot: number;
  }[];
}

export interface RouteSelectionInput {
  /** T_user_action slot: nothing created later may be selected. */
  readonly actionSlot: number;
  /** All candidate routes considered (any order). */
  readonly candidates: readonly RouteCandidate[];
  /**
   * When set, the route must support a migration transition to this program
   * version, and the edge must have completed at or before the action slot.
   */
  readonly requireMigrationToVersion?: string;
}

export interface RouteSelectionResult {
  /** The selected route id, or null when no eligible candidate exists. */
  readonly routeId: string | null;
  /** Every candidate refused, with the machine-readable reason. */
  readonly refusals: {
    readonly routeId: string;
    readonly reason:
      | 'POOL_CREATED_AFTER_ACTION_TIME'
      | 'ROUTE_CREATED_AFTER_ACTION_TIME'
      | 'MIGRATION_NOT_COMPLETED_AT_ACTION_SLOT'
      | 'EMPTY_ROUTE';
  }[];
  /** Deterministic ordering key the selection used. */
  readonly eligibleOrder: readonly string[];
}

function requireInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ROUTE_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

/**
 * Select the route eligible at T_user_action. Fail-closed: a route whose
 * pool or route creation postdates the action slot is refused
 * retrospectively; migration edges must have completed at or before the
 * action slot to be routable.
 */
export function selectRouteAtActionTime(input: RouteSelectionInput): RouteSelectionResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  const actionSlot = requireInteger(input.actionSlot, 'actionSlot');
  if (!Array.isArray(input.candidates)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ROUTE_CANDIDATES_INVALID',
    });
  }

  const refusals: RouteSelectionResult['refusals'] = [];
  const eligible: { routeId: string; createdSlot: number }[] = [];

  for (const candidate of input.candidates) {
    if (candidate === null || typeof candidate !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ROUTE_CANDIDATE_INVALID',
      });
    }
    if (typeof candidate.routeId !== 'string' || candidate.routeId.length === 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ROUTE_FIELD_INVALID',
        field: 'routeId',
      });
    }
    requireInteger(candidate.createdSlot, 'createdSlot');
    if (!Array.isArray(candidate.legs) || candidate.legs.length === 0) {
      refusals.push({ routeId: candidate.routeId, reason: 'EMPTY_ROUTE' });
      continue;
    }
    // AC-234: any pool leg created after the action slot makes the route
    // retrospective — refused, never silently selected.
    const poolAfterAction = candidate.legs.some(
      (leg: { poolCreatedSlot: number }) => leg.poolCreatedSlot > actionSlot,
    );
    if (poolAfterAction) {
      refusals.push({ routeId: candidate.routeId, reason: 'POOL_CREATED_AFTER_ACTION_TIME' });
      continue;
    }
    if (candidate.createdSlot > actionSlot) {
      refusals.push({ routeId: candidate.routeId, reason: 'ROUTE_CREATED_AFTER_ACTION_TIME' });
      continue;
    }
    if (input.requireMigrationToVersion !== undefined) {
      const edges = candidate.migrationEdges ?? [];
      const edge = edges.find(
        (e: { toProgramVersion: string }) => e.toProgramVersion === input.requireMigrationToVersion,
      );
      if (edge === undefined || edge.migrationCompletedSlot > actionSlot) {
        refusals.push({
          routeId: candidate.routeId,
          reason: 'MIGRATION_NOT_COMPLETED_AT_ACTION_SLOT',
        });
        continue;
      }
    }
    eligible.push({ routeId: candidate.routeId, createdSlot: candidate.createdSlot });
  }

  // Deterministic selection: lowest creation slot first, then route id.
  const ordered = [...eligible].sort((a, b) =>
    a.createdSlot !== b.createdSlot
      ? a.createdSlot - b.createdSlot
      : a.routeId < b.routeId
        ? -1
        : 1,
  );

  return {
    routeId: ordered.length > 0 ? (ordered[0]?.routeId ?? null) : null,
    refusals,
    eligibleOrder: ordered.map((e) => e.routeId),
  };
}
