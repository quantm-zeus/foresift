#!/usr/bin/env bun
/**
 * @requirement FR-PROD-001 @acceptance AC-266
 *
 * Bun-run bridge that evaluates the PROD conformance rules for the
 * deterministic release-conformance CLI (`cli.mjs`). The CLI runs under Node,
 * which cannot import the TypeScript rule module, so it spawns this bridge with
 * `bun` and merges the JSON findings (audit H1: the five PROD rules must be
 * reachable from the release gate, not only from the package test suite).
 *
 * Usage: bun prod-conformance-gate.ts <repoRoot> [claimsJsonPath]
 *
 *   - the repo-backed surface rule (`checkProdSurfacePresence`) ALWAYS runs;
 *   - when a claims JSON path is supplied, the five claim rules run over it;
 *   - when `--require-claims` is present and no claims are supplied, the bridge
 *     emits the fail-closed PROD_CONFORMANCE_INPUT_MISSING finding.
 *
 * It never writes: stdout is one JSON object `{ findings: [...] }`.
 */
import { readFile } from 'node:fs/promises';
import {
  checkProdSurfacePresence,
  evaluateProdConformance,
  PROD_RULES,
} from '../../packages/release-conformance/src/prod-rules.ts';

interface Finding {
  readonly requirementId: string;
  readonly rule: string;
  readonly path: string;
  readonly message: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requireClaims = args.includes('--require-claims');
  const positional = args.filter((arg) => arg !== '--require-claims');
  // M1: unexpected extra/flag inputs are refused, never silently ignored. The
  // bridge accepts at most `<repoRoot> [claimsPath]`.
  if (positional.length > 2) {
    throw new Error(
      `unexpected extra PROD conformance-gate argument(s): ${positional.slice(2).join(' ')}`,
    );
  }
  for (let index = 0; index < positional.length; index += 1) {
    if (positional[index]?.startsWith('-')) {
      throw new Error(`unexpected PROD conformance-gate flag: ${positional[index]}`);
    }
  }
  const repoRoot = positional[0] ?? process.cwd();
  const claimsPath = positional[1];

  const findings: Finding[] = [];
  // Scope the surface rule to the FR-PROD requirements the ACTIVE milestone
  // owns, exactly as `evaluateConformance` does: G6-owned FR-PROD items are not
  // yet implemented and must not be reported as a G2 surface gap.
  const manifest = JSON.parse(
    await readFile(
      `${repoRoot}/docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`,
      'utf8',
    ),
  ) as { requirements?: readonly { id: string; dependencyGroup?: string }[] };
  const milestone = JSON.parse(
    await readFile(`${repoRoot}/specs/implementation/current-milestone.json`, 'utf8'),
  ) as { milestoneId?: string; status?: string };
  const activeGroup = milestone.status === 'ACTIVE' ? milestone.milestoneId : undefined;
  // A malformed milestone id must never silently narrow the PROD surface to an
  // empty requirement set (audit R2 residual / T057): fail the bridge closed.
  if (activeGroup !== undefined && !/^G[0-7]$/.test(activeGroup)) {
    throw new Error(
      `current milestone ${JSON.stringify(activeGroup)} is not a canonical G0…G7 dependency group`,
    );
  }
  const prodRequirements = (manifest.requirements ?? []).filter(
    (requirement) =>
      requirement.id.startsWith('FR-PROD-') &&
      (activeGroup === undefined || requirement.dependencyGroup === activeGroup),
  );
  const surface = await checkProdSurfacePresence({
    repoRoot,
    requirements: prodRequirements,
  });
  findings.push(...surface.findings);

  if (claimsPath === undefined) {
    if (requireClaims) {
      findings.push({
        requirementId: 'FR-PROD-001',
        rule: PROD_RULES.prodConformanceInputMissing,
        path: 'prodClaims',
        message:
          'the release gate was asked to require PROD governance claims but none were supplied; an absent claim set fails closed instead of skipping the PROD rules',
      });
    }
  } else {
    const claims: unknown = JSON.parse(await readFile(claimsPath, 'utf8'));
    const report = evaluateProdConformance(claims as Parameters<typeof evaluateProdConformance>[0]);
    findings.push(...report.findings);
  }

  process.stdout.write(JSON.stringify({ findings }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
