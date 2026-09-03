import { compareTimestamps, utcTimestamp } from './timestamps.ts';

export const ReplayMode = {
  REALIZABLE_REPLAY: 'REALIZABLE_REPLAY',
  ORACLE: 'ORACLE',
  HINDSIGHT: 'HINDSIGHT',
  COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH: 'COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH',
} as const;

export type ReplayMode = (typeof ReplayMode)[keyof typeof ReplayMode];

export const ALL_REPLAY_MODES: readonly ReplayMode[] = Object.values(ReplayMode);

/** Resolve an externally supplied replay mode without silently choosing a default. */
export function replayMode(value: string): ReplayMode {
  if (!(ALL_REPLAY_MODES as readonly string[]).includes(value)) {
    throw new RangeError(`unknown replay mode: ${JSON.stringify(value)}`);
  }
  return value as ReplayMode;
}

export const parseReplayMode = replayMode;

export const ReplayDiagnosticLabel = {
  REALIZABLE: 'REALIZABLE',
  ORACLE_RETROSPECTIVE_DIAGNOSTIC: 'ORACLE_RETROSPECTIVE_DIAGNOSTIC',
  HINDSIGHT_RETROSPECTIVE_DIAGNOSTIC: 'HINDSIGHT_RETROSPECTIVE_DIAGNOSTIC',
  COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH:
    'COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH',
} as const;

export type ReplayDiagnosticLabel =
  (typeof ReplayDiagnosticLabel)[keyof typeof ReplayDiagnosticLabel];

/** Explicit result labeling prevents a retrospective view masquerading as realizable replay. */
export function replayDiagnosticLabel(mode: ReplayMode): ReplayDiagnosticLabel {
  switch (replayMode(mode)) {
    case ReplayMode.REALIZABLE_REPLAY:
      return ReplayDiagnosticLabel.REALIZABLE;
    case ReplayMode.ORACLE:
      return ReplayDiagnosticLabel.ORACLE_RETROSPECTIVE_DIAGNOSTIC;
    case ReplayMode.HINDSIGHT:
      return ReplayDiagnosticLabel.HINDSIGHT_RETROSPECTIVE_DIAGNOSTIC;
    case ReplayMode.COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH:
      return ReplayDiagnosticLabel.COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH;
  }
}

export interface ReplayModeDiagnostics {
  readonly mode: ReplayMode;
  readonly label: ReplayDiagnosticLabel;
  readonly retrospective: boolean;
}

export function replayModeDiagnostics(mode: ReplayMode): ReplayModeDiagnostics {
  const parsed = replayMode(mode);
  return {
    mode: parsed,
    label: replayDiagnosticLabel(parsed),
    retrospective: parsed !== ReplayMode.REALIZABLE_REPLAY,
  };
}

export function isRetrospectiveDataAllowed(mode: ReplayMode): boolean {
  return replayModeDiagnostics(mode).retrospective;
}

export interface ReplayBoundaryObservation {
  readonly availableAt: string;
  readonly retrievedAsBackfill?: boolean;
  readonly retrospectiveOnly?: boolean;
  readonly qualityCodes?: readonly string[];
}

/**
 * Realizable replay cannot expose an observation learned only after the replay
 * boundary. Explicit research modes retain it under their mode label.
 */
export function shouldExcludeObservationAtBoundary(input: {
  readonly observation: ReplayBoundaryObservation;
  readonly boundaryTime: string;
  readonly mode: ReplayMode;
}): boolean {
  if (isRetrospectiveDataAllowed(input.mode)) return false;

  const retrospective =
    input.observation.retrievedAsBackfill === true ||
    input.observation.retrospectiveOnly === true ||
    input.observation.qualityCodes?.includes('RETROSPECTIVE_ONLY') === true;
  if (!retrospective) return false;

  const availableAt = utcTimestamp(input.observation.availableAt);
  const boundary = utcTimestamp(input.boundaryTime);
  return compareTimestamps(availableAt, boundary) > 0;
}
