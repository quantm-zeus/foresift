/**
 * Admin control plane shared-schema suite
 * (T003, FR-ADM-001/003/007, AC-014, AC-063).
 *
 * Pins the `.strict()` envelopes for the §28.13 kill-switch state/event, the
 * §28.3 immutable configuration version, the §28.4 resolved-configuration
 * preview and precedence chain, the §28.2 overview section/snapshot, the
 * §35.1 high-impact action request and audit, and the typed admin error
 * envelope. Unknown keys/literals, malformed `sha256:<hex>` hashes, non-zero
 * provider-call counters, an ENGAGED switch without actor/reason, an
 * out-of-order precedence chain, and a control action missing its
 * idempotency/reason fields are refused.
 */
import { describe, expect, it } from 'bun:test';
import {
  ADM_SCHEMA_REGISTRY_VERSION,
  AdminActionAuditRowSchema,
  AdminControlActionRequestSchema,
  AdminErrorEnvelopeSchema,
  AdmSchemaRegistry,
  ALL_ADMIN_ACTION_AUDIT_KINDS,
  ALL_ADMIN_CONTROL_ACTIONS,
  ALL_CONFIG_KINDS,
  ALL_CONFIG_LIFECYCLE_STATES,
  ALL_KILL_SWITCH_KINDS,
  ALL_KILL_SWITCH_STATES,
  ALL_OVERVIEW_SECTION_KEYS,
  ALL_RESOLVED_CONFIG_PRECEDENCE,
  ConfigVersionRowSchema,
  KillSwitchEventRowSchema,
  KillSwitchStateRowSchema,
  OverviewSectionSchema,
  OverviewSnapshotRowSchema,
  ResolvedConfigPreviewRowSchema,
  isAllowedLifecycleTransition,
  isOrderedPrecedenceChain,
  parseAdmSchema,
  type KillSwitchKind,
} from '../src/adm.ts';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;
const AT = '2026-09-01T00:00:00Z';
const LATER = '2026-10-01T00:00:00Z';

const SCOPE = { scopeKind: 'GLOBAL', scopeRef: 'global' };

const engagedState = {
  stateRowId: 'ks-state-1',
  switchKind: 'DISABLE_ALL_AUTOMATION',
  scope: SCOPE,
  scopeHash: HASH,
  state: 'ENGAGED',
  reason: 'engaging after a provider incident',
  actorRef: 'admin@example.com',
  stepUpRef: 'proof-1',
  auditRef: 'audit-1',
  expiresAt: null,
  supersededBy: null,
  createdAt: AT,
};

const switchEvent = {
  eventId: 'ks-event-1',
  switchKind: 'DISABLE_ALL_AUTOMATION',
  fromState: 'DISENGAGED',
  toState: 'ENGAGED',
  scope: SCOPE,
  scopeHash: HASH,
  reason: 'engaging after a provider incident',
  actorRef: 'admin@example.com',
  stepUpRef: 'proof-1',
  csrfRef: 'csrf-1',
  idempotencyKey: 'idem-ks-1',
  auditRef: 'audit-1',
  occurredAt: AT,
};

const configVersion = {
  configVersionId: 'cfg-1',
  configKind: 'SCHEDULE',
  configId: 'schedule-1',
  version: 3,
  ownerVersionRef: 'wf-schedule-version-3',
  configHash: HASH,
  lifecycleState: 'ACTIVE',
  resolvedConfig: { cron: '0 * * * *', timezone: 'UTC' },
  resolvedConfigHash: HASH_B,
  supersededBy: null,
  rolledBackFrom: null,
  approvedByRef: 'admin@example.com',
  createdAt: AT,
};

const resolvedPreview = {
  previewId: 'preview-1',
  configVersionId: 'cfg-1',
  precedence: ['SYSTEM_DEFAULTS', 'WORKFLOW_VERSION', 'AGENT_PROFILE_VERSION', 'SCHEDULE_VERSION'],
  resolvedConfig: { cron: '0 * * * *', timezone: 'UTC', model: 'model-v2' },
  resolvedHash: HASH_C,
  computedAt: AT,
  expiresAt: LATER,
};

