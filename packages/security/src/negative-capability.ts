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
import { numericJoin, numericMap, numericSlice, numericSome } from './shadow-safe.ts';

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
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex] as { name: string; source: string };
      const normalized = entry.name.toLowerCase().replace(/[_\s.-]+/g, '-');
      const forbiddenVerbs = this.catalog.inventoryForbiddenVerbs ?? [];
      for (let verbIndex = 0; verbIndex < forbiddenVerbs.length; verbIndex += 1) {
        const verb = forbiddenVerbs[verbIndex] as string;
        if (normalized.includes(verb)) {
          findings[findings.length] = {
            category: 'TRANSACTION_BUILD_SIGN_SUBMIT',
            surface: 'ROUTE_INVENTORY',
            reference: `${entry.source}#${entry.name}`,
            matchedPattern: verb,
          };
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
    for (
      let categoryIndex = 0;
      categoryIndex < this.catalog.categories.length;
      categoryIndex += 1
    ) {
      const categorySpec = this.catalog.categories[
        categoryIndex
      ] as CanaryCatalog['categories'][number];
      const sourcePatterns = categorySpec.sourcePatterns ?? [];
      for (let patternIndex = 0; patternIndex < sourcePatterns.length; patternIndex += 1) {
        const pattern = sourcePatterns[patternIndex] as {
          readonly id: string;
          readonly regex: string;
          readonly flags?: string;
          readonly contextSignals?: readonly string[];
        };
        const flags = `${pattern.flags ?? ''}g`;
        const regex = new RegExp(pattern.regex, flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          if (match[0] === '') {
            regex.lastIndex += 1;
            continue;
          }
          const lineIndex = text.slice(0, match.index).split('\n').length - 1;
          const window = numericJoin(
            numericSlice(lines, Math.max(0, lineIndex - 2), lineIndex + 3),
            '\n',
          ).toLowerCase();
          const signals = pattern.contextSignals ?? [];
          if (
            signals.length === 0 ||
            numericSome(signals, (s) => window.includes(s.toLowerCase()))
          ) {
            findings[findings.length] = {
              category: categorySpec.category,
              surface: 'RUNTIME_CANARY',
              reference: `${relativePath}:${lineIndex + 1}`,
              matchedPattern: pattern.id,
            };
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
    const forbiddenShapes = this.catalog.readOnlyWalletIntelligenceAllowlist.forbiddenQueryShapes;
    for (let index = 0; index < forbiddenShapes.length; index += 1) {
      const shape = forbiddenShapes[index] as string;
      if (this.shapeMatches(normalized, shape)) {
        throw new ProhibitedCapabilityError(
          `query matches a forbidden execution variant: '${shape}'`,
          { shape },
        );
      }
    }
    const admittedShapes = this.catalog.readOnlyWalletIntelligenceAllowlist.admittedQueryShapes;
    for (let index = 0; index < admittedShapes.length; index += 1) {
      const shape = admittedShapes[index] as string;
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
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] as string;
      const idx = normalizedQuery.indexOf(part, cursor);
      if (idx === -1) return false;
      cursor = idx + part.length;
    }
    return true;
  }

  /** Environment-schema forbidden-name scan (same lists as the CLI). */
  scanEnvironmentNames(names: readonly string[]): CanaryFinding[] {
    const findings: CanaryFinding[] = [];
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      const name = names[nameIndex] as string;
      const normalized = name.toUpperCase().replace(/[^A-Z_]/g, '_');
      for (
        let categoryIndex = 0;
        categoryIndex < this.catalog.categories.length;
        categoryIndex += 1
      ) {
        const categorySpec = this.catalog.categories[
          categoryIndex
        ] as CanaryCatalog['categories'][number];
        const envForbiddenNames = categorySpec.envForbiddenNames ?? [];
        for (
          let forbiddenIndex = 0;
          forbiddenIndex < envForbiddenNames.length;
          forbiddenIndex += 1
        ) {
          const forbidden = envForbiddenNames[forbiddenIndex] as string;
          if (normalized.includes(forbidden)) {
            findings[findings.length] = {
              category: categorySpec.category,
              surface: 'ENV_SCHEMA',
              reference: `environment#${name}`,
              matchedPattern: forbidden,
            };
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
    return numericMap(
      this.catalog.categories,
      (c) => c.category,
    ) as readonly ProhibitedCapabilityCategory[];
  }
}
