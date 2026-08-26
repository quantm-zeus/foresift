# Runbook: rights tightening drill (FR-PROV-009 / AC-273)

Trigger: a vendor narrows its terms — a use path closes, a cache window
shortens, a jurisdiction is added. Goal: make the tightening ENFORCE IMMEDIATELY
against new captures AND against already-stored artifacts, with a complete,
auditable action ledger and zero silent retention.

Machine truth: `RightsMatrixEngine` (`packages/provider-lifecycle/src/rights-matrix.ts`)
and `ArtifactRegistry` (`.../artifact-registry.ts`). This drill is the operator
choreography over those APIs.

## Drill steps

### 1. Block paths — record the tightened declaration

    rights.changeRights({
      providerId, operationId,
      nextVersion: <current + 1>,        // enforced consecutive
      declaration: <sixteen fields, tightened>,
      actor: "<operator id>",
    })

The engine computes the diff against the CURRENT version:
true→false gate flips become `newlyProhibitedUses`; shortened cache windows,
jurisdiction expansion, and commercial/personal-research revocation set
`tightened`. The change row lands in `prov.prov_rights_changes` with a
deterministic id and an audit entry (`BLOCKED_OPERATION`, kind `RIGHTS_CHANGE`).

Refusals you may hit:

- `PROV_RIGHTS_VERSION_UNKNOWN` — no v1 exists yet; declare it first.
- `PROV_RIGHTS_MATRIX_INVALID` — non-consecutive version or invalid window.
- Divergent replay of an already-recorded transition → refused outright
  (`PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION`); first outcome immutable.

From this instant, `decideForNewCapture` refuses every newly prohibited path —
new captures are already blocked before any artifact work begins.

### 2. Enumerate artifacts — compute the blast radius

Affected = artifacts of `(provider_id, operation_id)` with
`rights_version < to_version` AND `state = 'ACTIVE'`
(`prov.prov_provider_artifacts`). Already-quarantined/retired rows stay in
their (more restrictive) state; they are never loosened by this drill.

### 3. Execute actions

    artifacts.applyRightsChange({ change, providerId, operationId })

Policy per affected artifact:

| Condition                              | Action       | Resulting state                              |
| -------------------------------------- | ------------ | -------------------------------------------- |
| `STORAGE` ∈ newly prohibited           | `RETIRE`     | `RETIRED` (the raw copy cannot even be held) |
| any OTHER newly prohibited path        | `QUARANTINE` | `QUARANTINED`                                |
| tightened but NO newly prohibited path | none         | dynamic gates enforce at use time            |

Action rows land in `prov.prov_rights_change_actions`, uniquely fenced on
`(change_id, artifact_id)` — replaying the execution resolves to the SAME
ledger and re-runs nothing. State updates guard on `state = 'ACTIVE'`, so an
enforcement pass can never weaken an already-enforced row. There is NO
reactivation path: loosened rights require re-capture under the new version.

### 4. Verify

1. **Ledger completeness** — `artifacts.actionsForChange(changeId)` shows one
   action per affected artifact; count matches the enumeration from step 2.
2. **States flipped** — spot-check `state` for RETIRED/QUARANTINED as policy.
3. **Decision API refuses** — `decideForArtifact({capturedRightsVersion: old,
path: closed})` returns `{ allowed: false }`; unknown versions throw
   `PROV_RIGHTS_VERSION_UNKNOWN`.
4. **Audit chain** — exactly ONE `RIGHTS_CHANGE` entry for the change id;
   replays do not append duplicates.
5. **No silent retention** — SQL sweep: any ACTIVE artifact with
   `rights_version < to_version` after execution is a SEV2 finding (open an
   incident, re-run the drill).

## Escalation

- Vendor terms conflict with an existing declaration window that has not
  lapsed: record the tightening immediately anyway — windows bound
  VERIFICATION freshness, not enforcement delay.
- Enforcement found incomplete downstream (e.g. a cache layer still serving):
  treat as a blocked-operation incident under FR-PROV-009 and quarantine the
  surface via lifecycle BLOCKED until reconciled.
