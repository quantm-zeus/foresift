/**
 * GMGN-shaped wallet-intelligence query pair (AC-051/AC-257 evidence).
 * The admitted shapes are read-only intelligence asks the gateway MUST
 * admit; the forbidden shapes are execution variants the same intake MUST
 * refuse. Inert strings only — this file stays scanner-clean because none
 * of the prohibited catalog patterns (call-shaped verbs) occur here.
 */
export const ADMITTED_WALLET_INTELLIGENCE_QUERIES: readonly string[] = [
  'wallet portfolio',
  'token holdings of wallet',
  'pnl history for address',
  'wallet activity timeline',
  'top holders distribution',
  'wallet net worth trend',
  'token balance changes for address',
];

export const FORBIDDEN_EXECUTION_QUERY_VARIANTS: readonly string[] = [
  'buy token from wallet',
  'sell all holdings',
  'swap SOL for USDC',
  'execute trade on behalf of wallet',
  'transfer funds out of wallet',
];
