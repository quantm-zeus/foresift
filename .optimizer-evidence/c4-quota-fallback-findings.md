# C4 — quota-fallback findings (§19 P2)

Tasking question: does the provider architecture safely support **approved
model fallback** on quota exhaustion? Rules any implementation must satisfy:
never overwrite user provider config; no silent downgrade for
CRITICAL/security-sensitive reasoning; auditable changes persisted in
execution evidence; no retry storm; no hidden fallback. If unsupported,
document the limitation.

## Current provider architecture (verified, 2026-08-23)

- Every Claude node runs the **exact user-configured Claude Code CLI**
  (`assistants.claude.claudeBinaryPath` in `~/.archon/config.yaml`) with its
  existing authentication/model/provider configuration
  (`.archon/workflows/foresift/README.md`, "Operating rules"). No foresift
  workflow or automation script passes `--model`, `ANTHROPIC_MODEL`, or any
  provider credential — verified by grep across `.archon/workflows/` and
  `scripts/automation/`.
- Quota handling is pause-and-resume, not substitution:
  `schema.mjs classifyQuotaFailure()` partitions failures into
  TRANSIENT / QUOTA_DAILY / FATAL; `extractQuotaResetAt()` reads
  provider-supplied reset timing; the autopilot tracks quota pauses as
  first-class state with verified resume effect and bounded probe backoff
  (`QUOTA_PROBE_BASE_MS` exponential cap). A paused run resumes the SAME
  configuration that paused.
- Execution evidence (autopilot state transitions, artifacts/runs, gate
  manifests) records commands, exit codes, SHAs, and category outcomes — it
  records **no model identity** for any node. Model selection lives entirely
  inside the user's CLI/provider config and is not part of the automation
  evidence chain.

## Verdict: approved model fallback is NOT safely supported today

Against each required rule:

1. **Never overwrite user provider config** — satisfiable only by adding a NEW
   opt-in fallback field to the orchestrator config. Archon v0.9.0's config
   schema exposes `claudeBinaryPath` but no model/fallback surface, so there
   is nowhere legitimate to record user approval. Any workaround would be a
   hidden side channel — prohibited by rule 5 by construction.
2. **No silent downgrade for CRITICAL / security-sensitive reasoning** —
   review, convergence repair, and FULL-gate verification nodes must never
   switch models implicitly. Enforcing this needs a phase→risk→model matrix at
   the executor layer; v0.9.0 has static per-node `model:` fields only, and
   per-node static selection cannot express "only after an explicit quota
   event, only for explicitly allowed phases."
3. **Auditable changes persisted in execution evidence** — automation writes
   no model identity anywhere in its evidence chain (and cannot observe what
   the CLI actually used without new executor instrumentation). A mid-run
   model substitution would be invisible to post-hoc audit → unsatisfiable
   today.
4. **No retry storm** — already satisfied by the existing bounded probe
   backoff + tracked pauses; a fallback layer would interact with probe
   scheduling and need its own bounds. No measured demand: every recorded
   quota pause to date recovered cleanly under pause-and-resume.
5. **No hidden fallback** — with rules 1–3 unmet, any implementable variant
   would necessarily be hidden from both config and evidence. Prohibited.

## Documented limitation

The control plane is deliberately **single-provider, single-model, as
configured by the user**. On quota exhaustion it pauses (tracked, recoverable)
and resumes the same configuration; it never substitutes models. This is the
fail-closed reading of §19 P2 given the architecture above.

## Revisit triggers

Implementing approved fallback becomes safe when ALL of the following exist:

- an executor/config surface where the USER declares a secondary model
  allowlist (approval recorded outside automation);
- per-node model-identity recording in execution evidence;
- phase-risk gating that keeps review/convergence/FULL-gate reasoning on the
  primary model unconditionally;
- bounded fallback attempts integrated with the existing probe backoff.

Until then this limitation stands; do not "improve" it by substituting models
at the CLI-config level, which would violate the operating rule that every
node runs the exact user-configured CLI with its existing provider settings.
