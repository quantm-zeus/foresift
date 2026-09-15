/**
 * Claims policy + public-output boundary (FR-SEC-010 claims-abuse surface,
 * FR-SEC-012 public distribution boundary; AC-276, AC-277).
 *
 * `evaluateClaims` screens marketing/UI/API/export text against the
 * prohibited claim classes: guaranteed profit, risk-free, universal
 * recall, uncalibrated probability, unsupported performance.
 *
 * `validatePublicOutput` is the distribution boundary: an output may only
 * ship when its envelope carries evidence, timestamps, execution
 * assumptions, limitations, AND a disclaimer — and after stripping
 * detector thresholds and sensitive entity details from the body.
 */
import {
  ClaimsPolicyResultSchema,
  PublicOutputEnvelopeSchema,
  PublicRedactionResultSchema,
  type ClaimsPolicyChannel,
  type ClaimsPolicyResult,
  type PublicRedactionResult,
} from '@foresift/shared-schemas';
import { ClaimsPolicyError } from './errors.ts';
import { appendSafe, numericJoin, numericSortStrings, parseDecision, snapshotCallerInput } from './shadow-safe.ts';

interface ClaimPattern {
  readonly claimClass:
    | 'GUARANTEED_PROFIT'
    | 'RISK_FREE'
    | 'UNIVERSAL_RECALL'
    | 'UNCALIBRATED_PROBABILITY'
    | 'UNSUPPORTED_PERFORMANCE';
  readonly regex: RegExp;
}

const CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    claimClass: 'GUARANTEED_PROFIT',
    regex:
      /\b(guaranteed?\s+(profits?|returns?|gains?|roi)|profits?\s+guaranteed|can'?t\s+lose)\b/i,
  },
  {
    claimClass: 'RISK_FREE',
    regex: /\brisk[- ]free|(no\s+risk\s+involved|zero\s+risk\s+strategy)\b/i,
  },
  {
    claimClass: 'UNIVERSAL_RECALL',
    regex:
      /\b(always\s+(detects?|finds?|catches?)|never\s+(misses?|fails)|100%\s+(recall|coverage))\b/i,
  },
  {
    claimClass: 'UNCALIBRATED_PROBABILITY',
    regex: /\b(\d{1,3}(\.\d+)?\s?%\s+(accurate|chance|probability|win\s+rate))\b/i,
  },
  {
    claimClass: 'UNSUPPORTED_PERFORMANCE',
    regex:
      /\b(outperforms?\s+(all|everyone|the\s+market)|best\s+performing\s+bot|#1\s+trading\s+tool)\b/i,
  },
];

/** Screen text for a channel; COMPLIANT or REFUSED with all matched classes. */
export function evaluateClaims(text: string, channel: ClaimsPolicyChannel): ClaimsPolicyResult {
  const classes = new Set<ClaimPattern['claimClass']>();
  for (let index = 0; index < CLAIM_PATTERNS.length; index += 1) {
    const pattern = CLAIM_PATTERNS[index] as ClaimPattern;
    if (pattern.regex.test(text)) {
      classes.add(pattern.claimClass);
    }
  }
  if (classes.size === 0) {
    return parseDecision(ClaimsPolicyResultSchema, { verdict: 'COMPLIANT', channel });
  }
  const classList: Array<ClaimPattern['claimClass']> = [];
  // Numeric collection, not `[...classes]`: array spread reads the shadowable
  // `Array.prototype[Symbol.iterator]` (audit R13).
  classes.forEach((entry) => {
    appendSafe(classList, entry);
  });
  return parseDecision(ClaimsPolicyResultSchema, {
    verdict: 'REFUSED',
    channel,
    claimClasses: numericSortStrings(classList),
  });
}

export function assertClaimsCompliant(text: string, channel: ClaimsPolicyChannel): void {
  const result = evaluateClaims(text, channel);
  if (result.verdict === 'REFUSED') {
    throw new ClaimsPolicyError(`prohibited claims in ${channel} text`, {
      classes: numericJoin(result.claimClasses),
    });
  }
}

