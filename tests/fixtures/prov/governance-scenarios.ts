/**
 * Governance scenario data — TTL expiry, rights change, and trading-shaped
 * refusal variants (T125). Declarative constants only: the acceptance and
 * negative suites read these timelines/matrices so scenario values are
 * reviewable in one place. No imports, no executable content.
 */

// --- AC-270: verification-TTL lifecycle timeline (UTC) ---------------------

export const VERIFICATION_TIMELINE = {
  /** Registration + activation instant. */
  t0Activation: '2026-06-01T00:00:00Z',
  /** Rights/plan verification evidence captured at activation. */
  t0Verified: '2026-06-01T00:00:00Z',
  /** Configured per-kind TTL (seconds). */
  ttlSeconds: 3600,
  /** First expiry: both kinds lapse together. */
  t1Lapsed: '2026-06-01T02:00:01Z',
  /** The refresh-pair evidence instants (post-lapse). */
  t2Refreshed: '2026-06-01T03:00:00Z',
} as const;

export const VERIFICATION_KINDS_FOR_SCENARIO = ['PRICING_PLAN', 'RIGHTS'] as const;

// --- AC-273: rights-change timeline + matrices -------------------------------

export const RIGHTS_TIMELINE = {
  captureInstant: '2026-06-05T00:00:00Z',
  tighteningInstant: '2026-06-10T00:00:00Z',
  looseningAttemptInstant: '2026-07-20T00:00:00Z',
  /** Window of the ORIGINAL declaration — closed by loosening-attempt time. */
  v1VerifiedAt: '2026-06-01T00:00:00Z',
  v1ExpiresAt: '2026-07-01T00:00:00Z',
  /** Fresh window carried by any legitimately reverification-backed version. */
  reverifiedAt: '2026-07-15T00:00:00Z',
  reverifiedExpiresAt: '2026-08-15T00:00:00Z',
} as const;

export const RIGHTS_V1_PERMISSIVE = {
  commercialUseAllowed: true,
  personalResearchAllowed: true,
  cacheAllowed: true,
  maximumCacheDurationSeconds: 86_400,
  rawRetentionAllowed: true,
  derivedFeaturesAllowed: true,
  modelTrainingAllowed: true,
  redistributionAllowed: true,
  publicAlertDerivativeAllowed: true,
  attributionRequired: true,
  userByokRequired: false,
  rawExportAllowed: true,
  jurisdictionRestrictions: [] as string[],
  termsVersion: 'terms/scenario-v1',
} as const;

/**
 * v2 TIGHTENS five paths at once: CACHE, RAW_RETENTION_STORAGE, RAW_EXPORT,
 * REDISTRIBUTION, MODEL_TRAINING_USE — exactly the AC-273 enumerated set.
 */
export const RIGHTS_V2_TIGHTENED = {
  ...RIGHTS_V1_PERMISSIVE,
  cacheAllowed: false,
  maximumCacheDurationSeconds: null,
  rawRetentionAllowed: false,
  rawExportAllowed: false,
  redistributionAllowed: false,
  modelTrainingAllowed: false,
  termsVersion: 'terms/scenario-v2',
} as const;

/** The use paths AC-273 demands flip to refuse immediately after v2. */
export const NEWLY_PROHIBITED_USES_V2 = [
  'CACHE',
  'RAW_RETENTION_STORAGE',
  'REDISTRIBUTION',
  'MODEL_TRAINING_USE',
  'RAW_EXPORT',
] as const;

// --- GMGN trading-shaped definition variants (FR-PROV-004 refusals) ---------

export const GMGN_TRADING_SHAPED_VARIANTS: ReadonlyArray<{
  readonly operationId: string;
  readonly capabilityClass: string;
}> = [
  { operationId: 'gmgn/swap-quote-and-submit', capabilityClass: 'PROHIBITED_TRANSACTION_BUILD' },
  { operationId: 'gmgn/sign-message-relay', capabilityClass: 'PROHIBITED_SIGN' },
  { operationId: 'gmgn/broadcast-transaction', capabilityClass: 'PROHIBITED_SUBMIT' },
  { operationId: 'gmgn/custody-view', capabilityClass: 'PROHIBITED_CUSTODY' },
];
