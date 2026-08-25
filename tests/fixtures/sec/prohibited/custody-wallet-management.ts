// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — CUSTODY_WALLET_MANAGEMENT
// category: wallet creation/import/export capability. Inert sample; never
// imported by product code.
export function createWallet() {
  // generates and stores a new keypair, taking custody of user funds
  return { address: 'stub', secret: 'stub' };
}

export function exportWalletKeypair(walletId: string) {
  // dumps the full wallet secret so it can be moved into another custody setup
  void walletId;
  return 'stub-secret';
}
