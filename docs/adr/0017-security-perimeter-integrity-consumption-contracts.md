# ADR-0017: Security-perimeter integrity and consumption contracts (convergence round 2)

- Status: Accepted
- Date: 2026-08-25
- Relates to: FR-SEC-005 (untrusted content, webhooks), FR-SEC-011 (incidents), FR-SEC-001
  (credential lifecycle), §35.4–§35.6, §35.12; ADR-0006 (throughput profiles); convergence
  round 2 consolidated review findings M4/M5/M6/M10/M14/L12

## Context

Convergence round 2 hardened several refusal paths across the g0 security perimeter. Four of
those hardenings are not local code details — each fixes the SHAPE of a contract other layers
must build against, which makes them material decisions deserving a recorded ADR:

1. Untrusted-content extraction fences were originally matched by tag shape alone, so a forged,
   duplicated, or preamble-stripped fence could pass structural inspection.
2. Incident containment transitions were read-modify-write, so two concurrent operators could
   regress containment (e.g. write CONTAINED over RESOLVED).
3. Credential presentation refused revoked/expired/constrained credentials but did not state a
   position on requests withholding presentation context (source IP, origin, requested scopes).
4. Webhook replay protection shipped only an in-memory per-process cache; its deployment scope
   needed an explicit contract plus a consultable seam before wiring exists.

## Decision

1. **Nonce-matched fences are THE untrusted-content consumption contract.** Every extraction
   envelope is emitted with a random UUID nonce bound into BOTH its BEGIN and END markers
   (`[BEGIN UNTRUSTED:<SOURCE> nonce="…" provenance="…"]` / `[END UNTRUSTED:<SOURCE>
   nonce="…"]`). Consumption parses ONLY through this format and refuses, fail-closed: mismatched
   begin/end nonces, repeated END markers, preamble-stripped or re-labeled fences, unknown
   sources, and oversized inputs. Anything that consumes untrusted-derived content must consume
   it through this fence format — no parallel ad-hoc delimiting scheme may be introduced.
2. **Containment transitions are CAS-guarded.** Every incident containment transition lands
   through an SQL compare-and-swap (`WHERE containment = <observed>`); a zero-row update raises a
   typed raced-transition refusal instead of overwriting. Containment may advance but never
   regress, whatever the calling pattern or concurrency.
3. **Evidence-withheld presentations refuse by default; `strictPresentation` is opt-in
   hardening.** A credential whose policy constrains source IP, origin, or requested scopes
   refuses a presentation that omits the corresponding evidence (withholding evidence is treated
   as failing the constraint, never as passing it). Deployments MAY additionally enable
   `strictPresentation`, which requires complete presentation evidence for EVERY credential use,
   including unconstrained ones. Guidance: enable it where the deployment cannot tolerate
   partial-evidence auditing; the default keeps unconstrained credentials usable while still
   refusing constrained ones with withheld evidence.
4. **Webhook replay protection has an explicit two-tier scope contract.** The built-in dedupe
   cache is deliberately in-memory and per-process (bounded replays within one process lifetime;
   documented capacity eviction order). Cross-restart/replica immunity is the wiring layer's
   duty through the `WebhookDedupeStore` seam: the guard consults shared durable state beside
   its local cache, persists the dedupe key (`eventId:sha256(payloadBytes)` — the persistence
   contract) BEFORE returning success (durable-before-ack), refuses fail-closed when the backing
   store cannot answer (`SEC_WEBHOOK_DEDUPE_STATE_UNAVAILABLE`), and propagates persist failures
   with nothing remembered so sender retries re-verify cleanly. Symmetrically, the step-up gate
   exposes the same durable-before-return discipline for consumed proofs
   (`ConsumedProofRegistry`; replay refuses `STEP_UP_PROOF_CONSUMED`).

## Consequences

- Fence-format changes are breaking contract changes: they require an ADR and a migration path
  for any stored/transported fenced content, not just a code edit.
- CAS transitions make incident handling race-free at the cost of possible typed refusals under
  concurrency; operators retry instead of silently losing containment state.
- Strict-presentation deployments must supply full request context at every credential check or
  see typed `SEC_CREDENTIAL_ORIGIN_MISMATCH` refusals.
- Wiring layers that skip the dedupe/proof seams inherit only the documented per-process
  guarantees; the seams make the stronger guarantee reachable without weakening the base tier.
