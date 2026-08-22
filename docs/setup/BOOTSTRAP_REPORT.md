# Foresift bootstrap report

Date: 2026-08-22 · Executed autonomously via Claude Code CLI.

> **Historical vs current state.** Everything below the line
> "Part 1 — historical record" is the point-in-time narrative of the original
> bootstrap (some details were since superseded). For what is true NOW, read
> this section first.

## Current state (2026-08-22, post-hardening)

| Aspect                    | State now                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control plane             | Operational. Autonomous development control plane landed via PRs #1–#4 (supervisor, workflows, gates, restart-safe systemd units).                                                                                                                                                                                                                                   |
| Continuation loops        | All long workflow stages are bounded fresh-context loops under deterministic `until_bash` guards; proven live by `foresift-smoke-clean-turn` and `foresift-smoke-resume`.                                                                                                                                                                                            |
| Supervisor hardening      | Detached run-ID discovery is bounded + fail-closed (no duplicate launches; `PENDING→RUNNING` only with a durable run id); timestamps normalized (`normalizeTimestampMs`); corrupt implementation state → PAUSED_FATAL, never silent re-plan; unparsable activity timestamps are diagnostics, never abandons. Selftest covers S1–S10 hermetically.                    |
| Constitution              | `.specify/memory/constitution.md` v1.0.0 ratified 2026-08-22 — subordinate to the PRD, 18 binding principles incl. the permanent read-only boundary.                                                                                                                                                                                                                 |
| Product implementation    | Still none — G0 planning/implementation had not started at last update of this section; check `pnpm autopilot:status` and `specs/implementation/**` for live truth.                                                                                                                                                                                                  |
| Dashboard                 | Archon dashboard binds loopback-only (`127.0.0.1:3090`). Public HTTPS auth-proxy deployment was attempted 2026-08-22 but is **PAUSED**: the VM service account lacks compute scopes to promote IP `34.87.12.208` to static or manage firewall rules. Exact blocker + command recorded in the hardening PR description. SSH tunnel remains the supported access path. |
| CI / branch protection    | See Part 1 status below; billing/protection limitations unchanged unless the account has since been upgraded.                                                                                                                                                                                                                                                        |
| Known-limitation #5 below | Superseded: `.archon/mcp/ntfy.json` now exists as an explicit empty `{}` config so bundled-workflow validation passes without configuring any notification MCP.                                                                                                                                                                                                      |

---

## Part 1 — historical record (bootstrap day)

## Status

**Bootstrap complete.** The repository contains the authoritative product specification,
its integrity verification tooling, a pinned Node/pnpm/TypeScript foundation, fresh Spec
Kit and Archon integrations, the Claude operating contract, and CI. **No product
functionality is implemented** — Foresift is at bootstrap stage by design.

## Provenance

