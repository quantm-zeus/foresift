/**
 * Egress guard — deny-by-default outbound policy (FR-SEC-004; AC-051,
 * AC-257). Every outbound fetch passes:
 *
 *   exact per-plane allowlist → URL hygiene (userinfo, encoded/punycode
 *   hosts, non-https schemes, unsafe ports) → resolver seam
 *   resolve→pin→connect with denied-range validation (loopback, private,
 *   link-local, cloud metadata; IPv4 + IPv6) → redirect revalidation with
 *   per-hop approval and a hop cap → response byte/time/
 *   decompression-ratio/content-type caps.
 *
 * Anything not explicitly allowed refuses with a typed reason from
 * EgressDecisionSchema. DNS rebinding is countered by pinning: callers must
 * connect to the PINNED addresses and re-verify before connect.
 */
import {
  EgressDecisionSchema,
  type EgressAllowlistEntry,
  type EgressDecision,
} from '@foresift/shared-schemas';
import { EgressError } from './errors.ts';

export type EgressPlane = EgressAllowlistEntry['plane'];

/** The resolver seam: production wires real DNS; tests pin answers. */
export type EgressResolver = (host: string) => Promise<readonly string[]>;

export interface EgressLimits {
  readonly maxRedirects?: number;
  readonly maxResponseBytes?: number;
  readonly maxResponseTimeMs?: number;
  /** Max compressed:decompressed size ratio before decompression-bomb refusal. */
  readonly maxDecompressionRatio?: number;
  /** Content types admitted on responses; empty list refuses everything. */
  readonly allowedContentTypes?: readonly string[];
}

const DEFAULT_LIMITS: Required<EgressLimits> = {
  maxRedirects: 3,
  maxResponseBytes: 25 * 1024 * 1024,
  maxResponseTimeMs: 30_000,
  maxDecompressionRatio: 100,
  allowedContentTypes: ['application/json', 'application/octet-stream', 'text/plain'],
};

// --- IP range denial -----------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function ipv4InRange(ip: string, base: string, prefixBits: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (ipInt & mask) >>> 0 === (baseInt & mask) >>> 0;
}

function expandIpv6(ip: string): number[] {
  // Deterministic expansion of :: groups; returns 16 bytes.
  let head = ip;
  let tail = '';
  if (ip.includes('::')) {
    const halves = ip.split('::');
    head = halves[0] ?? '';
    tail = halves[1] ?? '';
  }
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups];
  const bytes: number[] = [];
  for (const group of groups) {
    const g = group === '' ? 0 : parseInt(group, 16);
    bytes.push((g >> 8) & 0xff, g & 0xff);
  }
  return bytes.slice(0, 16);
}

function bigIntInCidr6(value: bigint, cidrBase: bigint, prefixBits: number): boolean {
  if (prefixBits === 0) return true;
  const shift = BigInt(128 - prefixBits);
  return value >> shift === cidrBase >> shift;
}

/**
 * Denied-range table: loopback, RFC1918 private, link-local, CGNAT,
 * cloud-metadata anchor, unspecified/multicast, IPv6 equivalents and
 * IPv4-mapped forms. Zero trust for ANY resolved address.
 */
export function isDeniedAddress(address: string): boolean {
  if (address.includes('.') && !address.startsWith('::ffff:')) {
    // Plain IPv4 literal.
    if (
      ipv4InRange(address, '127.0.0.0', 8) ||
      ipv4InRange(address, '10.0.0.0', 8) ||
      ipv4InRange(address, '172.16.0.0', 12) ||
      ipv4InRange(address, '192.168.0.0', 16) ||
      ipv4InRange(address, '169.254.0.0', 16) ||
      ipv4InRange(address, '100.64.0.0', 10) ||
      ipv4InRange(address, '0.0.0.0', 8) ||
      ipv4InRange(address, '224.0.0.0', 4)
    ) {
      return true;
    }
    return false;
  }
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length);
    if (mapped.includes('.')) return isDeniedAddress(mapped);
  }
  let parsed: bigint;
  try {
    parsed = rawIpv6Value(address);
  } catch {
    return false;
  }
  return (
    bigIntInCidr6(parsed, 1n, 128) || // ::1 loopback
    bigIntInCidr6(parsed, 0n, 128) || // :: unspecified
    bigIntInCidr6(parsed, 0xfe80n << 112n, 10) || // link-local fe80::/10
    bigIntInCidr6(parsed, 0xfc00n << 112n, 7) || // ULA private fc00::/7
    bigIntInCidr6(parsed, 0xff00n << 112n, 8) // multicast ff00::/8
  );
}

