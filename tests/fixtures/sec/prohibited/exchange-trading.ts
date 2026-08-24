// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — EXCHANGE_TRADING category for
// AC-050/AC-254 detection proof. Inert: never imported by product code,
// values are placeholder stubs, excluded from scanner verdicts by the
// documented fixture-corpus rule.
export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
}

export function marketBuy(symbol: string, quantity: number): string {
  // a real implementation would submit a buy order to the exchange venue
  void symbol;
  void quantity;
  return 'stub-order-id';
}

export function cancelOrder(orderId: string): void {
  void orderId;
}
