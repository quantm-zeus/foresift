---
description: Decompose the next Foresift milestone into 2-8 work packages (Mode A)
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone decomposition (Mode A)

**Artifacts**: $ARTIFACTS_DIR

Determine the milestone to plan: run
`node scripts/automation/milestone-mode.mjs` and read its `milestoneId`. Then:

## Read first

1. `CLAUDE.md` — operating contract; its authority hierarchy binds this plan.
2. `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.md` — the
   authoritative PRD, especially every section containing requirements of group
   `<milestoneId>`, plus its accepted ADRs.
3. `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`
   — the machine manifest. Every requirement whose `dependencyGroup` equals the
   milestone must end up assigned to exactly one package.
4. `specs/implementation/roadmap.json` + `README.md` — policy constraints
   (2-8 packages, concurrency policy fields).
5. `.specify/memory/constitution.md`, existing ADRs under `docs/adr/`,
   `specs/implementation/history/**` (prior milestone lessons), and the current
   implementation state.

## Use Spec Kit planning methodology

Apply the constitution/planning discipline from your loaded skills
(`speckit-constitution` principles, `speckit-plan` methodology) — WITHOUT
creating a competing product spec. The PRD stays the sole product authority.

## Write the milestone plan

Create `specs/implementation/current-milestone.json` exactly in the schema
documented in `specs/implementation/README.md` with 2–8 outcome-oriented work
packages:

- Each package: a coherent outcome spanning related requirements (group by
  architectural cohesion and natural dependency order — e.g. contracts before
  runtimes before surfaces built on them).
- `dependencies`: only real ordering constraints between packages in THIS
  milestone; must be acyclic.
- `risk`: LOW/MEDIUM/HIGH/CRITICAL per blast radius. CRITICAL ⇒ parallelizable=false.
- `parallelizable`: conservative — true only when write scopes are clearly disjoint.
- `writeScopes`: glob patterns of directories/files the package may touch.
- `verificationCommands`: deterministic pnpm/node commands that will prove the
  package beyond the shared gate (package-specific test invocations etc.).
- Also update `specs/implementation/roadmap.json`: set `currentMilestoneId` to
  the milestone and its entry `status` to `"ACTIVE"`.
- Write a human-readable rationale to `$ARTIFACTS_DIR/milestone-plan-rationale.md`
  (why these packages, why these dependencies/risk ratings).

## Hard rules

- Do NOT decompose any future milestone. Only the selected one.
- Never assign a requirement to two packages; never leave one out; never invent
  requirement IDs not present in the manifest for this group.
- Preserve the permanent prohibited-capability boundary in every package objective.
- Commit nothing; leave changes uncommitted for review and landing.

End with a one-paragraph summary: milestone id, package count, the intended
execution order.
