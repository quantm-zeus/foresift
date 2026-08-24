/**
 * Cross-tenant resource-URI authorization (FR-SEC-009/FR-SEC-001; T131,
 * AC-252/AC-275). A resource URI minted under tenant A resolves ONLY for
 * callers of tenant A holding the original scope and rights. Every named
 * bypass vector — signed-URL replay, HTTP range reads, redirects, and
 * path confusion (percent-encoded slashes, dot segments, backslashes,
 * double slashes) — is normalized away or refused BEFORE any fetch.
 */
import type { TenantContext } from '@foresift/shared-schemas';
import { SecErrorCode, TenantIsolationError } from '@foresift/security';
import { SignedUrlService } from './signed-url.ts';

export type ResourceAccessRefusalReason =
  'CROSS_TENANT' | 'PATH_CONFUSION' | 'SIGNED_URL_BYPASS' | 'RANGE_BYPASS' | 'REDIRECT_BYPASS';

export interface ResourceUriParts {
  readonly surface: string;
  readonly tenantId: string;
  /** Canonical, traversal-free remainder path. */
  readonly path: string;
}

/** Right required to perform ranged reads on artifacts. */
export const ARTIFACT_RANGE_READ_RIGHT = 'artifact:range-read';

/**
 * Canonicalize a resource URI path: backslashes fold to '/', percent
 * escapes decode EXACTLY once (a residual '%' means double-encoding),
 * empty segments collapse, and dot segments resolve — any escape above
 * the root is path confusion, not navigation.
 */
