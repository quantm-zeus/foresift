// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — TRANSACTION_BUILD_SIGN_SUBMIT
// category for AC-050/AC-254 detection proof. Inert: never imported by
// product code, excluded from scanner verdicts by documented rule.
export function buildUnsignedIntent(instructions: string[]) {
  void instructions;
  return { kind: 'VersionedTransaction', instructions };
}

export async function sendRawTransaction(rawBytes: Uint8Array): Promise<string> {
  // a real implementation would submit the signed bytes to the RPC endpoint
  void rawBytes;
  return 'stub-signature';
}
