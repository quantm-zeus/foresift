/**
 * OAuth token-binding guard (FR-SEC-001, ADR-055; AC-253).
 *
 * Enforces the binding dimensions the PRD names for every OAuth grant used
 * by MCP credentials:
 *
 *   - PKCE is REQUIRED (schema-level `pkceRequired: true` and re-checked);
 *   - redirect URIs match EXACTLY — no normalization, no prefix/suffix
 *     leniency that open-redirect tricks exploit;
 *   - audience AND RFC 8707 resource-indicator binding must equal what this
 *     deployment expects;
 *   - expiry against an injected clock;
 *   - issued scopes must NARROW (⊆) the registered scope set;
 *   - upstream provider tokens are NEVER accepted as passthrough
 *     credentials for this system's own surface.
 */
import { OAuthTokenBindingSchema, type OAuthTokenBinding } from '@foresift/shared-schemas';
import { OAuthBindingError, SecErrorCode } from './errors.ts';

/** Injected clock seam returning epoch milliseconds. */
export type OAuthClock = () => number;

export interface BindingValidationInput {
  readonly candidate: unknown;
  /** The exact redirect URI(s) registered for this client. */
  readonly registeredRedirectUris: readonly string[];
  /** Scope ceiling the client may operate within; issued scopes ⊆ this. */
  readonly registeredScopes: readonly string[];
  readonly expectedAudience: string;
  readonly expectedResourceIndicator: string;
}

export class OAuthBindingGuard {
  private readonly clock: OAuthClock;

  constructor(clock: OAuthClock = () => Date.now()) {
    this.clock = clock;
  }

  /**
   * Structural parse + every binding dimension. Returns the parsed binding
   * on success; raises typed OAuthBindingError otherwise.
   */
  validateTokenBinding(input: BindingValidationInput): OAuthTokenBinding {
    const parsed = OAuthTokenBindingSchema.safeParse(input.candidate);
    if (!parsed.success) {
      // A missing/false pkceRequired is the load-bearing structural refusal.
      const pkceFailure = parsed.error.issues.some(
        (issue) => issue.path.join('.') === 'pkceRequired',
      );
      if (pkceFailure) {
        throw new OAuthBindingError(
          'PKCE is required for every MCP OAuth grant',
          {},
          SecErrorCode.SEC_OAUTH_PKCE_REQUIRED,
        );
      }
      throw new OAuthBindingError('token binding fails the authoritative schema', {
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    const binding = parsed.data;

    if (!input.registeredRedirectUris.includes(binding.redirectUri)) {
      throw new OAuthBindingError(
        'redirect URI does not EXACTLY match a registered value',
        { redirectUri: binding.redirectUri },
        SecErrorCode.SEC_OAUTH_REDIRECT_URI_MISMATCH,
      );
    }
    if (binding.audience !== input.expectedAudience) {
      throw new OAuthBindingError(
        'token audience is not bound to this deployment',
        { audience: binding.audience, expected: input.expectedAudience },
        SecErrorCode.SEC_OAUTH_AUDIENCE_MISMATCH,
      );
    }
    if (binding.resourceIndicator !== input.expectedResourceIndicator) {
      throw new OAuthBindingError(
        'resource indicator (RFC 8707) is not bound to this deployment',
        { resourceIndicator: binding.resourceIndicator },
        SecErrorCode.SEC_OAUTH_AUDIENCE_MISMATCH,
      );
    }
    // A non-parseable instant must not pass as "never expires" — NaN
    // comparisons are false, so finiteness is checked explicitly.
    const expiresMs = Date.parse(binding.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= this.clock()) {
      throw new OAuthBindingError(
        'token binding has expired',
        { expiresAt: binding.expiresAt },
        SecErrorCode.SEC_OAUTH_TOKEN_EXPIRED,
      );
    }
    const widened = binding.scopes.filter((s) => !input.registeredScopes.includes(s));
    if (widened.length > 0) {
      throw new OAuthBindingError(
        'issued scopes widen beyond the registered set',
        { widened: widened.join(',') },
        SecErrorCode.SEC_OAUTH_SCOPE_WIDENED,
      );
    }
    return binding;
  }

  /**
   * Upstream-token passthrough refusal: a token minted by an upstream
   * provider (Anthropic/Slack/GitHub …) must never be presented as THIS
   * system's own MCP credential.
   *
   * Fail-closed (M7): positive evidence of LOCAL issuance is REQUIRED. A
   * presentation carrying no issuer evidence at all is refused — absence of
   * proof of upstream issuance is not proof of local issuance.
   */
  refuseUpstreamPassthrough(presentation: {
    readonly isUpstreamIssued?: boolean | undefined;
    readonly upstreamIssuer?: string | undefined;
    /** The issuer claimed for the presented token (from its metadata). */
    readonly claimedIssuer?: string | undefined;
    /** The ONLY issuer this deployment accepts as local. */
    readonly expectedLocalIssuer: string;
  }): void {
    const claimed = presentation.claimedIssuer?.trim() ?? '';
    if (
      presentation.isUpstreamIssued === true ||
      (presentation.upstreamIssuer !== undefined && presentation.upstreamIssuer !== '') ||
      claimed === '' ||
      claimed !== presentation.expectedLocalIssuer
    ) {
      throw new OAuthBindingError(
        'upstream provider tokens are refused as MCP credential material',
        { upstreamIssuer: presentation.upstreamIssuer ?? 'unknown' },
        SecErrorCode.SEC_OAUTH_UPSTREAM_PASSTHROUGH_REFUSED,
      );
    }
  }
}