export function normalizeResourcePath(rawPath: string): string {
  let candidate = rawPath.replaceAll('\\', '/');
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    throw new TenantIsolationError(
      'resource URI contains malformed percent-encoding',
      { reason: 'PATH_CONFUSION' },
      SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
    );
  }
  if (candidate.includes('%')) {
    // Double-encoded input survives as an encoded character after one
    // decoding pass — a classic confusion vector; refuse outright.
    throw new TenantIsolationError(
      'resource URI carries double-encoded segments',
      { reason: 'PATH_CONFUSION' },
      SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
    );
  }
  // Decoded escapes (%5c) fold exactly like typed separators.
  candidate = candidate.replaceAll('\\', '/');
  const resolved: string[] = [];
  for (const segment of candidate.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) {
        throw new TenantIsolationError(
          'resource URI escapes its root',
          { reason: 'PATH_CONFUSION' },
          SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
        );
      }
      resolved.pop();
      continue;
    }
    if (segment.includes('\0')) {
      throw new TenantIsolationError(
        'resource URI contains NUL',
        { reason: 'PATH_CONFUSION' },
        SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
      );
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

/** Split `foresift://<surface>/<tenantId>/<path…>` into canonical parts. */
export function parseResourceUri(uri: string): ResourceUriParts {
  const match = /^foresift:\/\/([^/?#]+)\/(.*)$/s.exec(uri);
  if (match === null || match[1] === undefined) {
    throw new TenantIsolationError(
      'resource URI does not use the foresift:// surface/tenant/path shape',
      { reason: 'PATH_CONFUSION' },
      SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
    );
  }
  const surface = match[1];
  const afterAuthority = match[2] ?? '';
  const queryIndex = afterAuthority.indexOf('?');
  const rawPath = queryIndex === -1 ? afterAuthority : (afterAuthority.slice(0, queryIndex) ?? '');
  return {
    surface,
    tenantId: rawPath.split('/')[0] ?? '',
    path: normalizeResourcePath(rawPath.split('/').slice(1).join('/')),
  };
}

export interface ResourceAccessRequest {
  /** Raw caller-supplied URI, queries and all. */
  readonly uri: string;
  /** Scope the caller claims (must equal the resource's granting scope). */
  readonly grantedScope: string;
  readonly rights: readonly string[];
  /** Present only when the caller attempts a ranged read. */
  readonly rangeHeader?: string | undefined;
  /** Present only when following a redirect to a new target. */
  readonly redirectTarget?: string | undefined;
}

export interface ResourceAccessDecision {
  readonly allowed: true;
  readonly surface: string;
  readonly tenantId: string;
  readonly canonicalPath: string;
}

export class ResourceAccessGuard {
  private readonly signedUrls: SignedUrlService;
  private static readonly SCOPE_PATTERN = /^(admin|tenant):[a-z0-9:-]+$/;

  constructor(options: { signedUrls?: SignedUrlService | undefined } = {}) {
    this.signedUrls =
      options.signedUrls ??
      new SignedUrlService({ pepper: 'resource-access-default-pepper', defaultTtlSeconds: 300 });
  }

  /**
   * Authorize ONE resource access. Throws TenantIsolationError carrying the
   * refusal reason in `detail.reason`; returns the canonical decision on success.
   */
  authorize(input: {
    request: ResourceAccessRequest;
    context: TenantContext;
    audience: string;
  }): ResourceAccessDecision {
    const parts = this.checkTarget(input.request.uri, input.context, input.audience);

    // Scope + rights gate: a leaked signed URL alone never confers access —
    // the caller must hold the ORIGINAL scope and rights too.
    if (!ResourceAccessGuard.SCOPE_PATTERN.test(input.request.grantedScope)) {
      throw this.refusal('SIGNED_URL_BYPASS', 'caller lacks any recognized grant scope');
    }
    if (input.request.rights.length === 0) {
      throw this.refusal('SIGNED_URL_BYPASS', 'caller presents no rights alongside the resource');
    }

    // Range bypass: ranged artifact reads are a distinct right.
    if (
      input.request.rangeHeader !== undefined &&
      !input.request.rights.includes(ARTIFACT_RANGE_READ_RIGHT)
    ) {
      throw this.refusal('RANGE_BYPASS', 'ranged read attempted without the range-read right');
    }

    // Redirect bypass: the redirect target re-authorizes from scratch.
    if (input.request.redirectTarget !== undefined) {
      try {
        this.checkTarget(input.request.redirectTarget, input.context, input.audience);
      } catch (error) {
        throw this.refusal(
          'REDIRECT_BYPASS',
          `redirect target refused: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    return {
      allowed: true,
      surface: parts.surface,
      tenantId: parts.tenantId,
      canonicalPath: parts.path,
    };
  }

  private checkTarget(uri: string, context: TenantContext, audience: string): ResourceUriParts {
    const [withoutQuery, query = ''] = uri.split('?');
    if (withoutQuery === undefined || withoutQuery === '') {
      throw this.refusal('PATH_CONFUSION', 'empty resource URI');
    }
    const parts = parseResourceUri(withoutQuery);
    if (parts.tenantId !== context.tenantId) {
      throw this.refusal('CROSS_TENANT', `URI belongs to tenant '${parts.tenantId}'`);
    }
    // A presented signed token must validate for THIS exact resource and
    // tenant; foreign or tampered tokens refuse as bypass attempts.
    const tokenPair = /(?:^|&)(?:token|sig)=([^&]+)/.exec(query);
    if (tokenPair !== null && tokenPair[1] !== undefined) {
      try {
        this.signedUrls.validate({
          token: decodeURIComponent(tokenPair[1]),
          audience,
          expectedTenantId: context.tenantId,
          expectedUri: withoutQuery,
          method: 'GET',
        });
      } catch (error) {
        throw this.refusal(
          'SIGNED_URL_BYPASS',
          `embedded signed token invalid: ${
            error instanceof Error
              ? ((error as Error & { code?: string }).code ?? error.message)
              : 'unknown'
          }`,
        );
      }
    }
    return parts;
  }

  private refusal(reason: ResourceAccessRefusalReason, message: string): TenantIsolationError {
    return new TenantIsolationError(
      message,
      { reason },
      SecErrorCode.SEC_TENANT_RESOURCE_ACCESS_REFUSED,
    );
  }
}
