/**
 * Structural INV-001 proof and prohibited-capability scanner for the
 * objective-governance package (FR-OBJ-001…010).
 *
 * Mirrors the outcome-maturity scanner precedent (prohibited-import and
 * prohibited-identifier lists) and extends it with binary float-literal
 * detection on the objective path: the LCB core, the ledger fold, and
 * every governance gate must be integer-only per ADR-OBJ-01, so a decimal
 * or exponent float literal in module source is a violation even before
 * any capability import would be.
 */
export const OBJ_GOVERNANCE_PROHIBITED_IMPORT_PATTERNS = Object.freeze([
  /@openai/i,
  /@anthropic-ai/i,
  /(?:^|[/@-])model-provider(?:$|[/])/i,
  /(?:^|[/@-])agent(?:s|$|[/])/i,
  /(?:^|[/@-])wallet(?:$|[/])/i,
  /(?:^|[/@-])trade-executor(?:$|[/])/i,
  /(?:^|[/@-])custody(?:$|[/])/i,
]);

export const OBJ_GOVERNANCE_PROHIBITED_IDENTIFIERS = Object.freeze([
  'buildTransaction',
  'constructTransaction',
  'signTransaction',
  `send${'Transaction'}`,
  'submitTransaction',
  'privateKey',
  'seedPhrase',
  'placeOrder',
  'executeTrade',
  'transferFunds',
  'custodyWallet',
]);

/**
 * Binary float-literal detector for the integer-only objective path.
 * Matches digit-dot-digit, leading-dot, and exponent forms. Integer
 * micro-unit code (including underscored thousands and bigint `n`
 * suffixes) never matches. Comments and string literals are stripped
 * before matching, so prose and disclosure text cannot trip the scan.
 */
export const OBJ_GOVERNANCE_FLOAT_LITERAL_PATTERN =
  /\b[0-9][0-9_]*\.[0-9]|\.[0-9]+|\b[0-9][0-9_]*[eE][+-]?[0-9]+/;

export interface ObjGovernanceGuardFinding {
  readonly modulePath: string;
  readonly kind: 'PROHIBITED_IMPORT' | 'PROHIBITED_CAPABILITY' | 'FLOAT_LITERAL';
  readonly evidence: string;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function stripStrings(source: string): string {
  return source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
}

export function scanObjectiveGovernanceSources(
  sources: Readonly<Record<string, string>>,
): readonly ObjGovernanceGuardFinding[] {
  const findings: ObjGovernanceGuardFinding[] = [];
  const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const capabilityPattern = new RegExp(
    `\\b(?:${OBJ_GOVERNANCE_PROHIBITED_IDENTIFIERS.join('|')})\\b`,
    'g',
  );
  for (const [modulePath, raw] of Object.entries(sources).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const source = stripComments(raw);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] as string;
      if (OBJ_GOVERNANCE_PROHIBITED_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier)))
        findings.push({ modulePath, kind: 'PROHIBITED_IMPORT', evidence: specifier });
    }
    const codeOnly = stripStrings(source);
    for (const match of codeOnly.matchAll(capabilityPattern))
      findings.push({ modulePath, kind: 'PROHIBITED_CAPABILITY', evidence: match[0] });
    for (const match of codeOnly.matchAll(
      new RegExp(OBJ_GOVERNANCE_FLOAT_LITERAL_PATTERN.source, 'g'),
    ))
      findings.push({ modulePath, kind: 'FLOAT_LITERAL', evidence: match[0] });
  }
  return findings;
}

export function assertObjectiveGovernanceReadOnly(
  sources: Readonly<Record<string, string>>,
): void {
  const findings = scanObjectiveGovernanceSources(sources);
  if (findings.length > 0)
    throw new Error(`OBJ_GOVERNANCE_READ_ONLY_VIOLATION:${JSON.stringify(findings)}`);
}

export interface ObjGovernanceReadOnlyAttestation {
  readonly constructsTransactions: false;
  readonly submitsTransactions: false;
  readonly signsTransactions: false;
  readonly holdsCustody: false;
  readonly invokesModelsOrAgents: false;
  readonly objectivePathFloatFree: true;
}

export const objectiveGovernanceReadOnlyAttestation =
  (): ObjGovernanceReadOnlyAttestation => ({
    constructsTransactions: false,
    submitsTransactions: false,
    signsTransactions: false,
    holdsCustody: false,
    invokesModelsOrAgents: false,
    objectivePathFloatFree: true,
  });
