/**
 * Prohibited Claim Language & Population Naming Rules (FR-DISC-009, FR-DISC-014).
 * Normative text:
 * FR-DISC-009: "Discovery coverage is reported only for a named population such as SUPPORTED_PROGRAM_UNIVERSE,
 * PROSPECTIVELY_OBSERVED_UNIVERSE, AGGREGATE_PROVIDER_UNIVERSE, or a probability-sampled retrospective universe."
 * FR-DISC-014: "Full-market, all-Solana, or universal-recall language is prohibited unless
 * the exact coverage and sampling contract establishes it."
 */
import { describe, expect, it } from 'bun:test';

const PROHIBITED_CLAIM_PATTERNS = [
  /all[- ]solana/i,
  /full[- ]market/i,
  /universal[- ]recall/i,
  /100%[- ]coverage/i,
  /complete[- ]market/i,
  /every[- ]token/i,
  /entire[- ]chain/i,
];

const ALLOWED_POPULATION_NAMES = [
  'SUPPORTED_PROGRAM_UNIVERSE',
  'PROSPECTIVELY_OBSERVED_UNIVERSE',
  'AGGREGATE_PROVIDER_UNIVERSE',
  'AUTHORIZED_LAUNCH_UNIVERSE',
  'STRATIFIED_SAMPLED_UNIVERSE',
  'CURRENTLY_OBSERVED_SUBSET_ONLY',
];

interface CoverageClaimReport {
  readonly reportId: string;
  readonly populationClass: string;
  readonly claimTitle: string;
  readonly summaryText: string;
  readonly samplingContractEstablished: boolean;
}

function validateClaimLanguage(report: CoverageClaimReport): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // Check if population class is allowed
  if (!ALLOWED_POPULATION_NAMES.includes(report.populationClass)) {
    violations.push(
      `Unnamed or forbidden population class '${report.populationClass}'. Must be one of: ${ALLOWED_POPULATION_NAMES.join(', ')} (FR-DISC-009)`,
    );
  }

  // Check prohibited claim patterns in text unless sampling contract establishes it
  if (!report.samplingContractEstablished) {
    const textToCheck = `${report.claimTitle} ${report.summaryText}`;
    for (const pattern of PROHIBITED_CLAIM_PATTERNS) {
      if (pattern.test(textToCheck)) {
        violations.push(
          `Prohibited marketing claim matching '${pattern.source}' found without established contract (FR-DISC-014)`,
        );
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

describe('Prohibited Claim Language & Population Naming Rules (FR-DISC-009, FR-DISC-014)', () => {
  it('accepts compliant report using named population and honest scope phrasing', () => {
    const compliantReport: CoverageClaimReport = {
      reportId: 'rep_honest_001',
      populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
      claimTitle: 'Pump.fun Bonding Curve Discovery Coverage (2026-08)',
      summaryText: 'Observed 98.4% of supported program bonding curve launch events on Solana.',
      samplingContractEstablished: true,
    };

    const result = validateClaimLanguage(compliantReport);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('refuses claims using prohibited "all-Solana" or "full-market" phrases without contract', () => {
    const prohibitedPhrases = [
      'Discovered all Solana tokens in real-time',
      'Guarantees full-market coverage of every launch',
      'Achieved universal-recall across the ecosystem',
      'Offers 100% coverage of entire chain assets',
    ];

    for (const phrase of prohibitedPhrases) {
      const badReport: CoverageClaimReport = {
        reportId: 'rep_bad_001',
        populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
        claimTitle: phrase,
        summaryText: 'Marketing summary claiming complete visibility.',
        samplingContractEstablished: false,
      };

      const result = validateClaimLanguage(badReport);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('Prohibited marketing claim'))).toBe(true);
    }
  });

  it('refuses coverage reports with unnamed or non-standard population classes', () => {
    const badPopulationReport: CoverageClaimReport = {
      reportId: 'rep_bad_pop_002',
      populationClass: 'ALL_MEME_COINS_GLOBAL',
      claimTitle: 'Meme coin discovery metrics',
      summaryText: 'Standard report text.',
      samplingContractEstablished: true,
    };

    const result = validateClaimLanguage(badPopulationReport);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Unnamed or forbidden population class'))).toBe(
      true,
    );
  });
});
