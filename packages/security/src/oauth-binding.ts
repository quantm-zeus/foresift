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
import {
  numericFilter,
  numericIncludes,
  numericJoin,
  numericMap,
  numericSome,
  snapshotCallerInput,
} from './shadow-safe.ts';

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
  validateTokenBinding(rawInput: BindingValidationInput): OAuthTokenBinding {
    // Single-read binding (V7 accessor class): the candidate, the registered
    // redirect/scope sets and the expected audience/resource must each be
    // materialized once so a getter/Proxy cannot satisfy a check and then swap
    // the value that gets returned.
    const input = snapshotCallerInput(rawInput);
    const parsed = OAuthTokenBindingSchema.safeParse(input.candidate);
    if (!parsed.success) {
      // A missing/false pkceRequired is the load-bearing structural refusal.
      const pkceFailure = numericSome(
        parsed.error.issues,
        (issue) => numericJoin(issue.path, '.') === 'pkceRequired',
      );
      if (pkceFailure) {
        throw new OAuthBindingError(
          'PKCE is required for every MCP OAuth grant',
          {},
          SecErrorCode.SEC_OAUTH_PKCE_REQUIRED,
        );
      }
      throw new OAuthBindingError('token binding fails the authoritative schema', {
        issues: numericJoin(
          numericMap(parsed.error.issues, (i) => `${numericJoin(i.path, '.')}: ${i.message}`),
          '; ',
        ),
      });
    }
    const binding = parsed.data;

    if (!numericIncludes(input.registeredRedirectUris, binding.redirectUri)) {
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
    // comparisons are false, so finiteness is checked explicitly. The injected
    // clock is bound once and must itself be a finite instant.
    const expiresMs = Date.parse(binding.expiresAt);
    const nowMs = this.clock();
    if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      throw new OAuthBindingError(
        'token binding has expired',
        { expiresAt: binding.expiresAt },
        SecErrorCode.SEC_OAUTH_TOKEN_EXPIRED,
      );
    }
    const widened = numericFilter(
      binding.scopes,
      (s) => !numericIncludes(input.registeredScopes, s),
    );
    if (widened.length > 0) {
      throw new OAuthBindingError(
        'issued scopes widen beyond the registered set',
        { widened: numericJoin(widened) },
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
  refuseUpstreamPassthrough(rawPresentation: {
    readonly isUpstreamIssued?: boolean | undefined;
    readonly upstreamIssuer?: string | undefined;
    /** The issuer claimed for the presented token (from its metadata). */
    readonly claimedIssuer?: string | undefined;
    /** The ONLY issuer this deployment accepts as local. */
    readonly expectedLocalIssuer: string;
  }): void {
    // Single-read binding (V7 accessor class): the refusal checks and the
    // diagnostic must observe the same presentation.
    const presentation = snapshotCallerInput(rawPresentation);
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
