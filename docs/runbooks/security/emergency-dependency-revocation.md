# Runbook: Emergency dependency revocation

Implements FR-SEC-006 / §35.8 supply-chain duties. Trigger: a dependency
(or transitive artifact) is found malicious, compromised, or carrying a
prohibited capability — upstream advisory, lockfile drift, lifecycle-script
anomaly, or scanner/capability-review flag.

## Severity triage

- **SEV1** — executed code exfiltration/signing capability, install-time
  scripts observed (`preinstall`/`install`/`postinstall` outside the
  allowlist → `SEC_LIFECYCLE_SCRIPT_RESTRICTED`), or any dependency naming
  trading/custody/wallet capability (catalog category hit).
- **SEV2** — vulnerable-but-not-malicious with network/process capabilities
  flagged by `flagCapabilityReview`.
- **SEV3/4** — pinning hygiene drift (`SEC_DEPENDENCY_UNPINNED`).

## Immediate containment (SEV1)

1. Open SEV1 incident `kind=SUPPLY_CHAIN_COMPROMISE`; owner + deputy.
2. **Pause the consuming surface** via the smallest-scope pause that stops
   builds and deploys of affected packages.
3. **Revoke at every layer**:
   - Remove from the trusted set for imports if it participates in producer
     tooling (`SEC_IMPORT_PRODUCER_UNTRUSTED`).
   - Rotate any credential the dependency could have reached (follow
     `credential-compromise.md` — assume reachability when in doubt).
   - If the artifact entered Alpha Lab imports: quarantine intake refuses;
     mark existing artifacts REJECTED via scan finding verdict MALICIOUS.
4. **Provenance snapshot**: emit SBOM record + build hash records for the
   last known-good build BEFORE rebuilding, so the boundary between clean
   and tainted artifacts is hash-pinned (`recordBuildHash`,
   `emitSbomRecord`).

## Removal procedure

1. Pin replacements to EXACT versions (`verifyPinning` refuses ranges).
2. Re-run the full gate: `pnpm verify` (includes prohibited-capability
   scanner CLI + canary parity) — must be CLEAN.
3. Record new lockfile hash; require build attestation on the rebuilt
   artifacts before promotion.

## Verification & closure

1. Telemetry shows zero further `SEC_LIFECYCLE_SCRIPT_RESTRICTED` /
   prohibited-capability findings post-rebuild.
2. Capability review recorded for every replacement dependency with
   NETWORK | PROCESS | DYNAMIC_CODE declarations.
3. Regression duty: add the malicious artifact's signature/pattern to the
   scanner self-test corpus (`tests/fixtures/sec/**`, inert) with a negative
   spec proving detection.
