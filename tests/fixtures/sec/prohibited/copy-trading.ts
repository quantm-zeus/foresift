// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — COPY_TRADING category for
// AC-050/AC-254 detection proof. Inert: never imported by product code,
// excluded from scanner verdicts by documented rule.
export interface CopyTradingConfig {
  copyTrade: boolean;
  leaderWallet: string;
}

export function followWallet(leaderAddress: string) {
  // a real implementation would mirror every trade of the leader wallet
  void leaderAddress;
}
