# Foresift

Foresift is a **greenfield implementation** of the Crypto Intelligence Agent Gateway
product contract: a read-only, security-bounded crypto intelligence and research
system specified by its authoritative PRD.

> **Status: bootstrap stage.** This repository currently contains the authoritative
> product specification, its verification tooling, and the spec-driven development
> foundation only. **No product functionality is implemented yet** — nothing here
> should be read as a claim that the product exists or works.

## Authoritative product specification

The normative product contract lives in [`docs/spec/`](docs/spec/) and is verified on
every CI run:

- `crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` — the authoritative PRD
  (human-readable contract, including its accepted ADRs and machine-manifest rules);
- `crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json` — the
  machine-readable requirement manifest (release-blocking index);
- `crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.audit.json` — integrity and audit
  artifact;
- `SHA256SUMS` — checksums over the artifacts above.

Run the integrity verifier locally with `pnpm spec:verify`. It fails on hash drift,
count disagreement, broken references, unresolved placeholders, or accidental legacy
branding outside migration provenance.

### Specification provenance

The specification was migrated byte-for-byte from the predecessor repository
`quantm-zeus/chain-sieve` at source commit
`81ee6f3102f7853113dbc0aea82a4ade9b538a25` (recorded 2026-08-22). Foresift shares no
code, Git history, tooling, or factory infrastructure with that repository — see
[`docs/migration/SPEC_MIGRATION.md`](docs/migration/SPEC_MIGRATION.md) for the full
migration record, exclusions, and integrity reconciliation.

## Development stack

```text
Authoritative Product Specification   docs/spec/
                ↓
         GitHub Spec Kit              .specify/ + .claude/skills/speckit-* (v1.0.1)
                ↓
             Archon                   ~/.archon + .archon/workflows/foresift/ (v0.9.0)
                ↓
        Claude Code CLI               user-installed; pinned via Archon config (v2.1.239)
                ↓
Future Autonomous Implementation      .archon/workflows/foresift/README.md
```

- **GitHub Spec Kit** provides spec-driven development (constitution, planning,
  tasks, implementation, convergence) under the authority of the imported PRD.
- **Archon** orchestrates deterministic multi-session autonomous workflows.
- **Claude Code** is the coding agent; Archon launches the exact user-configured
  Claude CLI (`assistants.claude.claudeBinaryPath` in `~/.archon/config.yaml`) so the
  existing authentication, model, and provider configuration is preserved.

## Repository layout

```text
docs/spec/          authoritative product contract (normative — do not hand-edit hashes)
docs/migration/     migration provenance record
docs/setup/         bootstrap report
scripts/            deterministic verification tooling
tests/              repository verification tests
apps/, packages/    future workspace packages (empty at bootstrap)
.specify/           Spec Kit installation
.claude/            Claude Code skills (Spec Kit + Archon)
.archon/            Archon workflow location for the future autonomous pipeline
```

## Verification

```bash
pnpm install        # pinned Node 24 + pnpm (see package.json engines / packageManager)
pnpm spec:verify    # specification integrity (hashes, counts, references, branding)
pnpm format:check   # Prettier
pnpm lint           # ESLint
pnpm typecheck      # TypeScript strict
pnpm test           # Vitest
pnpm verify         # everything above
```

GitHub Actions runs the same gate on every push to `main` and every pull request.

## Permanent product boundary

Foresift will never include trading execution, custody, wallet signing, private-key
handling, or transaction submission. The PRD's prohibited-capability policy
(`READ_ONLY_NO_TRADING_CUSTODY_SIGNING`) is a permanent constraint of this project.

## Autonomous development

Foresift develops itself: the authoritative PRD flows through GitHub Spec Kit
and Archon into work packages that are implemented, independently reviewed,
deterministically verified, and squash-merged without human approval. See
`docs/automation/AUTOPILOT.md` (operations), `specs/implementation/`
(version-controlled planning state), and `docs/adr/0001-autonomous-control-plane-architecture.md`.
