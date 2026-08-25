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
  // STRICT textual validation + deterministic expansion of :: groups;
  // returns exactly 16 bytes or throws. Leniency here would let malformed
  // spellings classify as addresses they are not.
  if ((ip.match(/::/g)?.length ?? 0) > 1) throw new Error('bad ipv6');
  const [head = '', tail = ''] = ip.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const missing = 8 - headGroups.length - tailGroups.length;
  if (ip.includes('::') ? missing < 1 : missing !== 0) throw new Error('bad ipv6');
  const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) throw new Error('bad ipv6');
    const g = parseInt(group, 16);
    bytes.push((g >> 8) & 0xff, g & 0xff);
  }
  return bytes;
}

function bigIntInCidr6(value: bigint, cidrBase: bigint, prefixBits: number): boolean {
  if (prefixBits === 0) return true;
  const shift = BigInt(128 - prefixBits);
  return value >> shift === cidrBase >> shift;
}

/** Render one 32-bit embedded IPv4 value as a dotted quad for reclassification. */
function embeddedIpv4ToQuad(value: bigint): string {
  return `${(value >> 24n) & 0xffn}.${(value >> 16n) & 0xffn}.${(value >> 8n) & 0xffn}.${
    value & 0xffn
  }`;
}

/**
 * Denied-range table: loopback, RFC1918 private, link-local, CGNAT,
 * cloud-metadata anchor, unspecified/multicast; IPv6 equivalents plus the
 * embedded-IPv4 transports (::ffff:0:0/96 mapped in ANY textual spelling,
 * 64:ff9b::/96 NAT64, 2002::/16 6to4) whose carried IPv4 address must clear
 * the same IPv4 rules. Zero trust for ANY resolved address: an address that
 * cannot be parsed and classified at all is DENIED — classification failure
 * never admits.
 */
export function isDeniedAddress(address: string): boolean {
  if (address.includes('.') && !address.startsWith('::')) {
    // Text carrying a dot but not a canonical dotted quad (decimal
    // '2130706433', hex/octal spellings, partial quads like '127.1') cannot
    // be classified — fail closed rather than guess.
    if (ipv4ToInt(address) === null) return true;
    return (
      ipv4InRange(address, '127.0.0.0', 8) ||
      ipv4InRange(address, '10.0.0.0', 8) ||
      ipv4InRange(address, '172.16.0.0', 12) ||
      ipv4InRange(address, '192.168.0.0', 16) ||
      ipv4InRange(address, '169.254.0.0', 16) ||
      ipv4InRange(address, '100.64.0.0', 10) ||
      ipv4InRange(address, '0.0.0.0', 8) ||
      ipv4InRange(address, '224.0.0.0', 4)
    );
  }
  // Dotted-quad tail spelling of an embedded-IPv4 form ('::ffff:a.b.c.d',
  // deprecated '::a.b.c.d'): classify the carried IPv4 directly.
  const dottedTail = /^::(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/i.exec(address);
  if (dottedTail?.[1] !== undefined) return isDeniedAddress(dottedTail[1]);
  let parsed: bigint;
  try {
    parsed = rawIpv6Value(address);
  } catch {
    // Unparseable resolved address (zone indices, truncated groups,
    // resolver garbage): NEVER admitted — fail closed.
    return true;
  }
  // Embedded-IPv4 transports: the low 32 bits name the real destination,
  // whatever the surrounding prefix's textual spelling. The /96 families are
  // matched CIDR-style over their top 96 bits (::ffff:0:0/96 mapped,
  // 64:ff9b::/96 NAT64 well-known prefix).
  const ipv4MappedBase = 0xffffn << 32n;
  const nat64Base = (0x64n << 112n) | (0xff9bn << 96n);
  if (bigIntInCidr6(parsed, ipv4MappedBase, 96) || bigIntInCidr6(parsed, nat64Base, 96)) {
    if (isDeniedAddress(embeddedIpv4ToQuad(parsed & 0xffffffffn))) return true;
  }
  if (parsed >> 112n === 0x2002n) {
    // 2002::/16 (6to4): the embedded IPv4 sits at bits 16..47.
    if (isDeniedAddress(embeddedIpv4ToQuad((parsed >> 80n) & 0xffffffffn))) return true;
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
    // Mirror authorize()'s fail-closed resolver handling (M23): a DNS hiccup
    // during the rebinding check surfaces as a schema-typed REFUSE, never a
    // raw exception escaping the boundary — and an empty answer refuses too.
    let fresh: readonly string[];
    try {
      fresh = await this.resolve(target.host);
    } catch (error) {
      return EgressDecisionSchema.parse({
        decision: 'REFUSE',
        reason: 'RESOLUTION_REFUSED',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    if (fresh.length === 0) {
      return EgressDecisionSchema.parse({
        decision: 'REFUSE',
        reason: 'RESOLUTION_REFUSED',
        detail: 'resolver returned no addresses during pin verification',
      });
    }
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
