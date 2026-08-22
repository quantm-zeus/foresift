# Foresift specification migration record

This document records how the authoritative product specification was migrated from the
ChainSieve repository into the greenfield Foresift repository.

## Provenance

| Field                  | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Source repository      | `quantm-zeus/chain-sieve` (public GitHub repository)                        |
| Source default branch  | `main`                                                                      |
| Source HEAD commit SHA | `81ee6f3102f7853113dbc0aea82a4ade9b538a25`                                  |
| Source HEAD subject    | `Merge pull request #183 from quantm-zeus/fix/factory-v2-production-repair` |
| Migration timestamp    | 2026-08-22 (UTC date of migration execution)                                |
| Target repository      | `foresift` (fresh Git history; no ChainSieve commits, tags, or refs)        |

## Migrated files (authoritative product contract)

All four artifacts were copied **byte-for-byte** from the source commit. SHA-256 values
were verified identical to the source checkout before the first Foresift commit, and the
copied set validates against the migrated `SHA256SUMS`.

| File                                                                           | Role                                                                                                              | SHA-256                                                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`                | Authoritative PRD — the human-readable product contract                                                           | `baa521d9c67e67a86d7ddb111c793b67462ed4c7acc89cec34ab9f5ade077299`                                         |
| `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json` | Machine-readable requirement manifest (release-blocking index per PRD Appendix V.1)                               | `e0f9f1284473fe097fde591138d16984ae8580feaf13333e22594717eec690ff`                                         |
| `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json`        | External audit / integrity artifact recording document, manifest, and normalized hashes plus review-cycle results | `ab4be13b6aeac998f13daa89ae08f4b9f5d6280b4018bd171b7b128b412a47f8`                                         |
| `docs/spec/SHA256SUMS`                                                         | Checksum manifest over the three artifacts above                                                                  | `11330be1d30ce0f6ff885d859f7c1fb578a763f74e81ff2baeab8554f` (file-of-files; per-entry hashes listed above) |

These are the complete normative set. PRD Appendix V ("Machine-readable requirement
manifest and conformance contract") defines exactly this contract: the Markdown document,
its generated manifest, the external audit artifact carrying the exact released-artifact
hash, and their verification during release.

### Why the artifacts could migrate byte-for-byte

The authoritative specification is branded **"Crypto Intelligence Agent Gateway"**
(document ID `CIAG-PRD-FINAL`). A full scan of all four artifacts for
`chainsieve` / `chain-sieve` / `chain_sieve` (case-insensitive) found **zero
occurrences**. The PRD therefore required no rebranding edits, and every integrity value
recorded at source commit — PRD artifact SHA-256, manifest SHA-256, audit hashes,
normalized document hash, document byte/line counts, and the SHA256SUMS entries —
remains valid against the migrated bytes without regeneration.

### Product naming

The product/repository name **Foresift** is applied to repository metadata, documentation,
tooling, and workflow configuration created by this bootstrap. The PRD's internal product
title and document ID are stable normative identifiers and were deliberately left
unchanged, per the migration rule that identifiers whose semantics must remain stable
(document IDs, requirement IDs, schema IDs) are not rebranded.

## Intentionally excluded files and components

Everything below was inspected and deliberately **not** migrated. Exclusions follow the
rule: product requirements migrate; old-implementation and old-workflow artifacts do not.

| Excluded                                                                                                                                                                                                                                                                                                                                                                                                                        | Reason                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                                                                                                                                                                                                                                                                                                                                                                                     | Legacy repository operating contract for the old autonomous factory (lease/fencing/merge-queue era). Replaced by Foresift `CLAUDE.md`.                                                                                                                                        |
| `specs/factory/**` (incl. `product-map.md`)                                                                                                                                                                                                                                                                                                                                                                                     | Describes the _old implementation's_ reusable surfaces and the legacy factory replacement project. Implementation artifact, not product requirement.                                                                                                                          |
| `.agents/**`                                                                                                                                                                                                                                                                                                                                                                                                                    | Legacy agent skills for the old task lifecycle (`chainsieve-task`). Explicitly out of scope.                                                                                                                                                                                  |
| `.claude/**`, `.specify/**`, `specs/**`                                                                                                                                                                                                                                                                                                                                                                                         | Old Spec Kit installation and agent artifacts. Foresift installs fresh, current-version Spec Kit and Archon integrations.                                                                                                                                                     |
| `factory/**`, `tools/**`, `tasks/**`, `clusters/**`, `artifacts/**`, `config/**`, `infra/**`                                                                                                                                                                                                                                                                                                                                    | The legacy autonomous factory: task acquisition/leasing/fencing, cluster orchestration, merge queue, generated task lifecycle, worktree manager, agent orchestrator integration, and their generated state. Explicitly non-goals.                                             |
| `agent-orchestrator.yaml`, `prompt.md`, `docs/factory/**`, `docs/operations/**`, `docs/implementation/**`, `docs/prompts/**`, `docs/runbooks/**`, `docs/zcode-execution-guide.md`, `docs/codex-cluster-review-guide.md`, `docs/cluster-contract-guide.md`, `docs/task-contract-guide.md`, `docs/migration-workflow.md`, `docs/implementation-workflow.md`, `docs/release-and-capability-workflow.md`, `docs/provider-rights/**` | Old orchestration/workflow/operations documentation for the previous development machine. Not product requirements.                                                                                                                                                           |
| `docs/adr/ADR-BOOTSTRAP-001.md`, `docs/adr/ADR-FACTORY-002-OSS-CONTROL-PLANE.md`                                                                                                                                                                                                                                                                                                                                                | Old-implementation decisions (test-database emulator strategy; legacy factory control-plane replacement). Foresift records its own ADRs as decisions arise. The 58 product ADRs accepted in the PRD (Appendix D) are part of the migrated PRD itself.                         |
| `docs/schemas/**`                                                                                                                                                                                                                                                                                                                                                                                                               | JSON Schemas generated for the old factory's task/cluster contracts. Foresift regenerates its own contract schemas when implementation planning requires them.                                                                                                                |
| `docs/generated/**`                                                                                                                                                                                                                                                                                                                                                                                                             | CI-compared _generated release artifacts_ defined by PRD §42.3 (requirements.json, release-conformance.json, openapi.json, etc.). Derived outputs of the future Foresift implementation pipeline — not inputs. Regenerating them now would fabricate implementation evidence. |
| `apps/**`, `packages/**`, `tests/**`, `test-data/**`, `playwright.config.ts`, `vitest*.config.ts`, `eslint.config.js`, `docker-compose*.yml`, `pyproject.toml`, root build configs                                                                                                                                                                                                                                              | Old product implementation. Greenfield rule: Foresift implements the PRD from scratch; no source code is carried over.                                                                                                                                                        |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, `.nvmrc`, `.node-version`, `.npmrc`, `.prettier*`                                                                                                                                                                                                                                                                                                    | Old toolchain pins. Foresift pins its own current stable versions (Node 24 LTS, current pnpm).                                                                                                                                                                                |
| `.env.example`, `.dockerignore`, `.gitignore`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `INVARIANTS.md`, `SECURITY.md`                                                                                                                                                                                                                                                                                                             | Old-repo metadata describing the old implementation. Foresift writes its own. (Product invariants live normatively inside the migrated PRD; `INVARIANTS.md` was only a pointer summary.)                                                                                      |
| `tools/prd-compiler/**`                                                                                                                                                                                                                                                                                                                                                                                                         | Old factory compiler that generated task/cluster/context artifacts from the manifest. Its _validation_ logic was studied and re-implemented cleanly as Foresift's product-neutral `scripts/spec-verify.mjs`; none of the factory code was copied.                             |

## Branding transformations performed

| Location                                                                                        | Transformation                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Repository name, Git remote, GitHub metadata                                                    | `chain-sieve` → `foresift` (new private repository)                                                                     |
| Product name in all new documentation (`README.md`, `CLAUDE.md`, workflow configs, CI, scripts) | ChainSieve → Foresift                                                                                                   |
| Authoritative PRD content                                                                       | **No changes** — zero old-branding occurrences existed; byte-for-byte migration preserves all recorded integrity values |
| Normative IDs (`FR-*`, `AC-*`, `INV-*`, `ADR-*`, `CIAG-PRD-FINAL`, dependency groups `G0`–`G7`) | **Unchanged** — stable identifiers whose semantics must not drift                                                       |
| Migration provenance references (this file)                                                     | Retain the name `chain-sieve`/ChainSieve solely to identify the source repository and the excluded legacy components    |

## Integrity regeneration and verification

Because no byte of the normative set changed, no integrity value required regeneration.
`SHA256SUMS` re-validates the migrated set as-is, and the audit artifact's recorded hashes
match the migrated files exactly.

`pnpm spec:verify` (implemented in `scripts/spec-verify.mjs`) independently re-derives and
enforces, on every run:

1. required specification files exist;
2. actual SHA-256 of each artifact matches `SHA256SUMS`;
3. `audit.hashes.documentArtifactSha256` matches the PRD bytes;
4. `audit.hashes.requirementManifestSha256` matches the manifest bytes;
5. `manifest.document.normalizedSha256` is consistent across manifest and audit;
6. document byte/line counts in the audit inventory match the actual PRD;
7. manifest counts (requirements, acceptance criteria, invariants, ADRs) match the audit
   inventory and the manifest's own `releaseConformance` block (three-way agreement);
8. per-entry `textSha256` values recompute correctly for all 397 requirements, 204
   acceptance criteria, 44 invariants, and 58 ADRs;
9. source line anchors in the manifest resolve to lines containing the normative ID;
10. normative ID uniqueness, `FR-*` ID shape, reference integrity
    (requirement↔acceptance, requirement→invariant, requirement→dependency group),
    and acyclicity of the dependency-group DAG;
11. API route and persistence-entity uniqueness within the PRD's normative sections;
12. no unresolved placeholders (`{{...}}`, `<TBD>`) in the PRD;
13. no accidental `chainsieve`/`chain-sieve`/`chain_sieve` branding outside the
    provenance allowlist (`docs/migration/**` and `docs/setup/**` in full, plus the
    single source-repository provenance pointer in `README.md`).

### Normalized-hash provenance note (honest limitation)

PRD Appendix V.2 defines the normalized document hash as a SHA-256 "computed after
replacing only Appendix L generated inventory/status values and their hashes with fixed
sentinel tokens." The original generator that produced
`documentNormalizedSha256 = 1f9b6590c8331dd52ae63c51a93e8e6b631b3a70c37df3e619486e1779e2db8e`
is **not present in the source repository** (only the validator is), and the exact
sentinel-token scheme is not recoverable from the artifacts alone. Several plausible
sentinel substitutions were attempted against the original bytes; none reproduced the
recorded value.

Rather than fabricate a match, Foresift records the following:

- The recorded `normalizedSha256` is preserved **as provenance** of the original
  generation toolchain, applied to the identical bytes that Foresift now hosts.
- `spec:verify` enforces cross-artifact _consistency_ of the normalized hash (manifest ↔
  audit) rather than recomputing it with an unverified algorithm.
- The historically verified semantic/structural audit results in `audit.json`
  (`reviewCycles`, `checks`, `status`) are preserved verbatim as historical evidence about
  this exact document (same SHA-256), so they remain accurate claims about the migrated
  bytes. Deterministic, machine-recheckable properties (hashes, counts, uniqueness,
  placeholders, references) are revalidated on every `pnpm spec:verify` run rather than
  trusted from the historical audit.

If the original manifest generator is later recovered, the normalization check can be
upgraded to full recomputation without changing the normative set.