const overviewSection = {
  sectionKey: 'SYSTEM_MODE',
  ownerPackage: '@foresift/capability-registry',
  freshness: 'FRESH',
  rowRefs: ['module-state-1'],
  payloadHash: HASH,
  computedAt: AT,
};

const overviewSnapshot = {
  snapshotId: 'snapshot-1',
  generatedAt: AT,
  systemMode: 'DEGRADED',
  sections: [overviewSection],
  sourceRefs: ['module-state-1'],
  sectionHashes: { SYSTEM_MODE: HASH },
  readModelHash: HASH_B,
  providerCallsTriggered: 0,
  externalWriteAttempts: 0,
};

const actionRequest = {
  actionKind: 'KILL_SWITCH_ENGAGE',
  targetRef: 'DISABLE_ALL_AUTOMATION',
  targetVersionRef: null,
  actorRef: 'admin@example.com',
  reason: 'engaging after a provider incident',
  idempotencyKey: 'idem-ks-1',
  authorizationScope: 'admin:high:kill-switch',
  requestedAt: AT,
};

const allowedAudit = {
  actionId: 'action-1',
  actionKind: 'KILL_SWITCH_ENGAGE',
  targetRef: 'DISABLE_ALL_AUTOMATION',
  targetVersionRef: null,
  actorRef: 'admin@example.com',
  stepUpRef: 'proof-1',
  csrfRef: 'csrf-1',
  idempotencyKey: 'idem-ks-1',
  reason: 'engaging after a provider incident',
  outcome: 'ALLOWED',
  refusalCode: null,
  beforeHash: HASH,
  afterHash: HASH_B,
  auditRef: 'audit-1',
  recordedAt: AT,
};

const refusedAudit = {
  ...allowedAudit,
  actionId: 'action-2',
  outcome: 'REFUSED',
  refusalCode: 'ADMIN_CSRF_INVALID',
  idempotencyKey: null,
  stepUpRef: null,
  csrfRef: null,
};

const errorEnvelope = {
  ok: false,
  error: {
    code: 'ADMIN_KILL_SWITCH_ENGAGED',
    message: 'DISABLE_ALL_AUTOMATION is engaged',
    correlationId: 'corr-1',
  },
};

describe('adm schema registry shape', () => {
  it('is versioned and exposes no update schema (immutability by construction)', () => {
    expect(ADM_SCHEMA_REGISTRY_VERSION).toBe(1);
    const names = Object.keys(AdmSchemaRegistry);
    expect(names).toContain('KillSwitchStateRow');
    expect(names).toContain('ConfigVersionRow');
    expect(names).toContain('ResolvedConfigPreviewRow');
    expect(names).toContain('OverviewSnapshotRow');
    expect(names).toContain('AdminActionAuditRow');
    expect(names).toContain('AdminErrorEnvelope');
    expect(names.some((name) => name.includes('Update'))).toBe(false);
  });

  it('round-trips a registered schema and refuses unknown keys through the parser', () => {
    const parsed = parseAdmSchema('KillSwitchStateRow', engagedState);
    expect(parsed.switchKind).toBe('DISABLE_ALL_AUTOMATION');
    expect(parsed.state).toBe('ENGAGED');
    expect(() => parseAdmSchema('KillSwitchStateRow', { ...engagedState, extra: 1 })).toThrow();
  });
});