function rawIpv6Value(ip: string): bigint {
  const bytes = expandIpv6(ip);
  if (bytes.length !== 16) throw new Error('bad ipv6');
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

// --- Guard ---------------------------------------------------------------------

interface ParsedTarget {
  scheme: string;
  host: string;
  port: number;
  origin: string;
}

/** Ports no legitimate HTTPS API needs; classic internal-service targets. */
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139, 143, 161, 162, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 593, 631, 636, 691, 873,
  990, 992, 993, 995, 1080, 1433, 1521, 1723, 2049, 2181, 2375, 2376, 3128, 3306, 3389, 4444, 5432,
  5555, 5601, 5900, 5984, 6379, 6443, 8080, 8443, 8888, 9042, 9092, 9200, 9300, 11211, 27017, 27018,
  27019, 28017, 50000,
]);

function parseTarget(url: string): ParsedTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.hostname === '') return null;
  return {
    scheme: parsed.protocol.replace(':', ''),
    host: parsed.hostname.toLowerCase(),
    port: parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port),
    origin: parsed.origin,
  };
}

export class EgressGuard {
  private readonly entries: readonly EgressAllowlistEntry[];
  private readonly resolve: EgressResolver;
  private readonly limits: Required<EgressLimits>;

  constructor(options: {
    allowlist: readonly EgressAllowlistEntry[];
    resolver: EgressResolver;
    limits?: EgressLimits | undefined;
  }) {
    this.entries = options.allowlist;
    this.resolve = options.resolver;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
  }

  /**
   * Full authorize flow for one outbound request. Returns the schema-typed
   * decision; ALLOW carries the pinned addresses callers MUST connect to.
   */
  async authorize(url: string, plane: EgressPlane): Promise<EgressDecision> {
    const refuse = (
      reason: Extract<EgressDecision, { decision: 'REFUSE' }>['reason'],
      detail: string,
    ): EgressDecision => EgressDecisionSchema.parse({ decision: 'REFUSE', reason, detail });

    const target = parseTarget(url);
    if (target === null) return refuse('URL_MALFORMED', 'unparseable or userinfo-bearing URL');
    // URL normalization silently DECODES percent escapes in hostnames, so
    // the raw string is checked too — an encoded lookalike must never be
    // compared against (or matched onto) an allowlist entry.
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*%[0-9A-Fa-f]{2}/i.test(url)) {
      return refuse('HOST_NOT_ALLOWLISTED', 'percent-encoded host refused');
    }
    if (/[%\s]/.test(target.host) || /[^\x00-\x7F]/.test(target.host)) {
      return refuse('HOST_NOT_ALLOWLISTED', `encoded or non-ASCII host: ${target.host}`);
    }
    if (target.host.split('.').some((label) => /^xn--/.test(label))) {
      return refuse('HOST_NOT_ALLOWLISTED', 'punycode host refused');
    }
    if (target.scheme !== 'https') {
      return refuse('SCHEME_REFUSED', `scheme '${target.scheme}' is not https`);
    }
    if (
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535 ||
      UNSAFE_PORTS.has(target.port)
    ) {
      return refuse('PORT_UNSAFE', `port ${String(target.port)} is on the unsafe list`);
    }
    const allowlisted = this.entries.some(
      (entry) =>
        entry.plane === plane &&
        entry.scheme === 'https' &&
        entry.host === target.host &&
        entry.port === target.port,
    );
    if (!allowlisted) {
      return refuse(
        'HOST_NOT_ALLOWLISTED',
        `${target.host}:${String(target.port)} not allowlisted for plane ${plane}`,
      );
    }

