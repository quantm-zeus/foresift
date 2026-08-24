# Runbook: Credential compromise

Implements FR-SEC-007 / §35.11 secret-handling duties. A credential is
COMPROMISED when material or a usable keyed reference may be held by any
party outside its intended surface — detected by telemetry
(`telemetry/sec.credential.revoked`), log redaction hits, incident report,
or upstream provider notice.

## Immediate actions (SEV1)

1. **Open a SEV1 incident** (`kind=CREDENTIAL_COMPROMISE`) and assign owner +
   deputy (see `incident-response.md` §2).
2. **Revoke first, investigate second.** Revoke via the MCP credential store
   (`revoke()` → `SEC_CREDENTIAL_REVOKED`, `revoked_at` pinned) or the
   relevant lifecycle ledger (`REVOKED` event with
   `invalidatedByIncidentId`). Revocation is fail-closed: authenticate()
   refuses revoked references regardless of other validity.
3. **Never paste suspected material anywhere** — not tickets, not chat, not
   model context. `refuseSecretTowardModelContext` enforces the model side;
   humans follow the same rule. Redact with `redactForLogs` markers only.

## Per-class rotation duties

Follow `incident-response.md` §5 for the class-specific matrix
(provider keys, database credentials, MCP hashes, admin session secrets,
producer signing keys). Overlap windows:

- Rotation uses an overlap window whose end STRICTLY EXTENDS BEYOND the
  rotation instant (`SEC_SECRET_LIFECYCLE_INVALID` otherwise).
- The OLD reference stays valid only until `overlapUntil`; schedule
  cutover inside it; both sides audited.

## Environment separation check

Verify the compromised class never crossed environment boundaries:
production-class secrets referenced from ALPHA_LAB/COLLECTOR surfaces refuse
(`assertEnvironmentSeparation`). If a production secret reached Alpha Lab:
treat as confirmed exposure, rotate production-side, and audit every Alpha
Lab session in the window.

## Export/UI containment

- Confirm no export channel carried the class (`SEC_SECRET_EXPORT_REFUSED`
  telemetry should show zero ALLOWs).
- UI renders keyed references only (`assertUiDisplayAllowed`); if raw
  material rendered anywhere, expand the incident scope to include every
  viewer.

## Closure requirements

All of `incident-response.md` §7–§9 plus:

1. Probed refusal evidence: an authentication attempt with the revoked
   reference fails `SEC_CREDENTIAL_REVOKED`.
2. Lifecycle ledger shows the full REVOKED chain linked to this incident.
3. Regression test merged covering the specific leak vector (e.g., new
   detector pattern added to `detectMaterial` with tests).
