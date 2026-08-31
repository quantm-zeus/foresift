import { McpOriginGate } from '@foresift/security';
import type { OriginVerdict } from '@foresift/shared-schemas';

export interface OriginCredentialPolicy {
  readonly registeredNonBrowserClient: boolean;
  readonly allowAbsentOrigin: boolean;
}

export interface OriginWiringOptions {
  readonly productionAllowlist: readonly string[];
  readonly localAllowlist?: readonly string[];
  readonly localMode?: boolean;
  readonly trustedProxyAddresses?: readonly string[];
}

export interface OriginRequest {
  readonly origin?: string;
  readonly remoteAddress?: string;
  readonly forwardedOrigin?: string;
  readonly credentialPolicy?: OriginCredentialPolicy;
}

export type OriginAdmission =
  | { readonly allowed: true; readonly origin: string; readonly verdict: OriginVerdict }
  | {
      readonly allowed: false;
      readonly status: 403;
      readonly code: 'ORIGIN_NOT_ALLOWLISTED';
      readonly reason: string;
      readonly verdict: OriginVerdict;
    };

function canonicalOrigin(origin: string): string {
  return new URL(origin).origin;
}

export class McpOriginWiring {
  private readonly productionGate: McpOriginGate;
  private readonly localGate: McpOriginGate;
  private readonly trustedProxies: ReadonlySet<string>;
  private readonly localMode: boolean;

  constructor(options: OriginWiringOptions) {
    if (
      options.localMode === true &&
      (options.localAllowlist ?? []).some((origin) => {
        const host = new URL(origin).hostname;
        return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1';
      })
    ) {
      throw new Error('local MCP origins must use a loopback host');
    }
    this.productionGate = new McpOriginGate({
      allowlist: options.productionAllowlist,
      absentOriginPolicy: 'PRODUCTION',
    });
    this.localGate = new McpOriginGate({
      allowlist: options.localAllowlist ?? [],
      absentOriginPolicy: 'NON_PRODUCTION',
    });
    this.trustedProxies = new Set(options.trustedProxyAddresses ?? []);
    this.localMode = options.localMode ?? false;
  }

  decide(request: OriginRequest): OriginAdmission {
    const forwardedTrusted =
      request.forwardedOrigin !== undefined &&
      request.remoteAddress !== undefined &&
      this.trustedProxies.has(request.remoteAddress);
    const presented = forwardedTrusted ? request.forwardedOrigin : request.origin;

    if (
      this.localMode &&
      request.remoteAddress !== undefined &&
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.remoteAddress)
    ) {
      return this.refusal(this.localGate.decide('local-mode-non-loopback'));
    }

    if (presented === 'null') return this.refusal(this.productionGate.decide('null'));
    if (presented === undefined || presented === '') {
      const policy = request.credentialPolicy;
      if (policy?.registeredNonBrowserClient === true && policy.allowAbsentOrigin === true) {
        return {
          allowed: true,
          origin: '(absent)',
          verdict: { decision: 'ALLOW', origin: '(absent)' },
        };
      }
    }

    const gate = this.localMode ? this.localGate : this.productionGate;
    const verdict = gate.decide(presented);
    if (verdict.decision !== 'ALLOW') return this.refusal(verdict);
    return {
      allowed: true,
      origin: presented === undefined || presented === '' ? '(absent)' : canonicalOrigin(presented),
      verdict,
    };
  }

  private refusal(verdict: OriginVerdict): Extract<OriginAdmission, { allowed: false }> {
    return {
      allowed: false,
      status: 403,
      code: 'ORIGIN_NOT_ALLOWLISTED',
      reason: verdict.decision === 'REFUSE' ? verdict.reason : 'NOT_ALLOWLISTED',
      verdict,
    };
  }
}

export function createOriginWiring(options: OriginWiringOptions): McpOriginWiring {
  return new McpOriginWiring(options);
}

/** HTTP middleware adapter around the normative wiring/gate composition. */
export function createMcpOriginMiddleware(options: {
  readonly allowlist: readonly string[];
  readonly localAllowlist?: readonly string[];
  readonly trustedProxies?: readonly string[];
  readonly absentOriginPolicy: 'PRODUCTION' | 'NON_PRODUCTION';
}) {
  const publicGate = new McpOriginGate({
    allowlist: options.allowlist,
    absentOriginPolicy: options.absentOriginPolicy,
  });
  const localGate = new McpOriginGate({
    allowlist: options.localAllowlist ?? options.allowlist,
    absentOriginPolicy: options.absentOriginPolicy,
  });
  const trusted = new Set(options.trustedProxies ?? []);
  return {
    evaluateOrigin(input: {
      readonly originHeader?: string;
      readonly clientRegisteredNonBrowser?: boolean;
      readonly isLoopback?: boolean;
      readonly isLoopbackRequest?: boolean;
    }): { readonly allowed: boolean; readonly httpStatus: 200 | 403; readonly reason?: string } {
      if (input.originHeader === undefined && input.clientRegisteredNonBrowser === true) {
        return { allowed: true, httpStatus: 200 };
      }
      const origin = input.originHeader;
      if (
        origin === '' ||
        origin === 'null' ||
        (origin !== undefined && (/[\r\n]/.test(origin) || origin.endsWith('/')))
      ) {
        return { allowed: false, httpStatus: 403, reason: 'MALFORMED' };
      }
      const looksLoopback =
        origin !== undefined && /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(origin);
      const loopbackRequest = input.isLoopbackRequest ?? input.isLoopback ?? false;
      if (looksLoopback && options.localAllowlist !== undefined && !loopbackRequest) {
        return { allowed: false, httpStatus: 403, reason: 'NOT_ALLOWLISTED' };
      }
      const verdict =
        looksLoopback && options.localAllowlist !== undefined
          ? localGate.decide(origin)
          : publicGate.decide(origin);
      return verdict.decision === 'ALLOW'
        ? { allowed: true, httpStatus: 200 }
        : { allowed: false, httpStatus: 403, reason: verdict.reason };
    },
    resolveClientOrigin(input: {
      readonly remoteIp: string;
      readonly headers: Readonly<Record<string, string | undefined>>;
    }) {
      const trustedProxy = trusted.has(input.remoteIp);
      return {
        trustedProxy,
        origin:
          trustedProxy &&
          input.headers['x-forwarded-proto'] !== undefined &&
          input.headers['x-forwarded-host'] !== undefined
            ? `${input.headers['x-forwarded-proto']}://${input.headers['x-forwarded-host']}`
            : undefined,
      };
    },
  };
}