describe('closed vocabularies', () => {
  it('declares exactly the §28.13 six kill switches and two states', () => {
    expect([...ALL_KILL_SWITCH_KINDS]).toEqual([
      'DISABLE_ALL_AUTOMATION',
      'DISABLE_ALL_MODEL_CALLS',
      'DISABLE_ALL_PROVIDER_CALLS',
      'DISABLE_NOTIFICATIONS',
      'REVOKE_ALL_MCP_CLIENTS',
      'EMERGENCY_READ_ONLY_MODE',
    ]);
    expect([...ALL_KILL_SWITCH_STATES]).toEqual(['ENGAGED', 'DISENGAGED']);
  });

  it('declares the §28.3 lifecycle, the §25.11 actions, and the config kinds once', () => {
    expect([...ALL_CONFIG_LIFECYCLE_STATES]).toEqual([
      'DRAFT',
      'VALIDATED',
      'APPROVED',
      'ACTIVE',
      'DEPRECATED',
      'ROLLED_BACK',
    ]);
    expect([...ALL_CONFIG_KINDS]).toHaveLength(10);
    expect([...ALL_ADMIN_CONTROL_ACTIONS]).toEqual([
      'CREATE',
      'EDIT_DRAFT',
      'VALIDATE',
      'FORECAST',
      'ENABLE',
      'PAUSE',
      'RESUME',
      'RUN_NOW',
      'DRY_RUN',
      'DUPLICATE',
      'DISABLE',
      'DELETE',
    ]);
    expect([...ALL_ADMIN_ACTION_AUDIT_KINDS]).toHaveLength(12);
    expect([...ALL_OVERVIEW_SECTION_KEYS]).toHaveLength(15);
  });

  it('accepts every kill-switch kind through the row schema, refusing unknown literals', () => {
    for (const kind of ALL_KILL_SWITCH_KINDS) {
      const parsed = KillSwitchStateRowSchema.parse({
        ...engagedState,
        switchKind: kind,
      });
      expect(parsed.switchKind).toBe(kind);
    }
    expect(() =>
      KillSwitchStateRowSchema.parse({ ...engagedState, switchKind: 'DISABLE_EVERYTHING' }),
    ).toThrow();
    expect(() =>
      parseAdmSchema('KillSwitchStateRow', { ...engagedState, state: 'CLOSED' }),
    ).toThrow();
  });

  it('links the §28.3 lifecycle transition law to the vocabulary', () => {
    expect(isAllowedLifecycleTransition('DRAFT', 'VALIDATED')).toBe(true);
    expect(isAllowedLifecycleTransition('VALIDATED', 'APPROVED')).toBe(true);
    expect(isAllowedLifecycleTransition('APPROVED', 'ACTIVE')).toBe(true);
    expect(isAllowedLifecycleTransition('ACTIVE', 'DEPRECATED')).toBe(true);
    expect(isAllowedLifecycleTransition('DEPRECATED', 'ROLLED_BACK')).toBe(true);
    expect(isAllowedLifecycleTransition('ROLLED_BACK', 'ACTIVE')).toBe(false);
    expect(isAllowedLifecycleTransition('DRAFT', 'ACTIVE')).toBe(false);
  });
});

describe('§28.4 resolved-configuration precedence', () => {
  it('round-trips the canonical ascending chain', () => {
    expect([...ALL_RESOLVED_CONFIG_PRECEDENCE]).toEqual([
      'SYSTEM_DEFAULTS',
      'WORKFLOW_VERSION',
      'AGENT_PROFILE_VERSION',
      'SCHEDULE_VERSION',
      'RUN_NOW_OVERRIDE',
    ]);
    expect(isOrderedPrecedenceChain([...ALL_RESOLVED_CONFIG_PRECEDENCE])).toBe(true);
    expect(isOrderedPrecedenceChain(['SYSTEM_DEFAULTS', 'SCHEDULE_VERSION'])).toBe(true);
  });

  it('refuses a reordered, duplicated, empty, or unknown chain', () => {
    expect(isOrderedPrecedenceChain(['SCHEDULE_VERSION', 'WORKFLOW_VERSION'])).toBe(false);
    expect(isOrderedPrecedenceChain(['SYSTEM_DEFAULTS', 'SYSTEM_DEFAULTS'])).toBe(false);
    expect(isOrderedPrecedenceChain(['SYSTEM_DEFAULTS', 'NOT_A_LAYER'])).toBe(false);
    expect(isOrderedPrecedenceChain([])).toBe(false);
    expect(() =>
      ResolvedConfigPreviewRowSchema.parse({
        ...resolvedPreview,
        precedence: ['SCHEDULE_VERSION', 'WORKFLOW_VERSION'],
      }),
    ).toThrow();
  });
});

