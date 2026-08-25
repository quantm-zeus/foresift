/**
 * §16 Shared Tool Core domain-vocabulary units (FR-CORE-001…008).
 * Table-driven: every vocabulary resolves its full legal set, refuses
 * unknown strings with typed codes, and the reservation transition matrix
 * matches the PRD lifecycle exactly — including idempotent retry replays.
 */
import { describe, expect, it } from 'vitest';
import {
  ActionClass,
  ADMISSIBLE_ACTION_CLASSES,
  ALL_ACTION_CLASSES,
  ALL_BACKPRESSURE_ACTIONS,
  ALL_CACHE_OUTCOMES,
  ALL_FRESHNESS_FIELD_FAMILIES,
  ALL_HOLDER_MODES,
  ALL_PIPELINE_STAGES,
  ALL_QUOTA_MODELS,
  ALL_RESERVATION_STATES,
  ALL_TOOL_PROFILE_IDS,
  ALL_WORKLOAD_CLASSES,
  DEFAULT_FRESHNESS_POLICY_TABLE,
  FreshnessFieldFamily,
  PIPELINE_STAGE_ORDER,
  PipelineStage,
  StaleAdmissionScope,
  actionClass,
  backpressureAction,
  cacheOutcome,
  freshnessFieldFamily,
  holderMode,
  isAdmissibleActionClass,
  isLegalReservationTransition,
  isProhibitedFinancialActionClass,
  pipelineStage,
  quotaModel,
  reservationState,
  toolProfileId,
  workloadClass,
} from '../src/tool.ts';
import { ForesiftError } from '../src/errors.ts';

/** [value, resolver, expected] rows for the fail-closed resolution matrix. */
const VOCABULARIES = [
  { name: 'actionClass', resolve: actionClass, all: ALL_ACTION_CLASSES },
  { name: 'workloadClass', resolve: workloadClass, all: ALL_WORKLOAD_CLASSES },
  { name: 'cacheOutcome', resolve: cacheOutcome, all: ALL_CACHE_OUTCOMES },
  { name: 'quotaModel', resolve: quotaModel, all: ALL_QUOTA_MODELS },
  {
    name: 'reservationState',
    resolve: reservationState,
    all: ALL_RESERVATION_STATES,
  },
  {
    name: 'backpressureAction',
    resolve: backpressureAction,
    all: ALL_BACKPRESSURE_ACTIONS,
  },
  { name: 'holderMode', resolve: holderMode, all: ALL_HOLDER_MODES },
  { name: 'toolProfileId', resolve: toolProfileId, all: ALL_TOOL_PROFILE_IDS },
  {
    name: 'freshnessFieldFamily',
    resolve: freshnessFieldFamily,
    all: ALL_FRESHNESS_FIELD_FAMILIES,
  },
  { name: 'pipelineStage', resolve: pipelineStage, all: ALL_PIPELINE_STAGES },
] as const;

describe('§16 vocabulary resolution', () => {
  it.each(VOCABULARIES)('$name resolves every member of its exact PRD set', ({ resolve, all }) => {
    for (const value of all) expect(resolve(value)).toBe(value);
  });

  it.each(VOCABULARIES)('$name refuses unknown values fail-closed', ({ resolve, all }) => {
    expect(() => resolve('TOTALLY_MADE_UP')).toThrow(ForesiftError);
    expect(() => resolve('')).toThrow(ForesiftError);
    // Case drift is a different string — never silently normalized.
    for (const value of all) {
      const shouted = value.toUpperCase() === value ? value.toLowerCase() : value.toUpperCase();
      if (!all.includes(shouted as never)) {
        expect(() => resolve(shouted)).toThrow(ForesiftError);
      }
    }
  });
});

describe('vocabulary exactness (PRD §5.3 / §16.3 / §16.6–16.9)', () => {
  it('carries the five §5.3 action classes verbatim', () => {
    expect(ALL_ACTION_CLASSES).toEqual([
      'EXTERNAL_READ',
      'INTERNAL_STATE_WRITE',
      'NOTIFICATION',
      'ADMINISTRATIVE',
      'PROHIBITED_FINANCIAL',
    ]);
  });

  it('admits only read-only classes and always refuses PROHIBITED_FINANCIAL', () => {
    expect(ADMISSIBLE_ACTION_CLASSES).not.toContain(ActionClass.PROHIBITED_FINANCIAL);
    expect(isProhibitedFinancialActionClass(ActionClass.PROHIBITED_FINANCIAL)).toBe(true);
    for (const cls of ADMISSIBLE_ACTION_CLASSES) {
      expect(isAdmissibleActionClass(cls)).toBe(true);
      expect(isProhibitedFinancialActionClass(cls)).toBe(false);
    }
    expect(isAdmissibleActionClass(ActionClass.PROHIBITED_FINANCIAL)).toBe(false);
  });

  it('carries the five §16.8 workload classes verbatim', () => {
    expect(ALL_WORKLOAD_CLASSES).toEqual([
      'INTERACTIVE_HIGH',
      'RISK_MONITOR_HIGH',
      'SCHEDULED_NORMAL',
      'EVALUATION_LOW',
      'BACKFILL_LOW',
    ]);
  });

  it('carries the four §16.3 cache outcomes verbatim', () => {
    expect(ALL_CACHE_OUTCOMES).toEqual(['MISS', 'HIT_FRESH', 'HIT_STALE', 'REFRESHED']);
  });

  it('carries the six §16.7 quota models verbatim', () => {
    expect(ALL_QUOTA_MODELS).toEqual([
      'RATE_ONLY',
      'REQUESTS_PER_PERIOD',
      'COMPUTE_UNITS_PER_PERIOD',
      'WEIGHTED_BUCKET',
      'CREDIT_BALANCE',
      'UNKNOWN_CONFIGURABLE',
    ]);
  });

  it('carries the eight §16.9 profiles verbatim', () => {
    expect(ALL_TOOL_PROFILE_IDS).toEqual([
      'discovery',
      'market-research',
      'security-research',
      'holder-wallet',
      'social-research',
      'macro-context',
      'run-investigation',
      'admin-read',
    ]);
  });

  it('carries the four §16.6 single-flight holder modes verbatim', () => {
    expect(ALL_HOLDER_MODES).toEqual(['MCP_MANUAL', 'CHATGPT', 'ADMIN_CHAT', 'AUTOMATION']);
  });
});

