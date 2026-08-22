# Foresift autonomous implementation workflow (reserved location)

This directory is the reserved home for the future Foresift autonomous
implementation pipeline as an [Archon](https://github.com/coleam00/Archon)
packaged workflow (`archon workflow run foresift/<name>` once defined).

**Status: bootstrap stage — the workflow itself is intentionally NOT implemented
yet.** This bootstrap only prepares the location so the pipeline can be added
without restructuring.

## Intended pipeline

```text
select next eligible dependency package   (from the PRD manifest dependency groups G0..G7)
                ↓
fresh Claude planning session             (Spec Kit plan artifacts under the PRD's authority)
                ↓
fresh Claude implementation session       (one dependency package per isolated session)
                ↓
deterministic verification                (pnpm verify + spec:verify + acceptance evidence)
                ↓
Spec Kit convergence                      (/speckit-converge against plan and contract)
                ↓
fresh independent review session          (reviewer never continues the implementer's context)
                ↓
repair loop if required                   (new additive sessions; no history rewriting)
                ↓
CI                                        (.github/workflows/ci.yml is the machine merge gate)
                ↓
automatic merge                           (squash; branch auto-delete; zero human approvals)
                ↓
next eligible dependency package
```

## Operating rules the workflow must uphold

- The authoritative contract is `docs/spec/` (PRD + requirement manifest +
  audit artifact). Implementation must never override it.
- Every Claude node runs with the exact user-configured Claude Code CLI
  (`assistants.claude.claudeBinaryPath` in `~/.archon/config.yaml`) and its
  existing authentication/model/provider configuration.
- Sessions are fresh and independent; planning, implementation, review, and
  repair never share a context window.
- Corrections use additive commits on PR branches; no amend/rebase/force-push.
- The product remains read-only for markets: no trading execution, custody,
  wallet signing, private-key handling, or transaction submission.

## Layout

Packaged workflows keep their YAML, `commands/`, and `scripts/` together in
this folder (Archon ≥ 0.9 packaged-workflow discovery). Add:

- `<workflow>.yaml` — the DAG definition;
- `commands/` — command bodies referenced by nodes;
- `scripts/` — deterministic helper scripts referenced by `script:` nodes.

Validate after adding definitions with:

```bash
archon validate workflows foresift/<name>
archon workflow run <name> --dry-run   # simulate without provider spend
```
