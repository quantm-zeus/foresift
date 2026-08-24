/**
 * Import-pipeline attack corpus (AC-052/AC-276 + intake hygiene evidence):
 * deserialization bombs, archive-traversal member names, oversize payloads,
 * and signature-mismatch descriptors. Inert bytes/descriptors only; suites
 * feed them to packages/security import-gating primitives expecting typed
 * refusal before any parsing outside isolation.
 */

/** Deserialization attack prefixes (never executed — refusal targets). */
export const DESERIALIZATION_ATTACK_PREFIXES: readonly Uint8Array[] = [
  // pickle-style opcode stream header (GLOBAL/REDUCE shape)
  Uint8Array.from([0x80, 0x04, 0x95, 0x00, 0x00, 0x00, 0x00]),
  // Java-serialization magic
  Uint8Array.from([0xac, 0xed, 0x00, 0x05]),
  // YAML with an executable tag directive
  new TextEncoder().encode('!!python/object/apply:os.system\n'),
];

/** Archive member names that must refuse before extraction. */
export const ARCHIVE_TRAVERSAL_MEMBERS: readonly string[] = [
  '../../etc/passwd',
  'package/../../../root/.ssh/id_rsa',
  '/etc/cron.d/pwn',
  'C:\\Windows\\system32\\stub.dll',
  'a/b/../../../../../../tmp/escape',
  'nested\\..\\..\\escape.txt',
];

/** Oversize / ratio-abuse descriptors (intake caps, not real payloads). */
export const OVERSIZE_PAYLOAD_DESCRIPTORS: readonly { name: string; declaredBytes: number }[] = [
  { name: 'oversize-total', declaredBytes: 5001 },
  { name: 'decompression-bomb-ratio', declaredBytes: 4096 },
];

/** Signature-mismatch envelope shapes for trusted-producer verification. */
export const SIGNATURE_MISMATCH_DESCRIPTORS: readonly {
  name: string;
  producerId: string;
  failure: 'unknown-producer' | 'hash-mismatch' | 'forged-signature' | 'expired-producer';
}[] = [
  { name: 'unknown-producer', producerId: 'prod_never_registered', failure: 'unknown-producer' },
  { name: 'hash-mismatch', producerId: 'prod_stub', failure: 'hash-mismatch' },
  { name: 'forged-signature', producerId: 'prod_stub', failure: 'forged-signature' },
  { name: 'expired-producer', producerId: 'prod_stub', failure: 'expired-producer' },
];