describe('§28.13 kill-switch state row', () => {
  it('accepts an ENGAGED row with actor and reason', () => {
    const parsed = KillSwitchStateRowSchema.parse(engagedState);
    expect(parsed.state).toBe('ENGAGED');
    expect(parsed.supersededBy).toBeNull();
  });

  it('refuses ENGAGED without an actor, without a reason, and with a malformed hash', () => {
    expect(() => KillSwitchStateRowSchema.parse({ ...engagedState, actorRef: null })).toThrow();
    expect(() => KillSwitchStateRowSchema.parse({ ...engagedState, reason: null })).toThrow();
    expect(() => KillSwitchStateRowSchema.parse({ ...engagedState, reason: '' })).toThrow();
    expect(() =>
      KillSwitchStateRowSchema.parse({ ...engagedState, scopeHash: 'sha256:nope' }),
    ).toThrow();
    expect(() =>
      KillSwitchStateRowSchema.parse({ ...engagedState, stateRowId: 'x', supersededBy: 'x' }),
    ).toThrow();
    expect(() => KillSwitchStateRowSchema.parse({ ...engagedState, extra: true })).toThrow();
  });

  it('accepts a DISENGAGED row without actor/reason, as a released switch is', () => {
    const parsed = KillSwitchStateRowSchema.parse({
      ...engagedState,
      state: 'DISENGAGED',
      actorRef: null,
      reason: null,
    });
    expect(parsed.state).toBe('DISENGAGED');
  });
});

describe('§28.13 kill-switch event row', () => {
  it('accepts a transition and refuses a no-op transition or missing idempotency', () => {
    expect(KillSwitchEventRowSchema.parse(switchEvent).toState).toBe('ENGAGED');
    expect(() =>
      KillSwitchEventRowSchema.parse({ ...switchEvent, fromState: 'ENGAGED' }),
    ).toThrow();
    expect(() => KillSwitchEventRowSchema.parse({ ...switchEvent, idempotencyKey: '' })).toThrow();
    expect(() => KillSwitchEventRowSchema.parse({ ...switchEvent, csrfRef: undefined })).toThrow();
  });
});

describe('§28.3 immutable configuration version', () => {
  it('accepts an ACTIVE version with an approval reference', () => {
    expect(ConfigVersionRowSchema.parse(configVersion).lifecycleState).toBe('ACTIVE');
  });

  it('refuses ACTIVE without approval, a malformed hash, and self references', () => {
    expect(() => ConfigVersionRowSchema.parse({ ...configVersion, approvedByRef: null })).toThrow();
    expect(() =>
      ConfigVersionRowSchema.parse({ ...configVersion, resolvedConfigHash: 'sha256:nope' }),
    ).toThrow();
    expect(() =>
      ConfigVersionRowSchema.parse({
        ...configVersion,
        supersededBy: configVersion.configVersionId,
      }),
    ).toThrow();
    expect(() =>
      ConfigVersionRowSchema.parse({
        ...configVersion,
        rolledBackFrom: configVersion.configVersionId,
      }),
    ).toThrow();
    expect(() =>
      ConfigVersionRowSchema.parse({ ...configVersion, lifecycleState: 'RETIRED' }),
    ).toThrow();
    expect(() => ConfigVersionRowSchema.parse({ ...configVersion, extra: 1 })).toThrow();
  });
});

describe('§28.2 overview read model', () => {
  it('accepts a fresh section with its owner and row refs', () => {
    expect(OverviewSectionSchema.parse(overviewSection).sectionKey).toBe('SYSTEM_MODE');
  });

  it('refuses a FRESH section with no row refs and an unknown section key', () => {
    expect(() => OverviewSectionSchema.parse({ ...overviewSection, rowRefs: [] })).toThrow();
    expect(() =>
      OverviewSectionSchema.parse({ ...overviewSection, sectionKey: 'PROFIT' }),
    ).toThrow();
    expect(() =>
      OverviewSectionSchema.parse({ ...overviewSection, freshness: 'COMPLETE' }),
    ).toThrow();
  });

  it('accepts a zero-provider-call snapshot and refuses any non-zero counter', () => {
    const parsed = OverviewSnapshotRowSchema.parse(overviewSnapshot);
    expect(parsed.providerCallsTriggered).toBe(0);
    expect(parsed.externalWriteAttempts).toBe(0);
    expect(() =>
      OverviewSnapshotRowSchema.parse({ ...overviewSnapshot, providerCallsTriggered: 1 }),
    ).toThrow();
    expect(() =>
      OverviewSnapshotRowSchema.parse({ ...overviewSnapshot, externalWriteAttempts: 1 }),
    ).toThrow();
    expect(() => OverviewSnapshotRowSchema.parse({ ...overviewSnapshot, extra: 1 })).toThrow();
  });

  it('refuses a snapshot that names one section twice', () => {
    expect(() =>
      OverviewSnapshotRowSchema.parse({
        ...overviewSnapshot,
        sections: [overviewSection, overviewSection],
      }),
    ).toThrow();
  });
});

