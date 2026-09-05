/**
 * §64.16 / FR-EXEC-005 structural read-only guard (AC-230).
 *
 * The execution simulator is a modeling surface only: there is no
 * build/sign/broadcast/submit/recommend capability anywhere in the package.
 * This guard makes the boundary structural:
 *
 *  - any payload resembling a quote-provider transaction-construction
 *    object (serialized swap message, compiled instructions, signer keys,
 *    wallet adapter surface) is REFUSED, never consumed as quote evidence;
 *  - the guard exposes only `true`-valued assertions — there is no code
 *    path that could ever return an execution capability.
 *
 * Traces: FR-EXEC-005, FR-EXEC-015, AC-230; permanent product boundary
 * READ_ONLY_NO_TRADING_CUSTODY_SIGNING.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';

/** Field names that mark a payload as transaction-construction material. */
const PROHIBITED_PAYLOAD_MARKERS = [
  'transactionPayload',
  'serializedMessage',
  'swapTransaction',
  'unsignedTransaction',
  'signedTransaction',
  'compiledInstructions',
  'partialSign',
  'signTransaction',
  'signAndSendTransaction',
  'sendTransaction',
  'signAllTransactions',
  'serializeMessage',
  'messageBytes',
  'blockhashLifetimeConstraint',
  'lastValidBlockHeight',
  'walletAdapter',
  'publicKeySigner',
] as const;

/** Nesting keys scanned recursively (bounded depth). */
const MAX_SCAN_DEPTH = 8;

function looksLikeTransactionPayload(value: unknown, depth: number): boolean {
  if (depth > MAX_SCAN_DEPTH) return false;
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => looksLikeTransactionPayload(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  for (const marker of PROHIBITED_PAYLOAD_MARKERS) {
    if (Object.prototype.hasOwnProperty.call(record, marker)) return true;
  }
  return Object.values(record).some((child) => looksLikeTransactionPayload(child, depth + 1));
}

/**
 * Structural guard: refuse any payload carrying transaction-construction
 * material. Quote evidence must carry `transactionPayloadRef: null` (§64.5/
 * INV-001); this guard is the last-line check for arbitrary payloads the
 * simulator is asked to consume.
 */
export function refuseTransactionPayloads(payload: unknown): void {
  if (payload === null || payload === undefined) return;
  if (looksLikeTransactionPayload(payload, 0)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'QUOTE_PROVIDER_TRANSACTION_PAYLOAD_REFUSED',
      boundary: 'READ_ONLY_NO_TRADING_CUSTODY_SIGNING',
    });
  }
}

/** The package's capability self-description — permanently empty. */
export interface ReadOnlyCapabilityAttestation {
  readonly buildsTransactions: false;
  readonly signsTransactions: false;
  readonly broadcastsTransactions: false;
  readonly submitsTransactions: false;
  readonly recommendsExecution: false;
  readonly holdsCustody: false;
  readonly handlesPrivateKeys: false;
}

/**
 * The only attestation this package can emit: every capability flag is
 * structurally `false`. The literal type prevents any configuration from
 * flipping a flag — the return type has no `true` in it.
 */
export function readOnlyAttestation(): ReadOnlyCapabilityAttestation {
  return {
    buildsTransactions: false,
    signsTransactions: false,
    broadcastsTransactions: false,
    submitsTransactions: false,
    recommendsExecution: false,
    holdsCustody: false,
    handlesPrivateKeys: false,
  };
}
