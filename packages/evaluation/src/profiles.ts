/** Immutable versioned outcome-profile registry (FR-EVAL-001). */
import { ErrorCode, EvalError } from '@foresift/domain';
import type { OutcomeProfile } from '@foresift/shared-schemas';
import { OutcomeProfileSchema } from '@foresift/shared-schemas';

export interface ProfileRequirements {
  readonly requiredStressScenarios: readonly string[];
  readonly resolutionFloor: Readonly<Record<string, unknown>>;
}

export interface RegisteredOutcomeProfile {
  readonly profile: OutcomeProfile;
  readonly requirements: ProfileRequirements;
}

export class OutcomeProfileRegistry {
  readonly #profiles = new Map<string, RegisteredOutcomeProfile>();

  register(profile: OutcomeProfile, requirements: ProfileRequirements): RegisteredOutcomeProfile {
    const parsed = OutcomeProfileSchema.parse(profile);
    if (
      requirements.requiredStressScenarios.length === 0 ||
      Object.keys(requirements.resolutionFloor).length === 0
    )
      throw new EvalError(
        'profile requires a stress matrix and resolution floor',
        { profileId: profile.profileId },
        ErrorCode.EVAL_POPULATION_CLAIM_UNSUPPORTED,
      );
    const key = this.key(parsed.profileId, parsed.version);
    const candidate = Object.freeze({
      profile: Object.freeze({ ...parsed }),
      requirements: Object.freeze({
        requiredStressScenarios: Object.freeze([...requirements.requiredStressScenarios]),
        resolutionFloor: Object.freeze({ ...requirements.resolutionFloor }),
      }),
    });
    const existing = this.#profiles.get(key);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(candidate))
        throw new EvalError(
          'outcome profile versions are immutable',
          { profileId: parsed.profileId, version: parsed.version },
          ErrorCode.EVAL_UNIVERSE_MISMATCH,
        );
      return existing;
    }
    this.#profiles.set(key, candidate);
    return candidate;
  }

  resolve(profileId: string, version: string): RegisteredOutcomeProfile {
    const profile = this.#profiles.get(this.key(profileId, version));
    if (!profile)
      throw new EvalError(
        'outcome profile version is not registered',
        { profileId, version },
        ErrorCode.EVAL_POPULATION_CLAIM_UNSUPPORTED,
      );
    return profile;
  }

  list(): readonly RegisteredOutcomeProfile[] {
    return [...this.#profiles.values()].sort((left, right) =>
      `${left.profile.profileId}:${left.profile.version}`.localeCompare(
        `${right.profile.profileId}:${right.profile.version}`,
      ),
    );
  }

  private key(profileId: string, version: string): string {
    return `${encodeURIComponent(profileId)}:${encodeURIComponent(version)}`;
  }
}
