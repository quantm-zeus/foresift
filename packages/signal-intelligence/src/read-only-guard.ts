/** Structural INV-001 / Appendix-I step-14 proof surface. */
export const SIGNAL_INTELLIGENCE_ALLOWED_IMPORT_PREFIXES = Object.freeze([
  '@foresift/domain',
  '@foresift/evidence',
  '@foresift/persistence',
  '@foresift/shared-schemas',
  './',
]);

export const SIGNAL_INTELLIGENCE_PROHIBITED_IMPORT_PATTERNS = Object.freeze([
  /(?:^|[/@-])model-provider(?:$|[/])/i,
  /(?:^|[/@-])agent(?:s|$|[/])/i,
  /(?:^|[/@-])prompt(?:s|$|[/])/i,
  /(?:^|[/@-])llm(?:$|[/])/i,
]);

export const SIGNAL_INTELLIGENCE_PROHIBITED_CAPABILITIES = Object.freeze([
  'wallet signing',
  'private key handling',
  'transaction construction',
  'transaction submission',
  'custody',
  'trading execution',
]);

export interface StructuralGuardFinding {
  readonly modulePath: string;
  readonly kind: 'PROHIBITED_IMPORT' | 'PROHIBITED_CAPABILITY';
  readonly evidence: string;
}

/**
 * Pure scanner seam used by structural tests and build tooling. Comments are
 * stripped so the declaration of this policy does not self-trigger.
 */
export function scanSignalIntelligenceSources(
  sources: Readonly<Record<string, string>>,
): readonly StructuralGuardFinding[] {
  const findings: StructuralGuardFinding[] = [];
  const importPattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const capabilityPattern =
    /\b(?:signTransaction|sendTransaction|submitTransaction|privateKey|seedPhrase|placeOrder|executeTrade)\b/g;
  for (const [modulePath, rawSource] of Object.entries(sources).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] as string;
      if (
        SIGNAL_INTELLIGENCE_PROHIBITED_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))
      ) {
        findings.push({ modulePath, kind: 'PROHIBITED_IMPORT', evidence: specifier });
      }
    }
    for (const match of source.matchAll(capabilityPattern)) {
      findings.push({ modulePath, kind: 'PROHIBITED_CAPABILITY', evidence: match[0] });
    }
  }
  return findings;
}

export function assertReadOnlyDeterministicSurface(
  sources: Readonly<Record<string, string>>,
): void {
  const findings = scanSignalIntelligenceSources(sources);
  if (findings.length > 0)
    throw new Error(`READ_ONLY_DETERMINISTIC_SURFACE_VIOLATION:${JSON.stringify(findings)}`);
}
