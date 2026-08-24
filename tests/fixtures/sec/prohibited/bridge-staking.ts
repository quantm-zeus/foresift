// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — BRIDGE_STAKING category for
// AC-050/AC-254 detection proof. Inert: never imported by product code,
// excluded from scanner verdicts by documented rule.
export async function bridgeTokens(
  sourceChain: string,
  targetChain: string,
  amountMinorUnits: bigint,
): Promise<string> {
  // a real implementation would move assets across chains via a bridge
  void sourceChain;
  void targetChain;
  void amountMinorUnits;
  return 'stub-transfer-id';
}

export function delegateStake(stakeAccount: string, lamports: bigint): void {
  // a real implementation would delegate stake to a validator
  void stakeAccount;
  void lamports;
}
