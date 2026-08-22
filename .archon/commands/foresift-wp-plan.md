---
description: Scoped Spec Kit planning for exactly one Foresift work package
argument-hint: <package-id>
---

# Foresift work-package scoped planning

**Package**: $ARGUMENTS
**Artifacts**: $ARTIFACTS_DIR

You are the planning agent for ONE work package. You do not implement anything.

## Read first (in this order — all authoritative or binding)

1. `CLAUDE.md` — the operating contract. Its authority hierarchy binds you.
2. `specs/implementation/README.md` and `specs/implementation/current-milestone.json` —
   find the package object with `"id": "$ARGUMENTS"`. Its `requirementIds`,
   `objective`, `dependencies`, `risk`, and `writeScopes` are binding scope.
3. The authoritative PRD: `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md`.
   Read every section referenced by the package's requirements (the requirement
   manifest at `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`
   gives you each requirement's text, acceptance criteria, invariants, and line anchors).
   Also read any accepted ADRs relevant to these requirements.
4. Existing accepted ADRs under `docs/adr/` and `.specify/memory/constitution.md`
   (project constitution — never weaken it).
5. Current implementation state (repository tree, existing packages/*, apps/*).

## Produce a scoped Spec Kit plan

Create the Spec Kit feature directory `specs/$ARGUMENTS/` containing:

- `spec.md` — a **scoped derivative** of the authoritative contract for this
  package only: quote each assigned requirement's normative text with its ID,
  enumerate its acceptance criteria and applicable invariants from the manifest,
  and state explicit non-goals (everything in the milestone not assigned to this
  package). This file is subordinate to the PRD; mark it as such at the top.
- `plan.md` — implementation approach: architecture decisions, data model,
  module layout inside the package's `writeScopes`, verification strategy per
  acceptance criterion, and risks. Follow the Spec Kit planning methodology
  (constitution check, technical context, project structure) available in your
  loaded skills (`speckit-plan`) and `.specify/templates/`. Record material
  decisions as proposed ADR texts where they would bind future packages.
- `tasks.md` — an ordered, checkbox-task breakdown that traces every task to at
  least one requirement ID or acceptance criterion, including the tests required
  by the PRD's evidence rules (positive AND negative/failure-path tests where the
  manifest declares them). Run cross-artifact consistency analysis per the
  `speckit-analyze` methodology before finishing; fix what it finds.
- Write a condensed copy of plan + task list to `$ARTIFACTS_DIR/plan.md` and
  `$ARTIFACTS_DIR/plan-context.md` (files-to-change list, validation commands,
  patterns to mirror) so fresh contexts can execute without re-deriving context.

## Hard constraints

- Plan ONLY this package. Do not plan unrelated requirements; if you notice a gap
  outside scope, note it in `$ARTIFACTS_DIR/out-of-scope-notes.md` instead.
- Never propose trading execution, custody, wallet signing, private-key handling,
  or transaction submission — the prohibition is permanent (READ_ONLY_NO_TRADING_CUSTODY_SIGNING).
- Never edit anything under `docs/spec/**`.
- Respect `writeScopes`; supporting changes outside them must be justified in plan.md.
- Commit nothing. Leave all changes uncommitted in the working tree for review.

Finish your reply with a summary of the planned approach and the task count.
