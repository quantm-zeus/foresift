# Runbook: Audit-chain failure

Implements FR-SEC-002 / §35.9. A chain verification failure
(`AuditChainError` / `SEC_AUDIT_CHAIN_VERIFICATION_FAILED`) means the
tamper-evident security audit trail is broken: deletion, mutation,
reordering, gap, or chain break (classifier in
`packages/security/src/audit-chain.ts`).

## Automatic consequences (already enforced — verify, don't re-enable)

1. A SEV1 `AUDIT_CHAIN_FAILURE` incident opens automatically.
2. While any SEV1 AUDIT_CHAIN_FAILURE incident is open and unresolved, the
   high-impact action gate refuses with `AUDIT_HEALTH_BLOCKED`
   (`evaluateHighImpactAction` consults audit health; §35.9 block rule).
   There is NO override short of RESOLVED.

## Response steps

1. **Snapshot evidence** before touching the database:
   - Object-store checkpoint copies vs `sec_audit_checkpoints` rows
     (`SEC_AUDIT_CHECKPOINT_MISMATCH` distinguishes store drift from row
     tampering).
   - `first_divergence_seq` + divergence kind from the verifier diagnostic.
2. **Classify** using the divergence kind:
   - DELETION → identify the seq window; check backup restores.
   - MUTATION → compare stored payload hash against recomputation for the
     named seq; suspect SQL-level write access (immutability triggers should
     refuse; their absence on some path is itself a SEV1 finding).
   - REORDERING → look for restored-from-backup ranges replayed out of order.
   - CHAIN_BREAK → prev hash matches nothing; possible partial restore.
   - GAP → requested range legitimately empty? If not, treat as DELETION.
3. **Contain**: freeze writes to `sec_audit_events` from application paths
   under suspicion by pausing the emitting surface (smallest scope pause);
   restrict direct DB access; preserve binary backups read-only.
4. **Recover** only via replay of verified segments into a NEW chain segment
   whose genesis references the last verified hash; NEVER rewrite existing
   rows (append-only contract). Document the rebuild as new chained entries.
5. **Resolve** through the legal incident transition order only after an
   independent full-chain verification passes green — this unblocks the
   high-impact gate BY THE BOOK (never by disabling the check).

## Closure requirements

1. Independent verification green over 100% of the chain.
2. Checkpoint cadence restored and mirrored to the object store with
   matching hashes.
3. Regression tests covering the tampering vector (see
   `tests/negative/AC-259.negative.spec.ts` family) green in CI.
