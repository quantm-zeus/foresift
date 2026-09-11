/** Network-denied, point-in-time, byte-deterministic frozen replay (FR-EVAL-002). */
import { ErrorCode, EvalError, ReplayKind } from '@foresift/domain';
import { canonicalJson, sha256Text } from '@foresift/persistence';

export interface EvaluationReplayManifest {
  readonly replayId: string;
  readonly replayKind: ReplayKind;
  readonly datasetVersion: string;
  readonly populationClaim: string;
  readonly observationCutoff: string;
  readonly holdoutSnapshot: string;
  readonly codeHash: string;
  readonly candidateUniverseHash: string;
  readonly createdAt: string;
  readonly networkAccess: false;
}

export interface ReplayInputRecord<T = unknown> {
  readonly stableId: string;
  readonly availableAt: string;
  readonly value: T;
}

export interface FrozenReplayArtifact<T = unknown> {
  readonly replayId: string;
  readonly artifactClass: ReplayKind;
  readonly manifestHash: string;
  readonly inputHash: string;
  readonly populationClaim: string;
  readonly records: readonly ReplayInputRecord<T>[];
  readonly bytes: string;
}

export function freezeReplayManifest(
  input: Omit<EvaluationReplayManifest, 'networkAccess'> & { readonly networkAccess?: boolean },
): EvaluationReplayManifest {
  if (input.networkAccess === true)
    throw new EvalError(
      'decision-quality replay network access is denied',
      { replayId: input.replayId },
      ErrorCode.EVAL_NETWORK_ACCESS_DENIED,
    );
  if (Date.parse(input.observationCutoff) > Date.parse(input.createdAt))
    throw new EvalError(
      'observation cutoff exceeds manifest freeze time',
      { replayId: input.replayId },
      ErrorCode.EVAL_UNIVERSE_MISMATCH,
    );
  return Object.freeze({ ...input, networkAccess: false });
}

/** Resolve only inputs whose proven availableAt is inside the frozen cutoff. */
export function runFrozenReplay<T>(input: {
  readonly manifest: EvaluationReplayManifest;
  readonly records: readonly ReplayInputRecord<T>[];
  readonly networkAccess?: boolean;
}): FrozenReplayArtifact<T> {
  if (input.networkAccess === true || input.manifest.networkAccess !== false)
    throw new EvalError(
      'frozen replay cannot access a network',
      { replayId: input.manifest.replayId },
      ErrorCode.EVAL_NETWORK_ACCESS_DENIED,
    );
  const cutoff = Date.parse(input.manifest.observationCutoff);
  if (!Number.isFinite(cutoff))
    throw new EvalError('invalid frozen observation cutoff', {}, ErrorCode.EVAL_UNIVERSE_MISMATCH);
  const records = input.records
    .filter((record) => {
      const available = Date.parse(record.availableAt);
      if (!Number.isFinite(available))
        throw new EvalError(
          'input availability is invalid',
          { stableId: record.stableId },
          ErrorCode.EVAL_UNIVERSE_MISMATCH,
        );
      return available <= cutoff;
    })
    .sort((left, right) => left.stableId.localeCompare(right.stableId));
  const manifestHash = sha256Text(canonicalJson(input.manifest));
  const inputHash = sha256Text(canonicalJson(records));
  const body = {
    replayId: input.manifest.replayId,
    artifactClass: input.manifest.replayKind,
    manifestHash,
    inputHash,
    populationClaim: input.manifest.populationClaim,
    records,
  };
  return Object.freeze({ ...body, records: Object.freeze(records), bytes: canonicalJson(body) });
}

export function replayRerunIsByteIdentical(
  left: FrozenReplayArtifact,
  right: FrozenReplayArtifact,
): boolean {
  return left.artifactClass === right.artifactClass && left.bytes === right.bytes;
}

/** Artifact classes are never blended into a single metric input. */
export function assertSingleReplayArtifactClass(
  artifacts: readonly FrozenReplayArtifact[],
): ReplayKind {
  const kinds = new Set(artifacts.map((artifact) => artifact.artifactClass));
  if (kinds.size !== 1)
    throw new EvalError(
      'replay artifact classes cannot be blended',
      {},
      ErrorCode.EVAL_UNIVERSE_MISMATCH,
    );
  const kind = artifacts[0]?.artifactClass;
  if (!kind)
    throw new EvalError(
      'at least one replay artifact is required',
      {},
      ErrorCode.EVAL_UNIVERSE_MISMATCH,
    );
  return kind;
}