| Field                                    | Value                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source ChainSieve repository             | `quantm-zeus/chain-sieve`                                                                                                                                                                                                                                                                                                                                                         |
| Source ChainSieve commit SHA             | `81ee6f3102f7853113dbc0aea82a4ade9b538a25` (main, merged PR #183)                                                                                                                                                                                                                                                                                                                 |
| Migration timestamp                      | 2026-08-22                                                                                                                                                                                                                                                                                                                                                                        |
| Migrated artifacts                       | `docs/spec/{crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md,.requirements.json,.audit.json}` + `SHA256SUMS` — byte-for-byte identical to source (verified by SHA-256 before first commit); full record in [`docs/migration/SPEC_MIGRATION.md`](../migration/SPEC_MIGRATION.md)                                                                                                |
| Intentionally excluded legacy components | old product implementation (`apps/**`, `packages/**`, `tests/**`), autonomous factory (`factory/**`, `tools/**`, `tasks/**`, `clusters/**`, `artifacts/**`), task leasing/fencing/merge-queue lifecycle, Agent Orchestrator integration, `.agents/**`, `.specify/**`, `.claude/**`, old factory ADRs, old docs/configs — see SPEC_MIGRATION.md for the complete list with reasons |

## Branding transformations

- Product/repository renamed to **Foresift** across repository metadata, docs, tooling, CI.
- The authoritative PRD required **zero content edits**: it is branded "Crypto Intelligence
  Agent Gateway" and contained no occurrences of the old project brand, so all recorded
  hashes stayed valid without regeneration.
- Normative IDs (`FR-*`, `AC-*`, `INV-*`, `ADR-*`, document ID `CIAG-PRD-FINAL`,
  dependency groups `G0`–`G7`) intentionally unchanged.
- Legacy-brand references remain only in migration-provenance locations
  (`docs/migration/**`, one source-repo pointer in `README.md`), enforced by
  `pnpm spec:verify`.

## Specification integrity result

`pnpm spec:verify` → **PASS (13 checks)** at the pushed commit, re-verified from a clean
clone. Enforced: SHA256SUMS ↔ artifact bytes; audit-recorded PRD/manifest hashes;
normalized-hash cross-artifact consistency; document byte/line counts; four-way count
agreement (397 requirements / 204 acceptance criteria / 44 invariants / 58 ADRs);
per-entry text hashes (703 recomputed); line-anchor resolution for every normative ID;
ID uniqueness; reference integrity; dependency-group DAG acyclicity; API-route and
persistence-entity uniqueness (181 / 286); placeholder scan; legacy-branding allowlist
scan. Historical audit results are preserved as provenance; deterministic properties are
re-derived on every run. Honest limitation: the original normalized-hash sentinel
algorithm is not recoverable from the source repo (details in SPEC_MIGRATION.md).

## Installed toolchain (exact versions)

| Tool            | Version                                                                | Notes                                                                      |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Node.js         | **v24.19.0**                                                           | pinned via `.nvmrc` + `.node-version` + `engines`; nvm-managed, user-level |
| pnpm            | **11.22.0**                                                            | pinned via `packageManager` + `engines`; lockfile committed                |
| TypeScript      | **5.9.3**                                                              | strict mode (`tsconfig.base.json`)                                         |
| ESLint          | 10.9.0 (flat config) + typescript-eslint 8.67.0                        |                                                                            |
| Prettier        | 3.9.6                                                                  | normative `docs/spec/**` excluded from formatting                          |
| Vitest          | 4.1.11                                                                 | 3 tests incl. negative tamper cases                                        |
| @types/node     | 26.2.0 · globals 17.11.0                                               |                                                                            |
| uv              | 0.12.5                                                                 | installed via official installer (user-level)                              |
| GitHub Spec Kit | **specify-cli 1.0.1** (release tag `v1.0.1`, build commit `9118ed15a`) | installed pinned via `uv tool install --from git+…@v1.0.1`                 |
| Archon          | **Archon CLI v0.9.0** (build commit `671e2ee7`, linux-x64 binary)      | official release installer with checksum verification                      |
| Claude Code     | **2.1.239** at `/home/minhquan_eth/.local/bin/claude`                  | pre-existing installation untouched                                        |

Deviation note: TypeScript `latest` is 7.0.2, but typescript-eslint 8.67.0 (current
stable) supports `<6.1.0`; 5.9.3 is the newest compatible stable. Upgrade path noted.

## Archon configuration

- `archon doctor` reports: `✓ Claude binary: /home/minhquan_eth/.local/bin/claude (via
config, spawns OK)` — the exact user-installed Claude CLI is pinned through
  `assistants.claude.claudeBinaryPath` in `~/.archon/config.yaml`.
- Existing Claude authentication/model/provider configuration preserved (nothing about
  the Claude installation was replaced or reset).
- Project integration installed via `archon skill install`: `.claude/skills/archon`,
  `.claude/skills/manage-run`, `.agents/skills/**`.
- Future autonomous pipeline location prepared: `.archon/workflows/foresift/README.md`
  (workflow intentionally not implemented yet).
- `archon validate workflows`: all bundled defaults validate (upstream optional-MCP /
  built-in-skill notices only); the `foresift/` package contains no YAML yet by design.

## Repository

| Field          | Value                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| URL            | https://github.com/quantm-zeus/foresift                                               |
| Visibility     | private                                                                               |
| Default branch | `main`                                                                                |
| Initial commit | `bf0523c34bbef8997edf1848220c01c34b8a6391` (fresh history; no ChainSieve Git objects) |
| Remote origin  | `git@github.com:quantm-zeus/foresift.git`                                             |

## Verification results

| Check                                                        | Result                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` (frozen lockfile, clean clone of pushed HEAD) | PASS                                                                                                                                                                            |
| `pnpm spec:verify`                                           | PASS — 13 checks                                                                                                                                                                |
| `pnpm format:check` / `lint` / `typecheck` / `test`          | PASS (3 tests)                                                                                                                                                                  |
| `pnpm verify` (aggregate)                                    | PASS locally and in clean-room clone of pushed HEAD                                                                                                                             |
| Secret scan                                                  | PASS — only documentation prose matches credential-pattern keywords; no secrets committed (no `.env`, tokens, keys, or auth state anywhere in history — it is the first commit) |

## CI status

⚠️ **Blocked by an external GitHub account-billing limitation — not by bootstrap work.**

Run [32579429681](https://github.com/quantm-zeus/foresift/actions/runs/32579429681)
failed in 5s with the GitHub annotation:

> "The job was not started because recent account payments have failed or your spending
> limit needs to be increased. Please check the 'Billing & plans' section in your settings"

The job never executed any step (zero steps ran). As substitute evidence, the exact
pushed HEAD was clean-cloned and fully verified locally (table above). Once billing is
resolved, re-run the workflow (`gh run rerun 32579429681`) or open any PR; the workflow
definition itself mirrors the locally passing commands exactly.

## Branch protection / auto-merge status

Configured successfully:

- default branch = `main`;
- squash-only merge (merge commit and rebase merge disabled);
- automatic branch deletion after merge enabled.

Not permitted by the current plan (**private repository on a free GitHub account** — API
returns `403 "Upgrade to GitHub Pro or make this repository public"`):

- repository rulesets on `main` (required PR, 0 approvals, required CI check,
  force-push/delete prohibition);
- classic branch protection (same refusal);
- `allow_auto_merge` (auto-merge toggle rejected).

Recorded as plan limitations rather than worked around unsafely. Compensating controls
in force now: CI runs on every push to `main` and every pull request and fails loudly;
the `CLAUDE.md` git-history contract prohibits direct-main writes, amend, rebase, and
force pushes for all agent work. When the account upgrades to GitHub Pro (or the repo
becomes public), apply the intended ruleset: required PR with 0 approvals, required
check `Verify (spec, format, lint, types, tests)`, deletion + non-fast-forward
prohibited (definition preserved in this report's Git history).

## Known bootstrap limitations

1. GitHub Actions execution blocked by account billing (see above).
2. Branch rulesets / protection / auto-merge unavailable on free private repos (see above).
3. Original manifest-generator normalized-hash algorithm unrecoverable; verifier enforces
   consistency instead of recomputation (SPEC_MIGRATION.md).
4. TypeScript pinned to 5.9.3 pending typescript-eslint support for TS ≥ 6.
5. Archon's bundled `archon-smart-pr-review` workflow expects an optional
   `.archon/mcp/ntfy.json` (notification MCP) that is intentionally not configured.
   _(Superseded 2026-08-22: the file now exists as an explicit empty `{}` config.)_

## Recommended next action

1. Resolve GitHub Actions billing/spending limit (Settings → Billing & plans), then
   `gh run rerun 32579429681 --repo quantm-zeus/foresift` — expected green.
2. If/when the account has GitHub Pro, apply the `main-autonomous-ci-gate` ruleset
   described above.
3. Begin G0 planning: use Spec Kit `/speckit-constitution`, then plan the first
   dependency-group work packages strictly under the authority of `docs/spec/`.
   _(Superseded 2026-08-22: G0 planning is now driven autonomously by the
   autopilot via `foresift-milestone-control`; see "Current state" above and
   docs/automation/AUTOPILOT.md.)_