// --- Public-output envelope + redaction -----------------------------------------

export interface PublicOutputCandidate {
  /** Body proposed for publication. */
  readonly body: string;
  readonly evidenceRefs: readonly string[];
  readonly timestamps: readonly string[];
  readonly executionAssumptions: readonly string[];
  readonly limitations: readonly string[];
  readonly disclaimer: string;
  /**
   * Sensitive entity values (addresses, handles, emails…) that must not
   * appear verbatim in public bodies; occurrences are redacted.
   */
  readonly sensitiveEntityValues?: readonly string[] | undefined;
}

const DETECTOR_THRESHOLD_PATTERN =
  /(detector[_ -]?(threshold|score)[^\n]{0,40}\d(\.\d+)?|threshold[:=]\s*0\.\d+)/gi;

/**
 * Validate the full boundary: schema-complete envelope, claims-clean body,
 * thresholds stripped, sensitive entities redacted. Returns the
 * schema-typed redaction result; on success `redactedBody` carries what may
 * actually be published (exposed as a non-schema extra by this module).
 */
export function validatePublicOutput(rawCandidate: PublicOutputCandidate): {
  redaction: PublicRedactionResult;
  redactedBody: string;
} {
  // Single-read binding (V7 accessor class): the envelope check, the body
  // redaction and the success body must all see the SAME candidate values.
  const candidate = snapshotCallerInput(rawCandidate);
  // 1. Envelope completeness — every §35.12 duty present and parseable.
  try {
    PublicOutputEnvelopeSchema.parse({
      evidenceRefs: candidate.evidenceRefs,
      timestamps: candidate.timestamps,
      executionAssumptions: candidate.executionAssumptions,
      limitations: candidate.limitations,
      disclaimer: candidate.disclaimer,
    });
  } catch {
    return {
      redaction: parseDecision(PublicRedactionResultSchema, {
        verdict: 'REFUSED',
        reason: 'REQUIRED_FIELD_MISSING',
        detail: 'public-output envelope missing required duties',
      }),
      redactedBody: '',
    };
  }

  let redactionsApplied = 0;
  let body = candidate.body;

  // 2. Strip detector thresholds — internal tuning never ships publicly.
  //    EVERY match must be replaced: stopping after the first leaks the
  //    remaining occurrences, and partial success reads as success downstream
  //    (FR-SEC-012 / AC-277).
  const thresholdMatches = body.match(DETECTOR_THRESHOLD_PATTERN) ?? [];
  for (let index = 0; index < thresholdMatches.length; index += 1) {
    const match = thresholdMatches[index] as string;
    const occurrences = body.split(match).length - 1;
    if (occurrences === 0) continue; // already swallowed by an earlier (greedy) span
    // numericJoin, never `Array.prototype.join` (audit R13): a shadowed `join`
    // could truncate or fabricate the redacted body while reporting success.
    body = numericJoin(body.split(match), '[REDACTED_THRESHOLD]');
    redactionsApplied += occurrences;
  }

  // 3. Redact sensitive entity details.
  const sensitiveEntityValues = candidate.sensitiveEntityValues ?? [];
  for (let index = 0; index < sensitiveEntityValues.length; index += 1) {
    const value = sensitiveEntityValues[index] as string;
    if (value !== '' && body.includes(value)) {
      body = numericJoin(body.split(value), '[REDACTED_ENTITY]');
      redactionsApplied += 1;
    }
  }

  // 4. The published body itself must be claims-clean.
  const claims = evaluateClaims(body, 'API');
  if (claims.verdict === 'REFUSED') {
    return {
      redaction: parseDecision(PublicRedactionResultSchema, {
        verdict: 'REFUSED',
        reason: 'SENSITIVE_DETAIL_PRESENT',
        detail: `prohibited claims present: ${numericJoin(claims.claimClasses)}`,
      }),
      redactedBody: '',
    };
  }

  return {
    redaction: parseDecision(PublicRedactionResultSchema, {
      verdict: 'COMPLIANT',
      redactionsApplied,
    }),
    redactedBody: body,
  };
}