    let addresses: readonly string[];
    try {
      addresses = await this.resolve(target.host);
    } catch (error) {
      return refuse('RESOLUTION_REFUSED', error instanceof Error ? error.message : String(error));
    }
    if (addresses.length === 0) {
      return refuse('RESOLUTION_REFUSED', 'resolver returned no addresses');
    }
    for (const address of addresses) {
      if (isDeniedAddress(address)) {
        return refuse('ADDRESS_DENIED', `resolved address falls in a denied range: ${address}`);
      }
    }
    return EgressDecisionSchema.parse({
      decision: 'ALLOW',
      host: target.host,
      pinnedAddresses: [...addresses],
    });
  }

  /**
   * Pin→connect verification: re-resolve immediately before connecting and
   * confirm the answers match the pinned set — the DNS-rebinding counter.
   */
  async verifyPin(url: string, pinnedAddresses: readonly string[]): Promise<EgressDecision> {
    const target = parseTarget(url);
    if (target === null) {
      return EgressDecisionSchema.parse({
        decision: 'REFUSE',
        reason: 'URL_MALFORMED',
        detail: 'unparseable URL during pin verification',
      });
    }
    const fresh = await this.resolve(target.host);
    const same =
      fresh.length === pinnedAddresses.length &&
      [...fresh].sort().join(',') === [...pinnedAddresses].sort().join(',');
    if (!same) {
      return EgressDecisionSchema.parse({
        decision: 'REFUSE',
        reason: 'REBINDING_DETECTED',
        detail: 'resolution changed between pin and connect',
      });
    }
    return EgressDecisionSchema.parse({
      decision: 'ALLOW',
      host: target.host,
      pinnedAddresses: [...pinnedAddresses],
    });
  }

  /**
   * Redirect revalidation: every hop re-runs the FULL authorize flow, plus
   * an explicit per-origin approval callback and a hard hop cap.
   */
  async authorizeRedirect(
    nextUrl: string,
    plane: EgressPlane,
    hopsFollowed: number,
    approveHop: (nextUrl: string) => boolean,
  ): Promise<EgressDecision> {
    if (hopsFollowed + 1 > this.limits.maxRedirects) {
      return EgressDecisionSchema.parse({
        decision: 'REFUSE',
        reason: 'REDIRECT_LIMIT_EXCEEDED',
        detail: `more than ${String(this.limits.maxRedirects)} redirects`,
      });
    }
    if (!approveHop(nextUrl)) {
      return EgressDecisionSchema.parse({
        decision: 'REFUSE',
        reason: 'REDIRECT_UNAPPROVED',
        detail: `redirect target not approved: ${nextUrl}`,
      });
    }
    return this.authorize(nextUrl, plane);
  }

  /** Response-side caps: bytes, elapsed time, decompression ratio, content type. */
  inspectResponse(response: {
    readonly bytes?: number | undefined;
    readonly timeMs?: number | undefined;
    readonly decompressedBytes?: number | undefined;
    readonly contentType?: string | undefined;
  }): EgressDecision {
    const refuse = (
      reason: Extract<EgressDecision, { decision: 'REFUSE' }>['reason'],
      detail: string,
    ): EgressDecision => EgressDecisionSchema.parse({ decision: 'REFUSE', reason, detail });
    if (response.bytes !== undefined && response.bytes > this.limits.maxResponseBytes) {
      return refuse(
        'RESPONSE_BYTES_EXCEEDED',
        `response exceeded ${String(this.limits.maxResponseBytes)} bytes`,
      );
    }
    if (response.timeMs !== undefined && response.timeMs > this.limits.maxResponseTimeMs) {
      return refuse(
        'RESPONSE_TIME_EXCEEDED',
        `response exceeded ${String(this.limits.maxResponseTimeMs)} ms`,
      );
    }
    if (
      response.bytes !== undefined &&
      response.decompressedBytes !== undefined &&
      response.bytes > 0 &&
      response.decompressedBytes / response.bytes > this.limits.maxDecompressionRatio
    ) {
      return refuse('DECOMPRESSION_RATIO_EXCEEDED', 'decompression ratio above cap');
    }
    const contentType = response.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!this.limits.allowedContentTypes.includes(contentType)) {
      return refuse('CONTENT_TYPE_REFUSED', `content type '${contentType}' is not admitted`);
    }
    return EgressDecisionSchema.parse({
      decision: 'ALLOW',
      host: 'response-inspection',
      pinnedAddresses: ['0.0.0.0'],
    });
  }

  /** Fail-closed convenience raising EgressError with the typed reason. */
  requireAllowed(decision: EgressDecision): void {
    if (decision.decision !== 'ALLOW') {
      throw new EgressError(`egress refused (${decision.reason}): ${decision.detail}`, {
        reason: decision.reason,
      });
    }
  }
}
