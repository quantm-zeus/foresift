/**
 * Canned provider payload corpus (T801; FR-CORE-003/FR-CORE-006): inert,
 * deterministic collector responses covering the valid / malformed /
 * truncated / slow / oversized spectrum the stage-15..17 validators and AC
 * suites consume. No credentials, no real endpoints — hosts are RFC 2606
 * reserved names and every timestamp is fixed.
 *
 * Each case names the stage expected to refuse it, so suites assert BOTH the
 * refusal site AND the machine reason.
 */
import { rawPayload, type RawObservationShape } from './composition-harness.ts';

export interface PayloadCase {
  readonly name: string;
  readonly description: string;
  readonly contentType: string;
  readonly bodyText: string;
  /** Delay the serving adapter injects before responding (ms; 0 = immediate). */
  readonly delayMs: number;
  /** The §16.2 stage expected to accept (SUCCESS) or refuse this payload. */
  readonly expectedStage:
    | 'SUCCESS'
    | 'RAW_VALIDATE'
    | 'NORMALIZE'
    | 'SEMANTIC_INVARIANTS';
  /** Machine-reason prefix expected when expectedStage refuses. */
  readonly expectedReasonPrefix?: string;
}

const T_MINUS_120 = '2026-08-01T23:58:00Z';
const T_MINUS_60 = '2026-07-31T23:59:00Z';
const T_ZERO = '2026-08-01T00:00:00Z';

const goodObservation: RawObservationShape = {
  identity: 'solana:mint-fixture',
  observedAt: T_MINUS_60,
  availableAt: T_MINUS_60,
  fetchedAt: T_MINUS_120,
  fields: { risk_score: 0.2, flags: [] },
  qualityCodes: ['OK'],
};

/** Valid: single well-formed observation inside every invariant window. */
export const VALID_PAYLOAD: PayloadCase = {
  name: 'valid-single-observation',
  description: 'well-formed payload satisfying all stage-17 invariants',
  contentType: 'application/json',
  bodyText: JSON.stringify(rawPayload([goodObservation])),
  delayMs: 0,
  expectedStage: 'SUCCESS',
};

/** Malformed shape: observations missing entirely. */
export const NO_OBSERVATIONS_PAYLOAD: PayloadCase = {
  name: 'no-observations-array',
  description: 'payload without an observations array — normalization refuses',
  contentType: 'application/json',
  bodyText: JSON.stringify({ result: 'ok' }),
  delayMs: 0,
  expectedStage: 'NORMALIZE',
  expectedReasonPrefix: 'no observations array',
};

/** Malformed shape: observation without its event timestamp. */
export const MISSING_TIMESTAMP_PAYLOAD: PayloadCase = {
  name: 'missing-observed-at',
  description: 'observation lacks observedAt — normalization refuses (event-time required)',
  contentType: 'application/json',
  bodyText: JSON.stringify(
    rawPayload([
      {
        identity: 'solana:mint-fixture',
        availableAt: T_MINUS_60,
        fetchedAt: T_MINUS_120,
        fields: { risk_score: 0.2 },
        qualityCodes: ['OK'],
      },
    ]),
  ),
  delayMs: 0,
  expectedStage: 'NORMALIZE',
  expectedReasonPrefix: 'normalization requires',
};

/** Malformed code: quality code with illegal characters. */
export const BAD_QUALITY_CODE_PAYLOAD: PayloadCase = {
  name: 'bad-quality-code',
  description: 'quality code contains whitespace/illegal delimiters',
  contentType: 'application/json',
  bodyText: JSON.stringify(
    rawPayload([{ ...goodObservation, qualityCodes: ['has space!'] }]),
  ),
  delayMs: 0,
  expectedStage: 'NORMALIZE',
};

/** Time-travel: observedAt after availableAt breaks event-time ordering. */
export const TIME_TRAVEL_PAYLOAD: PayloadCase = {
  name: 'time-travel-observation',
  description: 'observedAt exceeds availableAt — semantic invariant refuses',
  contentType: 'application/json',
  bodyText: JSON.stringify(
    rawPayload([
      { ...goodObservation, observedAt: T_ZERO, availableAt: T_MINUS_60 },
    ]),
  ),
  delayMs: 0,
  expectedStage: 'SEMANTIC_INVARIANTS',
  expectedReasonPrefix: 'observedAt exceeds availableAt',
};

/** Truncated JSON body. */
export const TRUNCATED_PAYLOAD: PayloadCase = {
  name: 'truncated-json',
  description: 'body cut mid-structure — stage 15 refuses non-JSON',
  contentType: 'application/json',
  bodyText: '{"observations":[{"identity":"solana:mint-fixt',
  delayMs: 0,
  expectedStage: 'RAW_VALIDATE',
  expectedReasonPrefix: 'PAYLOAD_NOT_JSON',
};

/** Wrong content type: HTML error page behind a 200. */
export const HTML_PAYLOAD: PayloadCase = {
  name: 'html-error-page',
  description: 'collector returned text/html — content-type gate refuses',
  contentType: 'text/html',
  bodyText: '<html><body>gateway timeout</body></html>',
  delayMs: 0,
  expectedStage: 'RAW_VALIDATE',
  expectedReasonPrefix: 'CONTENT_TYPE_REFUSED',
};

/** Oversized body: exceeds any small byte limit the route declares. */
export const OVERSIZED_BODY_TEXT =
  '{"observations":[' +
  Array.from({ length: 4096 }, () => '"padpadpadpadpadpadpadpad"').join(',') +
  ']}';

export const OVERSIZED_PAYLOAD: PayloadCase = {
  name: 'oversized-body',
  description: 'body exceeds route byteLimit — byte-limit gate refuses',
  contentType: 'application/json',
  bodyText: OVERSIZED_BODY_TEXT,
  delayMs: 0,
  expectedStage: 'RAW_VALIDATE',
  expectedReasonPrefix: 'BYTE_LIMIT_EXCEEDED',
};

/** Slow: structurally valid but delayed past a tight dispatch deadline. */
export const SLOW_PAYLOAD: PayloadCase = {
  name: 'slow-provider',
  description: 'valid payload delivered after the deadline — deadline race refuses',
  contentType: 'application/json',
  bodyText: JSON.stringify(rawPayload([goodObservation])),
  delayMs: 500,
  expectedStage: 'RAW_VALIDATE',
};

/** THE corpus, named for suite iteration. */
export const PAYLOAD_CORPUS: readonly PayloadCase[] = [
  VALID_PAYLOAD,
  NO_OBSERVATIONS_PAYLOAD,
  MISSING_TIMESTAMP_PAYLOAD,
  BAD_QUALITY_CODE_PAYLOAD,
  TIME_TRAVEL_PAYLOAD,
  TRUNCATED_PAYLOAD,
  HTML_PAYLOAD,
  OVERSIZED_PAYLOAD,
  SLOW_PAYLOAD,
];
