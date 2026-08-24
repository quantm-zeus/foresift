/**
 * Double-submit CSRF validation with origin binding (FR-SEC-001, §35.1;
 * AC-274 dimension `CSRF_INVALID`).
 *
 * A state-changing request is accepted only when:
 *   1. a non-trivial token is present in BOTH the header (submitted) and the
 *      session cookie (stored) — the double-submit pattern;
 *   2. the two match under a constant-time comparison (never early-exit on
 *      the first differing byte);
 *   3. the token's bound origin equals the request's Origin exactly — the
 *      token is not portable across origins.
 */
import { timingSafeEqual } from 'node:crypto';
import { createHash } from 'node:crypto';

/** Minimum token length; shorter strings carry no forgery resistance. */
export const MIN_CSRF_TOKEN_LENGTH = 32;

export interface CsrfEvaluationInput {
  /** Token as submitted by the client (typically an HTTP header). */
  readonly submittedToken?: string | undefined;
  /** Token held server-side in the session (typically the cookie value). */
  readonly sessionToken?: string | undefined;
  /** Origin the token was issued for. */
  readonly tokenBoundOrigin?: string | undefined;
  /** Origin the request actually arrived from (Origin/Referer-derived). */
  readonly requestOrigin?: string | undefined;
}

export type CsrfVerdict =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'MISSING' | 'MISMATCH' | 'ORIGIN_BOUNDARY' };

/** Constant-time string equality via digest indirection (equal work always). */
function constantTimeEquals(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export function evaluateCsrf(input: CsrfEvaluationInput): CsrfVerdict {
  const { submittedToken, sessionToken, tokenBoundOrigin, requestOrigin } = input;
  if (
    submittedToken === undefined ||
    sessionToken === undefined ||
    submittedToken.length < MIN_CSRF_TOKEN_LENGTH ||
    sessionToken.length < MIN_CSRF_TOKEN_LENGTH
  ) {
    return { valid: false, reason: 'MISSING' };
  }
  if (!constantTimeEquals(submittedToken, sessionToken)) {
    return { valid: false, reason: 'MISMATCH' };
  }
  if (tokenBoundOrigin === undefined || requestOrigin === undefined) {
    return { valid: false, reason: 'ORIGIN_BOUNDARY' };
  }
  // Exact string equality: no normalization, no suffix/scheme leniency.
  if (tokenBoundOrigin !== requestOrigin) {
    return { valid: false, reason: 'ORIGIN_BOUNDARY' };
  }
  return { valid: true };
}
