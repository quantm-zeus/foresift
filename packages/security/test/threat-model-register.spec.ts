/**
 * Threat-model register conformance (FR-SEC-012; T133). The register under
 * docs/runbooks/security/threat-models/register.md MUST keep all eleven
 * trust boundaries enumerated with their duty fields, and every mapped
 * automated-suite path must EXIST on disk or be explicitly marked
 * `[deferred: <package>]` — a suite that silently vanishes fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REGISTER_PATH = path.join(REPO_ROOT, 'docs/runbooks/security/threat-models/register.md');

/** The eleven §9.3 boundaries in canonical naming order (register headings). */
const ELEVEN_BOUNDARIES = [
  'MCP clients',
  'Admin surface',
  'Webhooks & scheduler/collector callbacks',
  'Providers (external data APIs)',
  'Collector (chain events, social text, websites, token metadata)',
  'Model boundary',
  'Database',
  'Object store (artifacts)',
  'Alpha Lab',
  'Notifications',
  'Public distribution boundary',
] as const;

const SECTION_FIELDS = [
  '**Assets**',
  '**Trust assumptions',
  '**Top threats**',
  '**Controls (this package)**',
  '**Automated suites**',
] as const;

describe('threat-model register conformance (T133)', () => {
  const register = readFileSync(REGISTER_PATH, 'utf8');

  it('enumerates ALL eleven boundaries as headings', () => {
    const headings = register.split('\n').filter((l) => l.startsWith('### '));
    for (const boundary of ELEVEN_BOUNDARIES) {
      expect(
        headings.some((h) => h.includes(boundary)),
        `boundary heading missing: ${boundary}`,
      ).toBe(true);
    }
    expect(headings.length).toBeGreaterThanOrEqual(ELEVEN_BOUNDARIES.length);
  });

  it('carries every duty field in every boundary section', () => {
    const sections = register.split(/^### /m).slice(1); // first chunk is the preamble
    for (const section of sections) {
      if (!SECTION_FIELDS.some((f) => section.includes(f))) continue; // product-wide tail section uses same fields; skip foreign splits
      for (const field of SECTION_FIELDS) {
        expect(section.includes(field), `section missing ${field}`).toBe(true);
      }
    }
  });

  it('maps only suites that exist on disk or are marked [deferred: package]', () => {
    const suiteRefs = [...register.matchAll(/`((?:tests|packages)\/[^\s`]+)`/g)].map((m) => {
      const ref = m[1] ?? '';
      return {
        path: ref,
        line: m.input?.split('\n').find((l) => l.includes(ref)) ?? '',
      };
    });
    // The register must actually map suites — an empty map is vacuous.
    expect(suiteRefs.length).toBeGreaterThan(20);
    const problems: string[] = [];
    for (const { path: ref, line } of suiteRefs) {
      const exists = (() => {
        try {
          return readFileSync(path.join(REPO_ROOT, ref), 'utf8') !== undefined;
        } catch {
          return false;
        }
      })();
      if (!exists && !line.includes('[deferred:')) {
        problems.push(`${ref} neither exists nor is marked [deferred: …]`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