describe('reservation transition matrix (§16.7 + INV-009 retry idempotency)', () => {
  it.each([
    ['PENDING', 'RESERVED', true],
    ['RESERVED', 'COMMITTED', true],
    ['PENDING', 'RELEASED', true],
    ['RESERVED', 'RELEASED', true],
    ['RESERVED', 'EXPIRED', true],
    // idempotent retries of terminal states converge
    ['COMMITTED', 'COMMITTED', true],
    ['RELEASED', 'RELEASED', true],
    // everything else is illegal
    ['PENDING', 'COMMITTED', false],
    ['PENDING', 'EXPIRED', false],
    ['COMMITTED', 'RESERVED', false],
    ['COMMITTED', 'RELEASED', false],
    ['RELEASED', 'RESERVED', false],
    ['RELEASED', 'COMMITTED', false],
    ['EXPIRED', 'RESERVED', false],
    ['EXPIRED', 'RELEASED', false],
    ['EXPIRED', 'EXPIRED', false],
  ] as const)('%s → %s is %s', (from, to, legal) => {
    expect(isLegalReservationTransition(from, to)).toBe(legal);
  });

  it('covers every state in both matrix axes without gaps', () => {
    for (const from of ALL_RESERVATION_STATES) {
      for (const to of ALL_RESERVATION_STATES) {
        expect(() => isLegalReservationTransition(from, to)).not.toThrow();
      }
    }
  });

  it('refuses unknown states through the typed resolver', () => {
    expect(() => reservationState('MAYBE')).toThrow(/RESERVATION_STATE_UNKNOWN/);
  });
});

describe('freshness policy table (§16.5 example defaults)', () => {
  it.each([
    [FreshnessFieldFamily.PRICE_TRADES, 30, 120, StaleAdmissionScope.MANUAL_ONLY],
    [FreshnessFieldFamily.LIQUIDITY_POOL, 120, 600, StaleAdmissionScope.AUTOMATED],
    [FreshnessFieldFamily.HOLDER_SUMMARY, 600, 3600, StaleAdmissionScope.AUTOMATED],
    [FreshnessFieldFamily.SECURITY_SCAN, 21_600, 86_400, StaleAdmissionScope.AUTOMATED],
    [FreshnessFieldFamily.DEVELOPER_HISTORY, 86_400, 604_800, StaleAdmissionScope.AUTOMATED],
    [FreshnessFieldFamily.METADATA, 604_800, 2_592_000, StaleAdmissionScope.AUTOMATED],
  ] as const)('%s carries the verbatim TTL row', (family, fresh, stale, scope) => {
    expect(DEFAULT_FRESHNESS_POLICY_TABLE[family]).toEqual({
      freshTtlSeconds: fresh,
      acceptableStaleSeconds: stale,
      staleAdmission: scope,
    });
  });

  it('keeps stale windows at or beyond fresh windows everywhere', () => {
    for (const family of ALL_FRESHNESS_FIELD_FAMILIES) {
      const entry = DEFAULT_FRESHNESS_POLICY_TABLE[family];
      expect(entry.acceptableStaleSeconds).toBeGreaterThanOrEqual(entry.freshTtlSeconds);
    }
  });
});

describe('pipeline stage order (§16.2)', () => {
  it('holds exactly 24 stages', () => {
    expect(PIPELINE_STAGE_ORDER).toHaveLength(24);
    expect(ALL_PIPELINE_STAGES).toHaveLength(24);
  });

  it('contains no duplicates and matches the identifier set exactly', () => {
    expect(new Set(PIPELINE_STAGE_ORDER).size).toBe(24);
    expect([...PIPELINE_STAGE_ORDER].sort()).toEqual([...ALL_PIPELINE_STAGES].sort());
  });

  it('opens with authenticate/authorize/validate/persist-before-request', () => {
    expect(PIPELINE_STAGE_ORDER.slice(0, 5)).toEqual([
      PipelineStage.AUTHENTICATE_ACTOR,
      PipelineStage.AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS,
      PipelineStage.VALIDATE_AND_CANONICALIZE_INPUT,
      PipelineStage.VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE,
      PipelineStage.PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE,
    ]);
  });

  it('closes with audit then structured result', () => {
    expect(PIPELINE_STAGE_ORDER.slice(-2)).toEqual([
      PipelineStage.WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT,
      PipelineStage.RETURN_STRUCTURED_RESULT,
    ]);
  });
});
