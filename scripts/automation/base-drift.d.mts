export const BASE_DRIFT_REASON: string;

export interface AdmissionVerdict {
  ok: boolean;
  reason?: string;
  detail?: string;
}

/** Pure V3-D §11 landing-admission verdict over caller-gathered git facts. */
export declare function landingAdmission(facts: {
  currentMainResolved: boolean;
  branchContainsCurrentMain: boolean;
}): { ok: true } | { ok: false; reason: string; detail: string };

/** Ancestor test via the injected runner; null = unverifiable (fail closed). */
export declare function isAncestorSha(
  runGit: (...args: string[]) => unknown,
  ancestorSha: string,
  descendantSha: string,
): boolean | null;
