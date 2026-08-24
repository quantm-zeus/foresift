/**
 * SSRF attack-URL battery (AC-052/AC-276 evidence): every shape the egress
 * guard must refuse before any connection is attempted. Inert strings —
 * nothing here performs I/O; suites feed them to packages/security egress
 * normalization/pinning code expecting typed refusal.
 */

/** Cloud/instance metadata and loopback targets. */
export const METADATA_AND_LOOPBACK_TARGETS: readonly string[] = [
  'http://169.254.169.254/latest/meta-data/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://100.100.100.200/metadata',
  'http://127.0.0.1:5432/',
  'http://localhost:9090/metrics',
  'http://[::1]:8080/',
  'http://[::ffff:127.0.0.1]/',
];

/** Encoded / truncated / alternate-form bypass attempts at the same nets. */
export const ENCODED_BYPASS_TARGETS: readonly string[] = [
  'http://0x7f000001/',
  'http://2130706433/',
  'http://017700000001/',
  'http://127.1/',
  'http://169.254.169.254.nip.example/',
  'http://example.com@169.254.169.254/',
  'http:%2F%2F169.254.169.254/',
  'https://expected-host.example/@169.254.169.254/',
];

/** Private-link ranges that must refuse even with DNS resolving publicly. */
export const PRIVATE_RANGE_TARGETS: readonly string[] = [
  'http://10.0.0.8/internal-api',
  'http://172.16.4.9/admin',
  'http://192.168.1.50/router',
  'http://fe80::1/',
  'http://fc00::stub/',
  'http://169.254.10.10/credentials',
];

/** Legitimate public research targets the guard MUST admit. */
export const ADMITTED_PUBLIC_TARGETS: readonly string[] = [
  'https://api.coingecko.com/api/v3/global',
  'https://solana.publicnode.com/',
  'https://raw.githubusercontent.com/solana-labs/solana/README.md',
];
