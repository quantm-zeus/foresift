/**
 * Tenant-bound, expiring, audience-bound signed URLs (FR-SEC-009; T131,
 * AC-252). Tokens are HMAC-SHA256 over a canonical JSON claim set keyed by
 * the deployment pepper; validation re-derives and constant-time compares.
 * A signed URL minted in tenant A validates ONLY for tenant A, the exact
 * audience, method, resource, and before expiry — every other combination
 * refuses.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SecErrorCode, TenantIsolationError } from '@foresift/security';

const TOKEN_VERSION = 'v1';

export interface SignedUrlClaims {
  readonly v: 'v1';
  /** Fully-qualified resource URI the token authorizes. */
  readonly uri: string;
  readonly tenantId: string;
  readonly actor: string;
  /** Audience binding (e.g. 'mcp', 'alpha-lab', 'operator-ui'). */
  readonly aud: string;
  /** HTTP method binding. */
  readonly mth: 'GET' | 'HEAD';
  /** Expiry, epoch ms. */
  readonly exp: number;
}

function canonicalClaimsJson(claims: SignedUrlClaims): string {
  return JSON.stringify([
    claims.v,
    claims.uri,
    claims.tenantId,
    claims.actor,
    claims.aud,
    claims.mth,
    claims.exp,
  ]);
}

function hmac(pepper: string, payload: string): Buffer {
  return createHmac('sha256', pepper).update(payload, 'utf8').digest();
}

/** sha256:<hex> digest comparison — constant time over fixed-length bytes. */
function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export interface SignedUrlValidation {
  readonly valid: true;
  readonly claims: SignedUrlClaims;
}

export class SignedUrlService {
  private readonly pepper: string;
  private readonly defaultTtlSeconds: number;
  private readonly clock: () => number;

  constructor(options: {
    pepper: string;
    defaultTtlSeconds?: number | undefined;
    clock?: (() => number) | undefined;
  }) {
    if (options.pepper.trim() === '') {
      throw new TenantIsolationError(
        'signed-URL service requires a non-empty pepper',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_INVALID,
      );
    }
    this.pepper = options.pepper;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
    this.clock = options.clock ?? Date.now;
  }

  mint(input: {
    uri: string;
    context: { tenantId: string; actor: string };
    audience: string;
    ttlSeconds?: number | undefined;
    method?: 'GET' | 'HEAD' | undefined;
  }): string {
    const claims: SignedUrlClaims = {
      v: TOKEN_VERSION,
      uri: input.uri,
      tenantId: input.context.tenantId,
      actor: input.context.actor,
      aud: input.audience,
      mth: input.method ?? 'GET',
      exp: this.clock() + (input.ttlSeconds ?? this.defaultTtlSeconds) * 1000,
    };
    const payload = base64UrlEncode(canonicalClaimsJson(claims));
    const mac = hmac(this.pepper, payload);
    return `${TOKEN_VERSION}.${payload}.${mac.toString('base64url')}`;
  }

  /**
   * Validate a presented token against the EXPECTED bindings (audience,
   * tenant, method, URI). Any mismatch — including a re-signed token with
   * edited claims — refuses with a typed error.
   */
  validate(input: {
    token: string;
    audience: string;
    expectedTenantId?: string | undefined;
    expectedUri?: string | undefined;
    method?: 'GET' | 'HEAD' | undefined;
  }): SignedUrlValidation {
    const parts = input.token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
      throw new TenantIsolationError(
        'signed URL malformed or unsupported version',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_INVALID,
      );
    }
    const payloadPart = parts[1] ?? '';
    const macPart = parts[2] ?? '';
    let claims: SignedUrlClaims;
    try {
      const raw = JSON.parse(base64UrlDecode(payloadPart)) as unknown;
      if (!Array.isArray(raw) || raw.length !== 7) throw new Error('shape');
      claims = {
        v: raw[0] as 'v1',
        uri: raw[1] as string,
        tenantId: raw[2] as string,
        actor: raw[3] as string,
        aud: raw[4] as string,
        mth: raw[5] as 'GET' | 'HEAD',
        exp: raw[6] as number,
      };
    } catch {
      throw new TenantIsolationError(
        'signed URL payload is not decodable claim array',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_INVALID,
      );
    }
    // MAC FIRST: an attacker cannot learn which claim failed.
    const expectedMac = hmac(this.pepper, payloadPart);
    if (!digestsEqual(expectedMac, Buffer.from(macPart, 'base64url'))) {
      throw new TenantIsolationError(
        'signed URL MAC verification failed',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_INVALID,
      );
    }
    if (claims.exp <= this.clock()) {
      throw new TenantIsolationError(
        'signed URL expired',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_EXPIRED,
      );
    }
    if (claims.aud !== input.audience) {
      throw new TenantIsolationError(
        'signed URL audience mismatch',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_INVALID,
      );
    }
    if (input.expectedTenantId !== undefined && claims.tenantId !== input.expectedTenantId) {
      throw new TenantIsolationError(
        'signed URL tenant mismatch',
        {},
        SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
      );
    }
    if (input.expectedUri !== undefined && claims.uri !== input.expectedUri) {
      throw new TenantIsolationError(
        'signed URL resource mismatch',
        {},
        SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
      );
    }
    if (input.method !== undefined && claims.mth !== input.method) {
      throw new TenantIsolationError(
        'signed URL method mismatch',
        {},
        SecErrorCode.SEC_TENANT_SIGNED_URL_INVALID,
      );
    }
    return { valid: true, claims };
  }
}
