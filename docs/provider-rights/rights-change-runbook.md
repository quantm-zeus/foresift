# Rights-change runbook (FR-PROV-009; AC-273)

Operator procedure when a provider tightens (or nominally loosens) its terms.
This is an operations document: the executable enforcement is `RightsMatrix`
in `@foresift/provider-lifecycle`, and this runbook never overrides it.

## 0. Ground rules

- Changes are recorded via `RightsMatrix.recordChange` — never by editing
  declaration rows in place. Declaration rows are append-only history.
- A change with an EMPTY diff is refused (`PROV_DEFINITION_INVALID`). If
  nothing changed, do not record a change.
- Tightenings are computed over the seven use paths; a field going
  `true -> false` lands in `newlyProhibitedUses`.

## 1. Intake

1. Capture the provider's new terms page / API policy as evidence. Evidence
   references (`evidenceRefs`) MUST include at least one stable pointer
   (archived terms URL or document id).
2. Determine old and new rights versions. The FROM version must be the
   currently-declared version for every affected operation.

## 2. Declare the new version per operation

For each affected operation, call `RightsMatrix.declare` with the full
sixteen-field matrix for the NEW rights version. The declaration window must
be non-inverted and a cache allowance requires a maximum duration.

## 3. Record the change

Call `RightsMatrix.recordChange` with `{providerId, operationId,
fromRightsVersion, toRightsVersion, evidenceRefs}`. The engine:

1. computes `newlyProhibitedUses` from the two declarations;
2. enumerates ACTIVE artifacts captured under the FROM version;
3. assigns each artifact an action — `RETIRE` when `RAW_RETENTION` or
   `EXPORT` is newly prohibited, otherwise `QUARANTINE`;
4. executes the actions inside one transaction and appends a RIGHTS_CHANGE
   audit entry.

## 4. Verify blast radius (do not skip)

```sql
SELECT artifact_id, state FROM prov.prov_provider_artifacts
 WHERE provider_id = $1 AND operation_id = $2;
SELECT * FROM prov.prov_rights_change_actions WHERE change_id = $3;
```

Every previously-ACTIVE artifact captured under the FROM version must now be
`RETIRED` or `QUARANTINED`. Artifacts captured AFTER the change under the new
version stay ACTIVE.

## 5. Communicate

- Loosening after a tightening does NOT restore existing material. Stored
  artifacts remain refused across the loosening; only explicit reactivation
  (fresh verification + current RIGHTS PASS) restores a named artifact.
- Update `rights-matrix-register.md` in the same change that lands the
  declarations.

## 6. Rollback

There is no rollback of a recorded change (append-only audit). Corrections
are FORWARD: declare a further version and record another change.
