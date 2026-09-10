/** Structural INV-001 proof and prohibited-capability scanner hook. */
export const OUTCOME_MATURITY_PROHIBITED_IMPORT_PATTERNS = Object.freeze([
  /@openai/i,
  /@anthropic-ai/i,
  /(?:^|[/@-])model-provider(?:$|[/])/i,
  /(?:^|[/@-])agent(?:s|$|[/])/i,
  /(?:^|[/@-])wallet(?:$|[/])/i,
]);

export const OUTCOME_MATURITY_PROHIBITED_IDENTIFIERS = Object.freeze([
  'buildTransaction', 'constructTransaction', 'signTransaction', 'sendTransaction',
  'submitTransaction', 'privateKey', 'seedPhrase', 'placeOrder', 'executeTrade',
  'transferFunds', 'custodyWallet',
]);

export interface MaturityGuardFinding {
  readonly modulePath: string;
  readonly kind: 'PROHIBITED_IMPORT' | 'PROHIBITED_CAPABILITY';
  readonly evidence: string;
}

export function scanOutcomeMaturitySources(
  sources: Readonly<Record<string, string>>,
): readonly MaturityGuardFinding[] {
  const findings: MaturityGuardFinding[] = [];
  const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const capabilityPattern = new RegExp(`\\b(?:${OUTCOME_MATURITY_PROHIBITED_IDENTIFIERS.join('|')})\\b`, 'g');
  for (const [modulePath, raw] of Object.entries(sources).sort(([left], [right]) => left.localeCompare(right))) {
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]!;
      if (OUTCOME_MATURITY_PROHIBITED_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier)))
        findings.push({ modulePath, kind: 'PROHIBITED_IMPORT', evidence: specifier });
    }
    const identifiers = source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '');
    for (const match of identifiers.matchAll(capabilityPattern))
      findings.push({ modulePath, kind: 'PROHIBITED_CAPABILITY', evidence: match[0] });
  }
  return findings;
}

export function assertOutcomeMaturityReadOnly(sources: Readonly<Record<string, string>>): void {
  const findings = scanOutcomeMaturitySources(sources);
  if (findings.length > 0)
    throw new Error(`OUTCOME_MATURITY_READ_ONLY_VIOLATION:${JSON.stringify(findings)}`);
}

export interface OutcomeMaturityReadOnlyAttestation {
  readonly constructsTransactions: false;
  readonly submitsTransactions: false;
  readonly signsTransactions: false;
  readonly holdsCustody: false;
  readonly invokesModelsOrAgents: false;
}

export const outcomeMaturityReadOnlyAttestation = (): OutcomeMaturityReadOnlyAttestation => ({
  constructsTransactions: false,
  submitsTransactions: false,
  signsTransactions: false,
  holdsCustody: false,
  invokesModelsOrAgents: false,
});
