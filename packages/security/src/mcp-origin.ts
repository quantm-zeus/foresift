/**
 * MCP transport Origin decision engine (FR-SEC-001, ADR-055; AC-250).
 *
 * Exact-match allowlisting with hygiene checks that run BEFORE any
 * allowlist consultation: punycode-confused names, trailing dots,
 * mixed schemes, userinfo, and wrong ports/hosts are refused with typed
 * verdicts so later transport wiring can turn them straight into HTTP 403
 * responses before session/tool/resource processing begins (plan material
 * decision 4). Absent-Origin behavior is configurable per deployment mode:
 * production refuses; non-production may allow loopback tooling.
 */
import { OriginVerdictSchema, type OriginVerdict } from '@foresift/shared-schemas';
import { McpOriginError } from './errors.ts';

export type OriginRefusalReason = Extract<OriginVerdict, { decision: 'REFUSE' }>['reason'];

export interface McpOriginGateOptions {
  /** Exact origins admitted to reach authentication, e.g. https://mcp.example.com. */
  readonly allowlist: readonly string[];
  /**
   * Deployment mode for ABSENT Origin headers: 'PRODUCTION' always refuses;
   * 'NON_PRODUCTION' allows the request through to authentication.
   */
  readonly absentOriginPolicy: 'PRODUCTION' | 'NON_PRODUCTION';
}

interface ParsedOrigin {
  scheme: string;
  host: string; // lower-cased, trailing dot stripped NOT applied — hygiene runs first
  explicitPort: string | undefined;
  defaultPort: string;
}

function parseOrigin(origin: string): ParsedOrigin | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null;
  }
  const defaultPort = url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '';
  return {
    scheme: url.protocol.replace(':', ''),
    host: url.hostname.toLowerCase(),
    explicitPort: url.port === '' ? undefined : url.port,
    defaultPort,
  };
}

function effectivePort(parsed: ParsedOrigin): string {
  return parsed.explicitPort ?? parsed.defaultPort;
}

export class McpOriginGate {
  private readonly allowlist: readonly ParsedOrigin[];
  private readonly absentOriginPolicy: 'PRODUCTION' | 'NON_PRODUCTION';

  constructor(options: McpOriginGateOptions) {
    this.absentOriginPolicy = options.absentOriginPolicy;
    this.allowlist = options.allowlist.map((entry) => {
      const parsed = parseOrigin(entry);
      if (parsed === null) {
        throw new McpOriginError('allowlist entry is not a valid bare origin', { entry });
      }
      return parsed;
    });
  }

  /** Decide WITHOUT side effects; verdict is schema-shaped for transport reuse. */
  decide(origin: string | undefined): OriginVerdict {
    if (origin === undefined || origin === '') {
      if (this.absentOriginPolicy === 'PRODUCTION') {
        return OriginVerdictSchema.parse({
          decision: 'REFUSE',
          origin: null,
          reason: 'ABSENT_POLICY_REFUSES',
        });
      }
      // Non-production deployments may let loopback tooling through without
      // an Origin header; the schema needs a non-empty marker for logging.
      return OriginVerdictSchema.parse({ decision: 'ALLOW', origin: '(absent)' });
    }

    const refuse = (reason: OriginRefusalReason): OriginVerdict =>
      OriginVerdictSchema.parse({ decision: 'REFUSE', origin, reason });

    const parsed = parseOrigin(origin);
    if (parsed === null) return refuse('MALFORMED');

    // Hygiene FIRST — a hostile-but-allowlist-shaped origin never reaches
    // authentication processing.
    if (!['http', 'https'].includes(parsed.scheme)) {
      return refuse('MIXED_SCHEME');
    }
    // A hostname ending in '.' resolves identically but evades naive
    // exact-match comparisons.
    if (/\.$/.test(parsed.host)) return refuse('TRAILING_DOT');
    // Punycode (or raw non-ASCII) can visually impersonate an allowlisted host.
    if (/^xn--/.test(parsed.host) || parsed.host.split('.').some((l) => /^xn--/.test(l))) {
      return refuse('PUNYCODE_CONFUSED');
    }
    if (/[^\x00-\x7F]/.test(parsed.host)) return refuse('PUNYCODE_CONFUSED');

    // Exact-match consultation on the normalized tuple; near-misses get
    // precise typed verdicts so operators can see WHY a lookalike failed.
    // WRONG_HOST means the host shares the allowlisted registrable domain
    // (lookalike/subdomain confusion); fully unrelated hosts are simply
    // NOT_ALLOWLISTED.
    const requestedLabels = parsed.host.split('.');
    let wrongPortSeen = false;
    let wrongHostSeen = false;
    let mixedSchemeSeen = false;
    for (const allowed of this.allowlist) {
      const portMatches = effectivePort(allowed) === effectivePort(parsed);
      if (allowed.host === parsed.host) {
        if (allowed.scheme !== parsed.scheme) {
          mixedSchemeSeen = true;
          continue;
        }
        if (!portMatches) {
          wrongPortSeen = true;
          continue;
        }
        return OriginVerdictSchema.parse({ decision: 'ALLOW', origin });
      }
      const allowedLabels = allowed.host.split('.');
      const sameRegistrableDomain =
        allowedLabels.slice(-2).join('.') === requestedLabels.slice(-2).join('.') &&
        allowedLabels.length >= 2 &&
        requestedLabels.length >= 2;
      if (allowed.scheme === parsed.scheme && portMatches && sameRegistrableDomain) {
        wrongHostSeen = true;
      }
    }
    if (wrongPortSeen) return refuse('WRONG_PORT');
    if (mixedSchemeSeen) return refuse('MIXED_SCHEME');
    if (wrongHostSeen) return refuse('WRONG_HOST');
    return refuse('NOT_ALLOWLISTED');
  }

  /** Fail-closed convenience for transport wiring: raise instead of branching. */
  requireAllowed(origin: string | undefined): void {
    const verdict = this.decide(origin);
    if (verdict.decision !== 'ALLOW') {
      throw new McpOriginError(`origin refused (${verdict.reason})`, {
        reason: verdict.reason,
      });
    }
  }
}
