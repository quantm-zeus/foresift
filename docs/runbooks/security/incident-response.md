# Runbook: Security incident response

Scope: every security incident raised against any of the eleven trust
boundaries (see `threat-models/register.md`). Implements FR-SEC-011 and the
PRD §35.9 incident duties: severity, owner, containment, evidence
preservation, credential rotation, notification policy, recovery
verification, postmortem, regression test.

## 1. Severity matrix

| Severity | Definition (any one suffices)                                                                                                                           | Containment SLA     | Examples                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| SEV1     | Audit-chain verification failure; confirmed cross-tenant access; secret material exposure; prohibited trading/custody capability detected in production | Immediate (minutes) | Hash-chain break (`SEC_AUDIT_CHAIN_VERIFICATION_FAILED`), tenant-B reading tenant-A rows, provider key found in model context |
| SEV2     | Authentication/authorization bypass attempt that SUCCEEDED partially; webhook forgery accepted; import quarantine escape                                | ≤ 1 hour            | Signed-URL replay that returned data; MALICIOUS scan verdict bypassed                                                         |
| SEV3     | Repeated refused attacks indicating targeting; abuse-control saturation of one surface; egress allowlist misconfiguration caught by guard               | ≤ 1 business day    | SSRF battery blocked but sustained; enumeration suspicion raised                                                              |
| SEV4     | Policy drift without exposure (expired runbook links, missing attestation metadata)                                                                     | Next planning cycle | Decoder authority config warning                                                                                              |

SEV1 incidents on audit health additionally trigger the §35.9 block rule:
`AUDIT_HEALTH_BLOCKED` refuses high-impact admin actions until the incident
reaches containment state `RESOLVED` (enforced by
`packages/security/src/action-gate.ts`).

## 2. Owner assignment

1. The opener assigns `owner` at creation time in `sec.security_incidents`
   (`packages/security/src/incidents.ts` refuses unowned transitions).
2. Owner is an accountable human operator; automation may ACT as owner only
   for mechanical containment steps that are themselves audited.
3. SEV1/SEV2 require a deputy named in the incident record before
   containment may close.

## 3. Containment steps

Ordered least-blast-radius first:

1. **Pause the failing gate** via `capability_pauses`
   (`packages/security/src/gate-pause.ts`) — smallest scope that stops the
   harm: single action class → single surface → global. Auto-reactivation of
   critical-gate pauses is machine-refused; resume is an audited,
   step-up-protected action.
2. **Freeze affected credentials** — revoke MCP credentials
   (`SEC_CREDENTIAL_REVOKED`); rotation follows §credential-compromise.md.
3. **Block egress/targets** — tighten the plane's egress allowlist entry set;
   verify with the EgressGuard deny-by-default posture.
4. **Stop imports** — quarantine intake refuses new artifacts
   (`SEC_IMPORT_*` refusals) while the Alpha Lab pipeline is implicated.
5. Only after containment: diagnose. Never trade containment speed for root-
   cause certainty while attack traffic continues.

## 4. Evidence preservation

- Attach immutable evidence references to the incident row BEFORE any
  remediation mutates state: hash-chain segment ids, request ids, telemetry
  event ids (`telemetry/sec.*`), object-store snapshot keys of
  `sec_audit_checkpoints`, and raw log excerpts under the redaction rules of
  `packages/security/src/secrets-policy.ts` (never raw secrets into tickets).
- Audit entries are append-only (SQL immutability triggers). Copy, never
  edit; corrections are NEW chained entries referencing the old ones.
- Export evidence bundles to the evidence bucket with computed sha256
  manifests; record bundle hashes in the incident record.

## 5. Credential rotation duties

| Exposed material                | Duty                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Provider API keys               | Revoke upstream, reissue via secret manager, update keyed refs ONLY (material never enters context/logs)                      |
| Database credentials            | Rotate both sides of the overlap window (`SecretLifecycleLedger.recordRotation`; overlap must extend beyond rotation instant) |
| MCP credential hashes           | Invalidate store rows; force re-enrollment                                                                                    |
| Admin session secrets           | Global session invalidation + pepper rotation                                                                                 |
| Producer signing keys (imports) | Remove from trusted-producer allowlist (`SEC_IMPORT_PRODUCER_UNTRUSTED`), rotate, re-allowlist after verification             |

Every rotation appends `REVOKED` lifecycle records linked to
`invalidatedByIncidentId` (`invalidateForIncident`).

## 6. Notification policy

Deterministic policy services ONLY (trust-boundary rule §9.3-5):

- Customer/tenant notifications follow the notification templates registered
  in configuration; content is limited to facts required for tenant action.
- Owner/operator notification is immediate for SEV1/SEV2 through the paging
  channel; SEV3/4 batch into the daily security digest.
- No automated external side effects beyond the deterministic notification
  policy (INV-003) — no ad-hoc posts, no provider status updates from the
  incident lane.

## 7. Recovery verification

Recovery is complete when ALL hold:

1. Containment state reached `RESOLVED` through the legal transition order.
2. Independent re-verification green: audit-chain verifier over the full
   chain including incident-window entries; scanner CLI clean at repo root;
   canary parity suite green.
3. Rotated credentials proven in use; revoked ones provably refused
   (`SEC_CREDENTIAL_REVOKED` telemetry observed for a probe).
4. High-impact gate unblocked ONLY by the RESOLVED transition — never by
   disabling the audit-health check.

## 8. Postmortem template

```markdown
# Postmortem <incident-id>

- Severity / owner / deputy:
- Detection: (which signal, which suite, latency to detection)
- Impact: (tenants, surfaces, data classes; read-only product — never funds)
- Timeline: (UTC; detection → containment → resolution)
- Root cause: (technical, five-whys)
- Control failure analysis: (which perimeter control should have held; why it didn't)
- Regression-test duty: link the new spec file(s)
- Residual risk & owners:
```

## 9. Regression-test duty

Every incident closes ONLY with at least one merged regression test proving
the fixed refusal: acceptance spec under `tests/acceptance/` or negative spec
under `tests/negative/`, named for the breached AC. The postmortem links it;
CI keeps it green forever.
