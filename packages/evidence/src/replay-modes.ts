/**
 * Explicit replay-mode resolution (FR-DATA-008/010/015).
 *
 * Every result is a discriminated, labeled shape. There is deliberately no
 * default mode, no default decision time, and no current-view callback:
 * realizable replay therefore fails closed instead of reaching hidden current
 * data when its historical boundary is absent.
 */
import { utcTimestamp, visibleAt, type UtcTimestamp } from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { resolveEvidenceAt, type ReplayResolution } from './replay.ts';

export const ReplayMode = {
  REALIZABLE: 'REALIZABLE',
  ORACLE: 'ORACLE',
  HINDSIGHT: 'HINDSIGHT',
  CROSS_FITTED_RESEARCH: 'CROSS_FITTED_RESEARCH',
} as const;
export type ReplayMode = (typeof ReplayMode)[keyof typeof ReplayMode];

export const REPLAY_MODE_LABELS = {
  REALIZABLE: 'realizable replay',
  ORACLE: 'oracle replay',
  HINDSIGHT: 'hindsight replay',
  CROSS_FITTED_RESEARCH: 'cross-fitted research replay',
} as const satisfies Record<ReplayMode, string>;

/** A replayable evidence item with its ACTUAL system availability. */
export interface ReplayModeEntry<T = unknown> {
  readonly entryId: string;
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly retrospectiveOnly: boolean;
  readonly researchFold?: string;
  readonly value: T;
}

interface ReplayResultBase<T, M extends ReplayMode> {
  readonly mode: M;
  readonly modeLabel: (typeof REPLAY_MODE_LABELS)[M];
  readonly decisionAt: UtcTimestamp;
  readonly entries: readonly ReplayModeEntry<T>[];
  readonly excludedEntryIds: readonly string[];
}

export interface RealizableReplayResult<T>
  extends ReplayResultBase<T, typeof ReplayMode.REALIZABLE> {
  readonly retrospectiveDiagnostic: false;
  readonly permitsFutureAvailability: false;
}

export interface OracleReplayResult<T>
  extends ReplayResultBase<T, typeof ReplayMode.ORACLE> {
  readonly retrospectiveDiagnostic: true;
  readonly permitsFutureAvailability: true;
}

export interface HindsightReplayResult<T>
  extends ReplayResultBase<T, typeof ReplayMode.HINDSIGHT> {
  readonly retrospectiveDiagnostic: true;
  readonly permitsFutureAvailability: true;
  readonly evaluationAt: UtcTimestamp;
}

export interface CrossFittedResearchReplayResult<T>
  extends ReplayResultBase<T, typeof ReplayMode.CROSS_FITTED_RESEARCH> {
  readonly retrospectiveDiagnostic: true;
  readonly permitsFutureAvailability: true;
  readonly targetFold: string;
}

export type ReplayModeResult<T> =
  | RealizableReplayResult<T>
  | OracleReplayResult<T>
  | HindsightReplayResult<T>
  | CrossFittedResearchReplayResult<T>;

export type ReplayModeRequest =
  | { readonly mode: 'REALIZABLE'; readonly decisionAt: UtcTimestamp }
  | { readonly mode: 'ORACLE'; readonly decisionAt: UtcTimestamp }
  | {
      readonly mode: 'HINDSIGHT';
      readonly decisionAt: UtcTimestamp;
      readonly evaluationAt: UtcTimestamp;
    }
  | {
      readonly mode: 'CROSS_FITTED_RESEARCH';
      readonly decisionAt: UtcTimestamp;
      readonly targetFold: string;
    };

function stableEntries<T>(entries: readonly ReplayModeEntry<T>[]): ReplayModeEntry<T>[] {
  return [...entries].sort((a, b) =>
    a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0,
  );
}

function partition<T>(
  entries: readonly ReplayModeEntry<T>[],
  include: (entry: ReplayModeEntry<T>) => boolean,
): { included: ReplayModeEntry<T>[]; excluded: string[] } {
  const included: ReplayModeEntry<T>[] = [];
  const excluded: string[] = [];
  for (const entry of stableEntries(entries)) {
    // Parse both timestamps at the boundary. Invalid evidence fails the whole
    // replay; it is never quietly omitted as though it had not existed.
    utcTimestamp(String(entry.eventAt));
    utcTimestamp(String(entry.availableAt));
    if (include(entry)) included.push(entry);
    else excluded.push(entry.entryId);
  }
  return { included, excluded };
}

