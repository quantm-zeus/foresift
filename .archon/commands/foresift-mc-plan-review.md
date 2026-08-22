---
description: Independent fresh-context review of the drafted milestone plan
argument-hint: plan-or-audit-current-milestone
---

# Foresift milestone plan review (independent)

**Artifacts**: $ARTIFACTS_DIR

You are an independent planning reviewer in a fresh context. You did not write
the draft; attack it. You do not fix anything — you report.

## Review inputs

- `specs/implementation/current-milestone.json` (the draft) and
  `specs/implementation/roadmap.json` (+ `specs/implementation/README.md` schema).
- The authoritative manifest:
  `docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json`.
- Relevant PRD sections for the milestone's requirements, accepted ADRs,
  `.specify/memory/constitution.md`, prior milestone history under
  `specs/implementation/history/`, and the current implementation state.
- Rationale: `$ARTIFACTS_DIR/milestone-plan-rationale.md`.

## Check at minimum

1. **Coverage**: every manifest requirement of this dependency group assigned to
   exactly one package — none missing, none duplicated, no invented IDs.
2. **Coherence**: each objective is a genuine outcome; requirement grouping is
   architecturally sound; dependencies form a sane DAG without artificial serial
   chains or hidden cycles.
3. **Risk honesty**: ratings reflect real blast radius (central/shared surfaces,
   security/cost controls, data truth ⇒ HIGH/CRITICAL); CRITICAL packages are
   parallelizable=false.
4. **Scope discipline**: writeScopes specific and disjoint where parallelizable;
   verificationCommands deterministic and actually runnable in CI/local gates.
5. **Policy compliance**: 2–8 packages; roadmap.json updates consistent;
   prohibited-capability boundary intact in every objective.
6. **Spec Kit fit**: decomposition supports scoped per-package Spec Kit planning
   and convergence later.

## Output

Write findings to `$ARTIFACTS_DIR/milestone-plan-review.md` with sections
`CRITICAL`, `HIGH`, `MEDIUM`, `LOW` (or "no findings"). Each finding: what is
wrong, evidence (file + requirement IDs), and a concrete suggested correction.
End your reply with the counts per severity.
