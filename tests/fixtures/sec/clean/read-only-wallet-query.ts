// CLEAN FIXTURE — GMGN-shaped READ-ONLY wallet intelligence. Must classify
// clean on both the CLI scanner and the runtime canary (AC-050/AC-255).

export interface WalletPortfolioQuery {
  readonly address: string;
}

export function buildPortfolioQueryText(query: WalletPortfolioQuery): string {
  return `wallet portfolio ${query.address}`;
}
