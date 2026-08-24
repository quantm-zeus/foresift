/**
 * Runtime prohibited-capability canary (FR-SEC-003; AC-050, AC-254,
 * AC-255). Consumes the SAME catalog.json as the CLI scanner (plan material
 * decision 2) so runtime and offline classification cannot drift:
 *
 *   - registered-schema/route inventory checks;
 *   - GMGN-shaped read-only wallet-intelligence query admission vs
 *     forbidden-variant refusal;
 *   - environment-schema forbidden-name scan.
 *
 * A parity test asserts this canary and `scripts/scan-prohibited-
 * capabilities/cli.mjs` classify every fixture identically.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProhibitedCapabilityCategory } from '@foresift/shared-schemas';
import { ProhibitedCapabilityError } from './errors.ts';

export interface CanaryCatalog {
  readonly catalogVersion: number;
  readonly categories: ReadonlyArray<{
    readonly category: string;
    readonly sourcePatterns?: ReadonlyArray<{
      readonly id: string;
      readonly regex: string;
      readonly flags?: string;
      readonly contextSignals?: readonly string[];
    }>;
    readonly envForbiddenNames?: readonly string[];
  }>;
  readonly readOnlyWalletIntelligenceAllowlist: {
    readonly admittedQueryShapes: readonly string[];
    readonly forbiddenQueryShapes: readonly string[];
  };
  readonly inventoryForbiddenVerbs: readonly string[];
}

const SCRIPT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/scan-prohibited-capabilities',
);

/** Load THE shared catalog (same file the CLI consumes). */
export function loadCanaryCatalog(
  catalogPath = path.join(SCRIPT_DIR, 'catalog.json'),
): CanaryCatalog {
  return JSON.parse(readFileSync(catalogPath, 'utf8')) as CanaryCatalog;
}

export interface CanaryFinding {
  readonly category: string;
  readonly surface: 'ROUTE_INVENTORY' | 'SCHEMA_INVENTORY' | 'RUNTIME_CANARY' | 'ENV_SCHEMA';
  readonly reference: string;
  readonly matchedPattern: string;
}

export class NegativeCapabilityCanary {
  private readonly catalog: CanaryCatalog;

  constructor(catalog: CanaryCatalog) {
    this.catalog = catalog;
  }

  /** Inventory check over registered route/tool names. */
  checkInventory(entries: ReadonlyArray<{ name: string; source: string }>): CanaryFinding[] {
    const findings: CanaryFinding[] = [];
    for (const entry of entries) {
      const normalized = entry.name.toLowerCase().replace(/[_\s.-]+/g, '-');
      for (const verb of this.catalog.inventoryForbiddenVerbs ?? []) {
        if (normalized.includes(verb)) {
          findings.push({
            category: 'TRANSACTION_BUILD_SIGN_SUBMIT',
            surface: 'ROUTE_INVENTORY',
            reference: `${entry.source}#${entry.name}`,
            matchedPattern: verb,
          });
        }
      }
    }
    return findings;
  }

  /**
   * Runtime source-text classification over the SHARED catalog patterns.
   * Mirrors scan.mjs's context rule (signals within ±2 lines) — the parity
   * test proves both implementations classify every fixture identically.
   */
  scanSourceText(relativePath: string, text: string): CanaryFinding[] {
    const findings: CanaryFinding[] = [];
    const lines = text.split('\n');
    for (const categorySpec of this.catalog.categories) {
      for (const pattern of categorySpec.sourcePatterns ?? []) {
        const flags = `${pattern.flags ?? ''}g`;
        const regex = new RegExp(pattern.regex, flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          if (match[0] === '') {
            regex.lastIndex += 1;
            continue;
          }
          const lineIndex = text.slice(0, match.index).split('\n').length - 1;
          const window = lines
            .slice(Math.max(0, lineIndex - 2), lineIndex + 3)
            .join('\n')
            .toLowerCase();
          const signals = pattern.contextSignals ?? [];
          if (signals.length === 0 || signals.some((s) => window.includes(s.toLowerCase()))) {
            findings.push({
              category: categorySpec.category,
              surface: 'RUNTIME_CANARY',
              reference: `${relativePath}:${lineIndex + 1}`,
              matchedPattern: pattern.id,
            });
            break; // one finding per (text, pattern), mirroring the CLI
          }
        }
      }
    }
    return findings;
  }

  /**
   * GMGN-shaped wallet intelligence: read-only query shapes are ADMITTED;
   * forbidden variants (execution-flavored) refuse with typed errors.
   */
  classifyWalletQuery(queryText: string): { admitted: boolean; matchedShape?: string } {
    const normalized = queryText.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const shape of this.catalog.readOnlyWalletIntelligenceAllowlist.forbiddenQueryShapes) {
      if (this.shapeMatches(normalized, shape)) {
        throw new ProhibitedCapabilityError(
          `query matches a forbidden execution variant: '${shape}'`,
          { shape },
        );
      }
    }
    for (const shape of this.catalog.readOnlyWalletIntelligenceAllowlist.admittedQueryShapes) {
      if (this.shapeMatches(normalized, shape)) {
        return { admitted: true, matchedShape: shape };
      }
    }
    // Not on either list: fail-closed for anything execution-sounding,
    // admit only clearly inert lookups.
    return { admitted: false };
  }

  private shapeMatches(normalizedQuery: string, shape: string): boolean {
    const parts = shape.toLowerCase().split(/\s+/);
    let cursor = 0;
    for (const part of parts) {
      const idx = normalizedQuery.indexOf(part, cursor);
      if (idx === -1) return false;
      cursor = idx + part.length;
    }
    return true;
  }

  /** Environment-schema forbidden-name scan (same lists as the CLI). */
  scanEnvironmentNames(names: readonly string[]): CanaryFinding[] {
    const findings: CanaryFinding[] = [];
    for (const name of names) {
      const normalized = name.toUpperCase().replace(/[^A-Z_]/g, '_');
      for (const categorySpec of this.catalog.categories) {
        for (const forbidden of categorySpec.envForbiddenNames ?? []) {
          if (normalized.includes(forbidden)) {
            findings.push({
              category: categorySpec.category,
              surface: 'ENV_SCHEMA',
              reference: `environment#${name}`,
              matchedPattern: forbidden,
            });
          }
        }
      }
    }
    return findings;
  }

  /** Convenience raising on ANY finding from a batch check. */
  assertClean(findings: readonly CanaryFinding[]): void {
    if (findings.length > 0) {
      throw new ProhibitedCapabilityError('runtime canary found prohibited surfaces', {
        first: `${findings[0]?.category}:${findings[0]?.reference}`,
        total: findings.length,
      });
    }
  }

  get categories(): readonly ProhibitedCapabilityCategory[] {
    return this.catalog.categories.map(
      (c) => c.category,
    ) as readonly ProhibitedCapabilityCategory[];
  }
}
