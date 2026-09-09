/** Structural proof surface for the permanent read-only discovery boundary. */
export const DISCOVERY_UNIVERSE_PROHIBITED_IMPORT_PATTERNS = Object.freeze([
  /@anthropic-ai/i,
  /@openai/i,
  /@google\/(?:genai|generative-ai)/i,
  /(?:^|[/@-])langchain(?:$|[/])/i,
  /(?:^|[/@-])ollama(?:$|[/])/i,
  /(?:^|[/@-])model-provider(?:$|[/])/i,
  /(?:^|[/@-])agent(?:s|$|[/])/i,
  /(?:^|[/@-])prompt(?:s|$|[/])/i,
  /(?:^|[/@-])llm(?:$|[/])/i,
  /(?:^|[/@-])wallet-signing(?:$|[/])/i,
  /(?:^|[/@-])transaction-submission(?:$|[/])/i,
]);

export const DISCOVERY_UNIVERSE_PROHIBITED_CAPABILITY_IDENTIFIERS = Object.freeze([
  'signTransaction',
  'sendTransaction',
  'submitTransaction',
  'buildTransaction',
  'constructTransaction',
  'privateKey',
  'seedPhrase',
  'placeOrder',
  'executeTrade',
  'transferFunds',
]);

export interface DiscoveryStructuralGuardFinding {
  readonly modulePath: string;
  readonly kind: 'PROHIBITED_IMPORT' | 'PROHIBITED_CAPABILITY';
  readonly evidence: string;
}

function executableSource(rawSource: string): string {
  return rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Pure hook for package structural tests and the repository capability gate. */
export function scanDiscoveryUniverseSources(
  sources: Readonly<Record<string, string>>,
): readonly DiscoveryStructuralGuardFinding[] {
  const findings: DiscoveryStructuralGuardFinding[] = [];
  const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const capabilityPattern = new RegExp(
    `\\b(?:${DISCOVERY_UNIVERSE_PROHIBITED_CAPABILITY_IDENTIFIERS.join('|')})\\b`,
    'g',
  );

  for (const [modulePath, rawSource] of Object.entries(sources).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const source = executableSource(rawSource);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] as string;
      if (DISCOVERY_UNIVERSE_PROHIBITED_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))) {
        findings.push({ modulePath, kind: 'PROHIBITED_IMPORT', evidence: specifier });
      }
    }
    for (const match of source.matchAll(capabilityPattern)) {
      findings.push({
        modulePath,
        kind: 'PROHIBITED_CAPABILITY',
        evidence: match[0],
      });
    }
  }
  return findings;
}

export function assertDiscoveryUniverseReadOnly(
  sources: Readonly<Record<string, string>>,
): void {
  const findings = scanDiscoveryUniverseSources(sources);
  if (findings.length > 0) {
    throw new Error(`DISCOVERY_READ_ONLY_SURFACE_VIOLATION:${JSON.stringify(findings)}`);
  }
}
