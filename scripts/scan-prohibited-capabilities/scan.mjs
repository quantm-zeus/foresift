// Prohibited-capability source + dependency-manifest scanner (T122,
// FR-SEC-003, AC-050/AC-254). Consumes catalog.json DECLARATIVELY — the
// runtime canary in packages/security/src/negative-capability.ts loads this
// same file, so CLI and runtime classification cannot drift.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function loadCatalog(catalogPath) {
  return JSON.parse(readFileSync(catalogPath, 'utf8'));
}

function compile(pattern) {
  // ALWAYS global: the scanner walks matches with exec(); a non-global
  // regex would return the same first match forever.
  const flags = `${pattern.flags ?? ''}g`.replace(/[^gimsuy]/g, '');
  return new RegExp(pattern.regex, flags);
}

/**
 * A match becomes a FINDING only when its code-context signals agree:
 * either the pattern declares no contextSignals (structural match is
 * enough) or at least one signal appears within ±2 lines of the match.
 */
function contextAgrees(lines, lineIndex, contextSignals) {
  if (!contextSignals || contextSignals.length === 0) return true;
  const window = lines
    .slice(Math.max(0, lineIndex - 2), lineIndex + 3)
    .join('\n')
    .toLowerCase();
  return contextSignals.some((signal) => window.includes(signal.toLowerCase()));
}

function findingId(category, surface, reference, patternId) {
  // Deterministic id: stable across runs for identical inputs.
  const digest = createHash('sha256')
    .update(`${category}|${surface}|${reference}|${patternId}`)
    .digest('hex')
    .slice(0, 16);
  return `pc-${digest}`;
}

/** Scan one source file's text; returns findings for every category. */
export function scanSourceFile(relativePath, text, catalog) {
  const findings = [];
  const lines = text.split('\n');
  for (const categorySpec of catalog.categories) {
    for (const pattern of categorySpec.sourcePatterns ?? []) {
      const regex = compile(pattern);
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        if (match[0] === '') {
          // Zero-width match: advance manually to avoid an endless loop.
          regex.lastIndex += 1;
          continue;
        }
        const upToMatch = text.slice(0, match.index);
        const lineIndex = upToMatch.split('\n').length - 1;
        if (contextAgrees(lines, lineIndex, pattern.contextSignals)) {
          findings.push({
            findingId: findingId(
              categorySpec.category,
              'SOURCE_SCAN',
              `${relativePath}:${lineIndex + 1}`,
              pattern.id,
            ),
            category: categorySpec.category,
            surface: 'SOURCE_SCAN',
            reference: `${relativePath}:${lineIndex + 1}`,
            matchedPattern: pattern.id,
          });
          break; // one finding per (file, pattern) keeps reports readable
        }
      }
    }
  }
  return findings;
}

/** Scan a parsed package.json-style manifest's dependency names. */
export function scanDependencyManifest(relativePath, manifest, catalog) {
  const findings = [];
  const dependencyNames = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
  for (const name of dependencyNames) {
    for (const categorySpec of catalog.categories) {
      for (const patternSource of categorySpec.dependencyPatterns ?? []) {
        const regex = new RegExp(patternSource, 'i');
        if (regex.test(name)) {
          findings.push({
            findingId: findingId(categorySpec.category, 'DEPENDENCY_MANIFEST', relativePath, name),
            category: categorySpec.category,
            surface: 'DEPENDENCY_MANIFEST',
            reference: `${relativePath}#${name}`,
            matchedPattern: name,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Environment-variable NAME scan (surface ENV_SCHEMA): forbidden names come
 * from every category's envForbiddenNames list.
 */
export function scanEnvironmentNames(environmentNames, catalog) {
  const findings = [];
  for (const name of environmentNames) {
    for (const categorySpec of catalog.categories) {
      for (const forbidden of categorySpec.envForbiddenNames ?? []) {
        if (
          name
            .toUpperCase()
            .replace(/[^A-Z_]/g, '_')
            .includes(forbidden)
        ) {
          findings.push({
            findingId: findingId(categorySpec.category, 'ENV_SCHEMA', 'environment', forbidden),
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
