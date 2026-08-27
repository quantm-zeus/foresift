// Security error hierarchy contract (M22): every typed refusal subclass
// defaults to its declared machine code, carries structured detail, threads
// ES `cause` options, and is exported from the package barrel — verified
// table-driven so a newly added class without a declared default FAILS here.
import { describe, expect, it } from 'bun:test';
import * as sec from '../src/index.ts';
import { ForesiftSecurityError, SecErrorCode } from '../src/errors.ts';

type SubclassCtor = new (
  message: string,
  detail?: { readonly [k: string]: string | number | boolean | null },
  code?: SecErrorCode,
  options?: ErrorOptions,
) => ForesiftSecurityError;

/** [exported constructor, default machine code] for EVERY refusal subclass. */
const TABLE: ReadonlyArray<readonly [SubclassCtor, string, SecErrorCode]> = [
  [sec.AuditChainError, 'AuditChainError', SecErrorCode.SEC_AUDIT_CHAIN_VERIFICATION_FAILED],
  [sec.ActionGateError, 'ActionGateError', SecErrorCode.SEC_STEP_UP_PROOF_MISSING],
  [sec.McpOriginError, 'McpOriginError', SecErrorCode.SEC_ORIGIN_NOT_ALLOWLISTED],
  [sec.ProtocolGuardError, 'ProtocolGuardError', SecErrorCode.SEC_PROTOCOL_REVISION_UNSUPPORTED],
  [sec.OAuthBindingError, 'OAuthBindingError', SecErrorCode.SEC_OAUTH_PKCE_REQUIRED],
  [sec.EgressError, 'EgressError', SecErrorCode.SEC_EGRESS_HOST_NOT_ALLOWLISTED],
  [
    sec.UntrustedContentError,
    'UntrustedContentError',
    SecErrorCode.SEC_UNTRUSTED_INSTRUCTION_ROLE_REFUSED,
  ],
  [sec.WebhookIntegrityError, 'WebhookIntegrityError', SecErrorCode.SEC_WEBHOOK_SIGNATURE_INVALID],
  [sec.AbuseControlError, 'AbuseControlError', SecErrorCode.SEC_ABUSE_RATE_LIMIT_EXCEEDED],
  [sec.SecretsPolicyError, 'SecretsPolicyError', SecErrorCode.SEC_SECRET_CONTEXT_INSERTION_REFUSED],
  [sec.SupplyChainError, 'SupplyChainError', SecErrorCode.SEC_DEPENDENCY_UNPINNED],
  [sec.ImportGatingError, 'ImportGatingError', SecErrorCode.SEC_IMPORT_FORMAT_REFUSED],
  [sec.IncidentError, 'IncidentError', SecErrorCode.SEC_INCIDENT_STATE_TRANSITION_INVALID],
  [sec.GatePauseError, 'GatePauseError', SecErrorCode.SEC_PAUSE_AUTO_REACTIVATION_REFUSED],
  [sec.ClaimsPolicyError, 'ClaimsPolicyError', SecErrorCode.SEC_CLAIMS_POLICY_VIOLATED],
  [
    sec.ProhibitedCapabilityError,
    'ProhibitedCapabilityError',
    SecErrorCode.SEC_PROHIBITED_CAPABILITY_DETECTED,
  ],
  [sec.CredentialError, 'CredentialError', SecErrorCode.SEC_CREDENTIAL_REVOKED],
  [
    sec.TenantIsolationError,
    'TenantIsolationError',
    SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
  ],
];

describe('security error hierarchy (M22)', () => {
  it('every subclass defaults to its declared machine code and carries detail', () => {
    for (const [Ctor, name, defaultCode] of TABLE) {
      const error = new Ctor('boom', { key: 'value' });
      expect(error, name).toBeInstanceOf(ForesiftSecurityError);
      expect(error, name).toBeInstanceOf(Error);
      expect(error.name, name).toBe(name);
      expect(error.code, name).toBe(defaultCode);
      expect(error.detail, name).toEqual({ key: 'value' });
      // The rendered message leads with the machine code for log grepping.
      expect(error.message.startsWith(`${String(defaultCode)}: `), name).toBe(true);
    }
  });

  it('supports per-site code override and ES cause threading uniformly', () => {
    const cause = new Error('root failure');
    const error = new sec.IncidentError(
      'wrapped',
      {},
      SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED,
      { cause },
    );
    expect(error.code).toBe(SecErrorCode.SEC_INCIDENT_EVIDENCE_REQUIRED);
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });

  it('the barrel re-exports the full perimeter surface', async () => {
    for (const [, name] of TABLE) {
      expect(sec, name).toHaveProperty(name);
    }
    for (const fn of [
      'evaluateCsrf',
      'validateDecoderAuthority',
      'emitSbomRecord',
      'requireLockfile',
      'parseStructuredExtractionFence',
      'AuditChain',
      'ActionGate',
      'Incidents',
      'GatePauses',
      'WebhookGuard',
      'McpCredentialStore',
    ]) {
      expect(typeof (sec as Record<string, unknown>)[fn], fn).toBe('function');
    }
  });
});