describe('§35.1 high-impact action envelope and audit', () => {
  it('accepts a fully-dimensioned control action request', () => {
    expect(AdminControlActionRequestSchema.parse(actionRequest).idempotencyKey).toBe('idem-ks-1');
  });

  it('refuses a control action missing its idempotency or reason fields', () => {
    expect(() =>
      AdminControlActionRequestSchema.parse({ ...actionRequest, idempotencyKey: '' }),
    ).toThrow();
    expect(() => AdminControlActionRequestSchema.parse({ ...actionRequest, reason: '' })).toThrow();
    const { idempotencyKey: _idempotencyKey, ...withoutIdempotency } = actionRequest;
    expect(() => AdminControlActionRequestSchema.parse(withoutIdempotency)).toThrow();
    const { reason: _reason, ...withoutReason } = actionRequest;
    expect(() => AdminControlActionRequestSchema.parse(withoutReason)).toThrow();
    expect(() =>
      AdminControlActionRequestSchema.parse({ ...actionRequest, actionKind: 'NUKE' }),
    ).toThrow();
    expect(() =>
      AdminControlActionRequestSchema.parse({
        ...actionRequest,
        authorizationScope: 'admin:high:everything',
      }),
    ).toThrow();
  });

  it('accepts allowed and refused audit rows with their required evidence', () => {
    expect(AdminActionAuditRowSchema.parse(allowedAudit).outcome).toBe('ALLOWED');
    expect(AdminActionAuditRowSchema.parse(refusedAudit).refusalCode).toBe('ADMIN_CSRF_INVALID');
  });

  it('refuses an allowed action without idempotency/step-up/CSRF and a refused one without a code', () => {
    expect(() =>
      AdminActionAuditRowSchema.parse({ ...allowedAudit, idempotencyKey: null }),
    ).toThrow();
    expect(() => AdminActionAuditRowSchema.parse({ ...allowedAudit, stepUpRef: null })).toThrow();
    expect(() => AdminActionAuditRowSchema.parse({ ...allowedAudit, csrfRef: null })).toThrow();
    expect(() => AdminActionAuditRowSchema.parse({ ...refusedAudit, refusalCode: null })).toThrow();
    expect(() => AdminActionAuditRowSchema.parse({ ...allowedAudit, reason: '' })).toThrow();
    expect(() =>
      AdminActionAuditRowSchema.parse({ ...allowedAudit, beforeHash: 'nope' }),
    ).toThrow();
  });

  it('carries a correlation id and stable code and refuses a stack trace', () => {
    expect(AdminErrorEnvelopeSchema.parse(errorEnvelope).error.correlationId).toBe('corr-1');
    expect(() =>
      AdminErrorEnvelopeSchema.parse({
        ...errorEnvelope,
        error: { ...errorEnvelope.error, stack: 'at foo' },
      }),
    ).toThrow();
    expect(() => AdminErrorEnvelopeSchema.parse({ ...errorEnvelope, stack: 'at foo' })).toThrow();
    expect(() =>
      AdminErrorEnvelopeSchema.parse({
        ...errorEnvelope,
        error: { ...errorEnvelope.error, code: 'NOT_A_CODE' },
      }),
    ).toThrow();
  });
});

describe('kill-switch vocabulary typing', () => {
  it('every declared kind is assignable to the exported type', () => {
    const kinds: readonly KillSwitchKind[] = ALL_KILL_SWITCH_KINDS;
    expect(kinds).toHaveLength(6);
  });
});
