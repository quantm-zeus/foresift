/** G1-owned objective/opportunity output language policy (FR-OBJ-010). */
import {
  ObjError,
  ObjErrorCode,
  ProhibitedClaimKind,
  UNCERTAINTY_DISCLOSURE_TEXT,
} from '@foresift/domain';

export const OBJECTIVE_UNCERTAINTY_DISCLOSURE = UNCERTAINTY_DISCLOSURE_TEXT;

export type ObjectiveOutputKind = 'OBJECTIVE_CLAIM' | 'OPPORTUNITY_OUTPUT';

export interface ObjectiveLanguageScreenInput {
  readonly text: string;
  readonly outputKind: ObjectiveOutputKind;
  readonly disclosure?: string | null;
}

export interface ObjectiveLanguageScreen {
  readonly accepted: boolean;
  readonly prohibitedClaimKinds: readonly ProhibitedClaimKind[];
  readonly disclosureAttached: boolean;
  readonly disclosure: string | null;
}

const CLAIM_PATTERNS: Readonly<Record<ProhibitedClaimKind, readonly RegExp[]>> = Object.freeze({
  [ProhibitedClaimKind.GUARANTEED_PROFIT]: [
    /\bguarantee(?:d|s)?[\s-]+(?:[0-9]+x?[\s-]+)?(?:profit|returns?|gains?)\b/iu,
    /\b(?:profit|returns?|gains?)[\s-]+(?:is|are)[\s-]+guaranteed\b/iu,
  ],
  [ProhibitedClaimKind.ASSURED_RETURN]: [
    /\bassured[\s-]+returns?\b/iu,
    /\breturns?[\s-]+(?:is|are)[\s-]+assured\b/iu,
  ],
  [ProhibitedClaimKind.RISK_FREE_PROFIT]: [
    /\brisk[\s-]*free(?:[\s-]+(?:profit|returns?|gains?|arbitrage))?\b/iu,
    /\b(?:profit|returns?|gains?)[\s-]+without[\s-]+risk\b/iu,
  ],
  [ProhibitedClaimKind.CERTAIN_GAIN]: [
    /\bcertain[\s-]+(?:gains?|returns?|profit)\b/iu,
    /\b(?:gains?|returns?|profit)[\s-]+(?:is|are)[\s-]+certain\b/iu,
    /\b(?:profit|return|gain|win[\s-]*rate)[\s-]+certainty\b/iu,
  ],
});

function disclosureMatches(value: string | null | undefined): boolean {
  return value?.includes(OBJECTIVE_UNCERTAINTY_DISCLOSURE) === true;
}

/** Deterministically classify all prohibited claim kinds present in text. */
export function detectProhibitedClaims(text: string): readonly ProhibitedClaimKind[] {
  const kinds = Object.entries(CLAIM_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(text)))
    .map(([kind]) => kind as ProhibitedClaimKind);
  return Object.freeze(kinds);
}

/**
 * Screen a G1-owned output. Opportunity outputs require the canonical
 * disclosure as a separate attachment; wording in the body is not a
 * substitute for that attachment.
 */
export function screenObjectiveLanguage(
  input: ObjectiveLanguageScreenInput,
): ObjectiveLanguageScreen {
  const prohibitedClaimKinds = detectProhibitedClaims(input.text);
  const disclosureAttached =
    input.outputKind !== 'OPPORTUNITY_OUTPUT' || disclosureMatches(input.disclosure);
  return Object.freeze({
    accepted: prohibitedClaimKinds.length === 0 && disclosureAttached,
    prohibitedClaimKinds,
    disclosureAttached,
    disclosure: input.disclosure ?? null,
  });
}

/** Refuse prohibited claims and opportunity outputs without disclosure. */
export function assertObjectiveLanguage(
  input: ObjectiveLanguageScreenInput,
): ObjectiveLanguageScreen {
  const screen = screenObjectiveLanguage(input);
  if (screen.prohibitedClaimKinds.length > 0) {
    throw new ObjError(
      ObjErrorCode.OBJ_GUARANTEED_LANGUAGE_REFUSED,
      'guaranteed-profit language is prohibited',
      { prohibitedClaimKinds: screen.prohibitedClaimKinds.join(',') },
    );
  }
  if (!screen.disclosureAttached) {
    throw new ObjError(
      ObjErrorCode.OBJ_UNCERTAINTY_DISCLOSURE_MISSING,
      'opportunity output uncertainty disclosure is missing',
      { outputKind: input.outputKind },
    );
  }
  return screen;
}

/** Attach the one canonical disclosure to an opportunity-output payload. */
export function attachUncertaintyDisclosure<T extends object>(
  output: T,
): T & { readonly disclosure: typeof OBJECTIVE_UNCERTAINTY_DISCLOSURE } {
  return Object.freeze({ ...output, disclosure: OBJECTIVE_UNCERTAINTY_DISCLOSURE });
}

export const screenProhibitedLanguage = screenObjectiveLanguage;
export const requirePermittedObjectiveLanguage = assertObjectiveLanguage;
