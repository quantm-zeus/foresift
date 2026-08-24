// INTENTIONAL PROHIBITED-CAPABILITY FIXTURE — SWAP_ORDER_EXECUTION category
// for AC-050/AC-254 detection proof. Inert: never imported by product code,
// excluded from scanner verdicts by documented rule. Detection requires the
// context signal ('swap' + execution verb) within ±2 lines.
export function executeSwap(inputToken: string, outputToken: string, amountLamports: number) {
  // a real implementation would route through a DEX aggregator to swap tokens
  void inputToken;
  void outputToken;
  void amountLamports;
}
