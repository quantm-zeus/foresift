# Rights-change runbook — tightening drill

Operational drill for FR-PROV-009/AC-273: a provider tightens its terms and
the platform must converge to the new prohibition set with NO silent
retention. Every step below maps onto a landed module; nothing here is
manual state.

## Preconditions

- The operation has a registered definition (`prov.prov_operations`).
- At least one rights declaration exists (vN) with artifacts captured
  against it (`prov.prov_provider_artifacts`, state ACTIVE).

## Drill

### 1. Block the paths — declare the tightened version

```
rights.declareVersion({ providerId, operationId, matrix: vNext, actor })
```

The service computes `newlyProhibitedUses` against the previous version,
persists the declaration + change row, and appends a `RIGHTS_CHANGE` audit
entry. From this instant:

- `decideUsePath(..., capturedRightsVersion: <new>)` refuses every newly
  prohibited path (`RIGHT_PROHIBITED`);
- loosening attempts require a currently open verification window or fail
  with `PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION`.

### 2. Enumerate affected artifacts — exactly once

```
artifacts.planTighteningActions(change)
```

Every ACTIVE artifact of the operation gets ONE durable action row in
`prov.prov_rights_change_actions`:

- `RETIRE` when the tightening touches REDISTRIBUTION, RAW_EXPORT, or
  PUBLIC_ALERT_DERIVATIVE (artifact is unfit for circulation);
- `QUARANTINE` otherwise (pulled from consumption/model context).

The `UNIQUE(change_id, artifact_id)` fence makes re-planning a no-op — the
durable rows ARE the enumeration. Re-running can neither duplicate nor
forget.

### 3. Execute actions — recorded, never implied

```
artifacts.executeAction(actionId)
```

Sets `executed_at`, flips artifact state to RETIRED/QUARANTINED. Execution
is explicit per action; re-execution refuses
(`PROV_RIGHTS_ACTION_INCOMPLETE`). Partial execution is VISIBLE: unexecuted
rows keep `executed_at IS NULL` until someone runs them.

### 4. Verify convergence

Check all four, in order:

```sql
-- a. every previously-ACTIVE artifact has an action row
SELECT count(*) FROM prov.prov_provider_artifacts a
WHERE a.provider_id=$P AND a.operation_id=$O AND a.state='ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM prov.prov_rights_change_actions x
                  WHERE x.artifact_id = a.artifact_id AND x.change_id = $C);
-- expect 0

-- b. no unexecuted action rows remain after the drill
SELECT count(*) FROM prov.prov_rights_change_actions
WHERE change_id=$C AND executed_at IS NULL;
-- expect 0

-- c. use decisions refuse the newly prohibited set
--    (exercise rights.decideUsePath per AC-273 negative suite)

-- d. audit chain still verifies end-to-end
--    (AuditChain.verifyRange verdict OK)
```

### 5. Readiness interplay

After execution, the operation's activation-readiness evaluation (AC-272)
must show no QUARANTINED_EXPOSURE unless actual malicious-response rows
exist; rights tightening alone does NOT quarantine the operation itself —
only the artifacts captured under superseded versions' now-unfit uses.

## Failure modes this drill makes impossible

- "We tightened the matrix but old artifacts kept flowing": enumeration is
  mechanical over ACTIVE artifacts, keyed by the durable change row.
- "Someone re-permitted a use without evidence": loosening refuses without
  reverification.
- "Did we act on the tightening?": action rows carry executed_at or they do
  not — there is no implicit done-state.
