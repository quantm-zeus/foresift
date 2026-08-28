# Foresift — Claude Code operating contract

Foresift is a greenfield implementation of the **Crypto Intelligence Agent Gateway**
product contract. This file governs every Claude session working in this repository.

## Authority hierarchy

When sources conflict, the higher entry wins:

1. **Authoritative product contract** — `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`
   (including its inline accepted ADRs and appendices).
2. **Machine-readable requirement manifest** — `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`
   (release-blocking index; integrity enforced by `pnpm spec:verify`).
3. **Accepted ADRs recorded in this repository** — but only those that do not weaken
   the product contract. Record new material decisions as ADRs under `docs/adr/`.
4. **Correct executable verification** — tests, `pnpm spec:verify`, CI.
5. **Current implementation.**

Existing implementation must never override the PRD. Do not weaken, omit, silently
reinterpret, or edit authoritative requirements to make implementation easier. If
authoritative documents materially conflict, record the conflict and the chosen
resolution instead of silently changing product intent.

## Greenfield rule

The predecessor repository's implementation is **not a source of truth**. Do not copy
its architecture merely because it existed. Its only legacy role is migration
provenance, recorded in `docs/migration/SPEC_MIGRATION.md`. Design from the PRD.

## Spec-driven development

- GitHub Spec Kit (`.specify/`, `.claude/skills/speckit-*`) drives constitution,
  planning, work-package specifications, tasks, implementation, and convergence.
- Spec Kit artifacts operate **under** the authority of the imported PRD. Never run
  spec generation in a way that replaces or competes with `docs/spec/` as the
  source of truth.
- Archon (`.archon/`) orchestrates deterministic multi-session workflows. The
  future autonomous pipeline is specified in `.archon/workflows/foresift/README.md`.

## Agent autonomy

Resolve routine engineering decisions autonomously — dependencies, refactoring,
file layout, test structure, naming, tooling choices. Do not delegate routine
decisions back to the owner.

When the specification contains a genuine ambiguity:

1. inspect all relevant authoritative material;
2. choose the safest coherent interpretation;
3. prefer read-only, fail-closed, least-privilege behavior;
4. record an ADR for material decisions;
5. continue implementation whenever possible.

## Permanent product security boundary

The product is a read-only intelligence and research system. Never introduce:

- trading execution
- custody
- wallet signing
- private-key handling
- transaction submission

The PRD's prohibited-capability policy (`READ_ONLY_NO_TRADING_CUSTODY_SIGNING`) is
permanent. Never weaken verification, security, or product authority to obtain a
passing result.

Never commit credentials, tokens, API keys, wallet keys, or authentication state.
`.env` files are git-ignored; only `.env.example` placeholders may be committed.

## Completion standard

A task is not complete merely because the code compiles, tests pass, or you believe
you are done. Completion requires the relevant specification, acceptance criteria,
invariants, integration verification, and required evidence to converge — including
`pnpm verify` and `pnpm spec:verify` passing at the pushed HEAD.

## Test runtime contract

The complete Bun suite runs ONLY through the coordinator: `pnpm test:all` or the
per-workload scripts (`test:pure`, `test:process-meta`, `test:pglite`). A bare
`bun test` over the full tree runs in one process without isolation; the
DATABASE_PGLITE suites accumulate PGlite instances across files and will OOM a
15 GiB host (observed 2026-08-28). Targeted suites (e.g. `test:state-control-plane`,
`bun test <specific files>`) are fine.

## Git history contract

Normal autonomous work must not use:

- `git commit --amend`
- `git rebase` on published branches
- `git push --force` / `git push --force-with-lease`

Corrections are additive commits followed by a normal push. Source changes reach
`main` only through pull requests; CI is the primary merge gate.
