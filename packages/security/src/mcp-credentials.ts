/**
 * MCP credential lifecycle over `sec.mcp_credentials` (FR-SEC-001, §35.12;
 * AC-053).
 *
 * Properties enforced here and in g0_sec_0002_mcp_credentials.sql:
 *   - ≥256-bit secret entropy via an INJECTABLE entropy seam (tests pin a
 *     deterministic generator; production uses crypto.getRandomValues);
 *   - the raw secret NEVER lands in SQL truth — only a keyed
 *     HMAC-SHA256(pepper, secret) rendered as `sha256:<hex>`; the raw
 *     material is returned exactly once at mint;
 *   - scope set, origin policy binding, profile/tool/resource/entity
 *     bounds, rate-limit class, expiry, and optional IP constraints are all
 *     recorded so any use validates against EVERY dimension;
 *   - per-row independent revocation: revoking one credential never
 *     touches another.
 */
import { createHmac } from 'node:crypto';
import type { UtcTimestamp } from '@foresift/domain';
import { CredentialError, SecErrorCode } from './errors.ts';

export type EntropySource = () => Uint8Array;

/** 32 bytes = 256 bits of entropy, the PRD floor for MCP credentials. */
export const CREDENTIAL_SECRET_BYTES = 32;

const DEFAULT_ENTROPY: EntropySource = () => {
  const bytes = new Uint8Array(CREDENTIAL_SECRET_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export interface IssueCredentialInput {
  readonly credentialId: string;
  /** Scope set — every use must stay inside ALL of these. */
  readonly scopes: readonly string[];
  /** Origin policy binding reference. */
  readonly originPolicyRef: string;
  readonly profileBindings?: readonly string[] | undefined;
  readonly toolBounds?: readonly string[] | undefined;
  readonly resourceBounds?: readonly string[] | undefined;
  readonly entityBounds?: readonly string[] | undefined;
  readonly rateLimitClass: string;
  readonly expiresAt: UtcTimestamp;
  readonly ipConstraints?: readonly string[] | undefined;
}

export interface IssuedCredential {
  /** The raw secret — shown EXACTLY once, never persisted anywhere. */
  readonly secret: string;
  readonly credentialId: string;
  readonly expiresAt: UtcTimestamp;
}

interface CredentialRow {
  credential_id: string;
  keyed_hash: string;
  scopes: string[];
  origin_policy_ref: string;
  profile_bindings: string[];
  tool_bounds: string[];
  resource_bounds: string[];
  entity_bounds: string[];
  rate_limit_class: string;
  expires_at: Date | string;
  ip_constraints: string[];
  created_at: Date | string;
  revoked_at: Date | string | null;
  last_used_at: Date | string | null;
  last_used_origin: string | null;
}

export interface AuthenticateInput {
  readonly presentedSecret: string;
  /** The origin the request arrived from; must match the policy binding. */
  readonly origin?: string | undefined;
  /** Requested operation scope(s); each must be covered by the grant. */
  readonly requestedScopes?: readonly string[] | undefined;
  readonly sourceIp?: string | undefined;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString().replace('.000Z', 'Z');
}

/** Keyed hash at rest: HMAC-SHA256(pepper, secret), rendered sha256:<hex>. */
function keyedHash(pepper: string, secret: string): string {
  return `sha256:${createHmac('sha256', pepper).update(secret, 'utf8').digest('hex')}`;
}

export class McpCredentialStore {
  private readonly engine: import('@foresift/persistence').DatabaseEngine;
  private readonly pepper: string;
  private readonly entropy: EntropySource;
  /** Injected clock (epoch ms) for expiry checks — policy stays testable. */
  private readonly clock: () => number;

  constructor(options: {
    engine: import('@foresift/persistence').DatabaseEngine;
    /** Server-side pepper keying the at-rest hash; NEVER logged or stored. */
    pepper: string;
    entropy?: EntropySource | undefined;
    clock?: (() => number) | undefined;
  }) {
    this.engine = options.engine;
    this.pepper = options.pepper;
    this.entropy = options.entropy ?? DEFAULT_ENTROPY;
    this.clock = options.clock ?? Date.now.bind(globalThis.Date);
  }

  /**
   * Mint a credential. Returns the raw secret exactly once; SQL truth only
   * ever sees the keyed hash.
   */
  async issue(input: IssueCredentialInput): Promise<IssuedCredential> {
    const bytes = this.entropy();
    if (bytes.length < CREDENTIAL_SECRET_BYTES) {
      throw new CredentialError(
        'credential entropy below the 256-bit floor',
        { bytes: bytes.length },
        SecErrorCode.SEC_CREDENTIAL_ENTROPY_INSUFFICIENT,
      );
    }
    const secret = Buffer.from(bytes).toString('base64url');
    // created_at follows the INJECTED clock so lifecycle checks stay
    // deterministic and never mix policy time with wall time.
    const createdAt = new Date(this.clock()).toISOString().replace('.000Z', 'Z');
    await this.engine.query(
      `INSERT INTO sec.mcp_credentials
         (credential_id, keyed_hash, scopes, origin_policy_ref, profile_bindings,
          tool_bounds, resource_bounds, entity_bounds, rate_limit_class,
          expires_at, ip_constraints, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.credentialId,
        keyedHash(this.pepper, secret),
        [...input.scopes],
        input.originPolicyRef,
        input.profileBindings === undefined ? [] : [...input.profileBindings],
        input.toolBounds === undefined ? [] : [...input.toolBounds],
        input.resourceBounds === undefined ? [] : [...input.resourceBounds],
        input.entityBounds === undefined ? [] : [...input.entityBounds],
        input.rateLimitClass,
        input.expiresAt,
        input.ipConstraints === undefined ? [] : [...input.ipConstraints],
        createdAt,
      ],
    );
    return { secret, credentialId: input.credentialId, expiresAt: input.expiresAt };
  }

  private async rowForSecret(presentedSecret: string): Promise<CredentialRow> {
    const result = await this.engine.query<CredentialRow>(
      'SELECT * FROM sec.mcp_credentials WHERE keyed_hash = $1',
      [keyedHash(this.pepper, presentedSecret)],
    );
    const row = result.rows[0];
    if (row === undefined) {
      // Unknown material fails closed with the SAME error class as any
      // other refusal — no oracle distinguishing "never issued".
      throw new CredentialError(
        'no credential matches the presented material',
        {},
        SecErrorCode.SEC_CREDENTIAL_UNKNOWN,
      );
    }
    return row;
  }

  /**
   * Validate presented material against EVERY recorded dimension:
   * existence, revocation, expiry, IP constraints, origin policy binding,
   * and requested-scope coverage.
   */
  async authenticate(input: AuthenticateInput): Promise<CredentialRow> {
    const row = await this.rowForSecret(input.presentedSecret);
    if (row.revoked_at !== null) {
      throw new CredentialError(
        'credential has been revoked',
        { credentialId: row.credential_id },
        SecErrorCode.SEC_CREDENTIAL_REVOKED,
      );
    }
    if (Date.parse(iso(row.expires_at)) <= this.clock()) {
      throw new CredentialError(
        'credential has expired',
        { credentialId: row.credential_id },
        SecErrorCode.SEC_CREDENTIAL_EXPIRED,
      );
    }
    if (
      input.sourceIp !== undefined &&
      row.ip_constraints.length > 0 &&
      !row.ip_constraints.includes(input.sourceIp)
    ) {
      throw new CredentialError(
        'source address is outside the credential IP constraints',
        { credentialId: row.credential_id },
        SecErrorCode.SEC_CREDENTIAL_ORIGIN_MISMATCH,
      );
    }
    if (
      input.origin !== undefined &&
      row.origin_policy_ref !== '' &&
      input.origin !== row.origin_policy_ref
    ) {
      throw new CredentialError(
        'origin does not match the credential policy binding',
        { credentialId: row.credential_id },
        SecErrorCode.SEC_CREDENTIAL_ORIGIN_MISMATCH,
      );
    }
    if (input.requestedScopes !== undefined) {
      const exceeded = input.requestedScopes.filter((s) => !row.scopes.includes(s));
      if (exceeded.length > 0) {
        throw new CredentialError(
          'requested scopes exceed the granted scope set',
          { credentialId: row.credential_id, exceeded: exceeded.join(',') },
          SecErrorCode.SEC_CREDENTIAL_SCOPE_EXCEEDED,
        );
      }
    }
    return row;
  }

  async recordUsage(
    credentialId: string,
    usage: { at: UtcTimestamp; origin: string },
  ): Promise<void> {
    await this.engine.query(
      'UPDATE sec.mcp_credentials SET last_used_at = $2, last_used_origin = $3 WHERE credential_id = $1',
      [credentialId, usage.at, usage.origin],
    );
  }

  /**
   * Independent revocation: flips ONLY this row's revoked_at; sibling
   * credentials remain fully usable (per-row revoked_at in SQL).
   */
  async revoke(credentialId: string, at: UtcTimestamp): Promise<void> {
    const result = await this.engine.query<{ credential_id: string }>(
      'UPDATE sec.mcp_credentials SET revoked_at = $2 WHERE credential_id = $1 AND revoked_at IS NULL RETURNING credential_id',
      [credentialId, at],
    );
    if (result.rows.length !== 1) {
      throw new CredentialError(
        'credential unknown or already revoked',
        { credentialId },
        SecErrorCode.SEC_CREDENTIAL_UNKNOWN,
      );
    }
  }
}