/** Pure resolver used by simulations and FR-DATA-008 labeling vectors. */
export function resolveReplayMode<T>(
  entries: readonly ReplayModeEntry<T>[],
  request: ReplayModeRequest,
): ReplayModeResult<T> {
  const decisionAt = utcTimestamp(String(request.decisionAt));
  switch (request.mode) {
    case ReplayMode.REALIZABLE: {
      const selected = partition(entries, (entry) => visibleAt(entry, decisionAt));
      return {
        mode: ReplayMode.REALIZABLE,
        modeLabel: REPLAY_MODE_LABELS.REALIZABLE,
        decisionAt,
        entries: selected.included,
        excludedEntryIds: selected.excluded,
        retrospectiveDiagnostic: false,
        permitsFutureAvailability: false,
      };
    }
    case ReplayMode.ORACLE: {
      const selected = partition(entries, () => true);
      return {
        mode: ReplayMode.ORACLE,
        modeLabel: REPLAY_MODE_LABELS.ORACLE,
        decisionAt,
        entries: selected.included,
        excludedEntryIds: selected.excluded,
        retrospectiveDiagnostic: true,
        permitsFutureAvailability: true,
      };
    }
    case ReplayMode.HINDSIGHT: {
      const evaluationAt = utcTimestamp(String(request.evaluationAt));
      if (Date.parse(evaluationAt) < Date.parse(decisionAt)) {
        throw new RangeError('hindsight evaluationAt cannot precede decisionAt');
      }
      const selected = partition(entries, (entry) => visibleAt(entry, evaluationAt));
      return {
        mode: ReplayMode.HINDSIGHT,
        modeLabel: REPLAY_MODE_LABELS.HINDSIGHT,
        decisionAt,
        evaluationAt,
        entries: selected.included,
        excludedEntryIds: selected.excluded,
        retrospectiveDiagnostic: true,
        permitsFutureAvailability: true,
      };
    }
    case ReplayMode.CROSS_FITTED_RESEARCH: {
      if (request.targetFold.length === 0) throw new RangeError('targetFold must be non-empty');
      // Unassigned evidence is excluded: cross-fitting must be demonstrated,
      // not inferred. Target-fold evidence can never train its own evaluation.
      const selected = partition(
        entries,
        (entry) => entry.researchFold !== undefined && entry.researchFold !== request.targetFold,
      );
      return {
        mode: ReplayMode.CROSS_FITTED_RESEARCH,
        modeLabel: REPLAY_MODE_LABELS.CROSS_FITTED_RESEARCH,
        decisionAt,
        targetFold: request.targetFold,
        entries: selected.included,
        excludedEntryIds: selected.excluded,
        retrospectiveDiagnostic: true,
        permitsFutureAvailability: true,
      };
    }
  }
}

/**
 * Evidence-substrate adapter for the only decision-realizable mode. It accepts
 * an explicit historical instant and delegates to the frozen resolver; there
 * is no code path capable of querying a current view.
 */
export async function resolveRealizableEvidenceReplay(
  engine: DatabaseEngine,
  input: { readonly decisionAt: UtcTimestamp },
): Promise<{
  readonly mode: 'REALIZABLE';
  readonly modeLabel: 'realizable replay';
  readonly retrospectiveDiagnostic: false;
  readonly permitsFutureAvailability: false;
  readonly evidence: ReplayResolution;
}> {
  const decisionAt = utcTimestamp(String(input.decisionAt));
  const evidence = await resolveEvidenceAt(engine, { resolvedAt: decisionAt });
  return {
    mode: ReplayMode.REALIZABLE,
    modeLabel: REPLAY_MODE_LABELS.REALIZABLE,
    retrospectiveDiagnostic: false,
    permitsFutureAvailability: false,
    evidence,
  };
}

/** Alias matching callers that describe a collection rather than a mode. */
export const resolveReplayEntries = resolveReplayMode;

