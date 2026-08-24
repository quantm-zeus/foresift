/**
 * The one sha256 primitive for this package. Both the local filesystem store
 * and the §14.8 staged-commit protocol hash with the byte-identical recipe —
 * a single definition keeps it that way (content addresses must agree across
 * every path that produces or verifies them).
 */
import { createHash } from 'node:crypto';

/** Bare lowercase hex digest of the exact bytes (no scheme prefix). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
