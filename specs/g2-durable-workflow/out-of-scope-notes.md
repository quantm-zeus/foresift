# g2-durable-workflow — out-of-scope notes

The package plan (`plan.md`) requires every finding that is outside this
package's scope to be recorded here rather than planned or implemented silently.
Recorded during implementation and the T040 convergence audit (2026-09-12).

## Owned by sibling packages (deliberately not implemented here)

- **Alert classification and content** (FR-ALERT-001…005): the engine commits an
  already-classified decision + alert record + outbox entry atomically, but what
  makes a classification valid, the EARLY_WATCH/CONFIRMED_OPPORTUNITY policies,
  TTLs, fingerprint/cooldown rules, and alert rendering are `g2-alert-lifecycle`.
- **Admin rendering and kill switches** (FR-ADM-001/003/007): this package ships
  the read handlers and §25.11 control actions the admin plane calls; the
  dashboard, overview, and kill-switch UI/API are `g2-admin-control`.
- **Durable incident store**: `reconciliation` raises an incident per mismatch
  and persists the incident ids in `wf.reconciliation_reports.incident_refs`;
  the durable incident row store and its management surface belong to the admin
  and recovery packages.
- **Recovery drills** (FR-DR-003…006, AC-062, AC-260…264): `verify-state.ts`
  ships the read-only consistency checks and documents the qualified `wf` names
  the drills must call; the destructive restore drills and RPO/RTO measurement
  are `g2-recovery-continuity`.
- **Production promotion/activation states and MCP compatibility matrix**
  (FR-PROD-001…006) are `g2-production-readiness`.

## Accepted residual risks (carried forward, not blocking)

- **Outage suppression is a status tag.** The delivery gate re-checks the run's
  shadow flag, but `SUPPRESSED_OUTAGE` is enforced by claim exclusion plus the
  send gate reading the row status. A hand-corrupted row forced from
  `SUPPRESSED_OUTAGE` back to `PENDING` would pass the send gate; no engine path
  can produce that state. Tracked for a future hardening pass if an independent
  outage source becomes available to re-read at delivery time.
- **URL canonicalization drops query and fragment.** `canonicalizeExternalMessageId`
  reduces an absolute URL to `origin + pathname`. QStash message identity is
  carried in a signed header, not the URL query, so this is safe for the
  scheduler contract; a future scheduler that encodes identity in the query
  string must extend the canonicalization rule.
- **`REJECTED` trigger status is unreachable in the current pipeline.** A refused
  delivery rolls the whole transaction back, so no partial inbox row survives to
  carry that status. The vocabulary member is retained because the SQL CHECK and
  the domain vocabulary are frozen; a future "record the refusal" path would use
  it.
- **PGlite does not isolate concurrent transactions.** DB-level concurrency
  guarantees rest on constraint/trigger design; in-process determinism comes
  from the per-schedule admission chain (ADR-0024). A multi-connection
  PostgreSQL concurrency test is an integration-tier obligation.
- **AC-060 hot-path budget is an interpretive mapping.** The 250 ms
  inbox→run→checkpoint budget is derived from PRD §33.1/§33.9 internal-overhead
  intent; the 2 s trigger-acknowledgement budget is the exact PRD figure.

## Test-fixture corpus reserved for later packages

`tests/fixtures/wf/scheduler-drift.ts` exports the five §25.10 skew fixtures.
They are exercised by `packages/workflow-runtime/test/reconciliation.spec.ts`;
the exported builders are retained for the admin/recovery packages that will
drive reconciliation through the HTTP surface and the restore drills.
