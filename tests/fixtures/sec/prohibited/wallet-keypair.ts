// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — negative-acceptance input for
// AC-050/AC-254/AC-255. This file exists to prove the scanner and the
// runtime canary DETECT signing/key-material capability. It is excluded
// from scanner verdicts (see scripts/scan-prohibited-capabilities/README.md)
// and MUST never be imported by product code.
//
// Fixture: private-key material + transaction-signing capability.

const privateKeyHex = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // key material

function signTransaction(payload: Uint8Array): Uint8Array {
  // a real implementation would produce an ed25519 signature here
  return payload;
}

export { privateKeyHex, signTransaction };
