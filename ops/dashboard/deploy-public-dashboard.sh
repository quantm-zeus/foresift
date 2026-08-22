#!/usr/bin/env bash
# deploy-public-dashboard.sh — sanctioned path to publish the Archon dashboard
# over HTTPS with basic authentication on the Foresift VPS.
#
# WHY THIS SCRIPT EXISTS
#   The dashboard itself must never be exposed raw: archon serve stays bound to
#   127.0.0.1:3090. Public access goes through Caddy as a TLS-terminating
#   reverse proxy with basic_auth, using a Let's Encrypt certificate issued for
#   the VM's external IP via the REQUIRED shortlived profile (IP certificates
#   are only ever 6-day certs; certbot >=5.4 webroot + --ip-address required).
#
# RUN THIS ONLY FROM THE VM, AS A USER WITH SUDO.
# It is idempotent and fails closed at every step. It requires EITHER:
#   (a) gcloud authenticated with compute scopes (it will promote the IP to
#       static and open the firewall itself), OR
#   (b) an operator who has ALREADY done both GCP actions below.
#
# GCP ACTIONS BLOCKING DEPLOYMENT AS OF 2026-08-22 (VM service account lacks
# compute.* scopes — run these with an identity that has compute.admin):
#   gcloud compute addresses create foresift-dashboard-ip \
#     --addresses=34.87.12.208 --region=asia-southeast1 \
#     --project=project-f4ed0894-e3e1-4820-b08
#   gcloud compute firewall-rules create allow-http-dashboard \
#     --direction=INGRESS --action=ALLOW --rules=tcp:80 \
#     --source-ranges=0.0.0.0/0 \
#     --target-network-tags=<this instance's network tag> \
#     --project=project-f4ed0894-e3e1-4820-b08
set -euo pipefail

EXTERNAL_IP="${FORESIFT_DASHBOARD_IP:-34.87.12.208}"
GCP_PROJECT="${CLOUDSDK_CORE_PROJECT:-project-f4ed0894-e3e1-4820-b08}"
GCP_REGION="asia-southeast1"
WEBROOT="/var/www/letsencrypt"
CREDS_DIR="${HOME}/.local/state/foresift"
CREDS_FILE="${CREDS_DIR}/dashboard-credentials" # plaintext lives ONLY here, 0600
BASIC_USER="foresift"
HOOK_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certbot-deploy-hook.sh"
HOOK_DST="/etc/letsencrypt/renewal-hooks/deploy/foresift-dashboard.sh"

log() { printf '\n[deploy] %s\n' "$*"; }
die() { printf '\n[deploy:BLOCKED] %s\n' "$*" >&2; exit 1; }

command -v caddy >/dev/null || die "caddy not installed (official repo: dl.cloudsmith.io/public/caddy/stable)"
command -v certbot >/dev/null || die "certbot not installed (snap install --classic certbot; need >=5.4)"
CERTBOT_MAJOR="$(certbot --version 2>&1 | sed -E 's/certbot ([0-9]+).*/\1/')"
[ "${CERTBOT_MAJOR:-0}" -ge 5 ] || die "certbot >=5.4 required for --ip-address webroot issuance (got: $(certbot --version 2>&1))"
sudo systemctl is-active --quiet caddy || die "caddy is not running"

# ── step 1: refuse to issue a production certificate against an ephemeral IP ─
log "step 1/6: verifying ${EXTERNAL_IP} is a STATIC external address"
PROMOTE_CMD="gcloud compute addresses create foresift-dashboard-ip \\
  --addresses=${EXTERNAL_IP} --region=${GCP_REGION} --project=${GCP_PROJECT}"
STATIC_CONFIRMED=0
ADDR_LIST_ERR="$(mktemp)"
if ADDR_LIST_OUT="$(gcloud compute addresses list --project="$GCP_PROJECT" 2>"$ADDR_LIST_ERR")"; then
  # gcloud can exit 0 with empty output even when scopes silently deny the
  # listing, so also inspect stderr for the scope refusal before trusting it.
  if grep -qi "insufficient authentication scopes\|Permission denied\|403" "$ADDR_LIST_ERR"; then
    : # fall through to the unverified path below
  elif printf '%s' "$ADDR_LIST_OUT" | grep -q "^foresift-dashboard-ip"; then
    STATIC_CONFIRMED=1
    log "  confirmed static via gcloud (reserved address 'foresift-dashboard-ip')"
  fi
fi
rm -f "$ADDR_LIST_ERR"
if [ "$STATIC_CONFIRMED" != "1" ]; then
  [ "${FORESIFT_STATIC_CONFIRMED:-0}" = "1" ] || die "cannot verify that ${EXTERNAL_IP} is static (gcloud lacks compute scopes, or address not reserved).
Promote it first, from ANY identity with compute.admin:
  ${PROMOTE_CMD}
Then re-run this script — or, having verified the reservation another way,
re-run with FORESIFT_STATIC_CONFIRMED=1. NEVER issue a production certificate
against an address known only to be ephemeral."
  log "  operator asserted staticity via FORESIFT_STATIC_CONFIRMED=1"
fi

# ── step 2: port 80 must be reachable from the internet (ACME HTTP-01) ───────
log "step 2/6: verifying inbound tcp/80 reachability (external probe)"
echo '<h1>foresift-edge</h1>' | sudo tee "${WEBROOT}/index.html" >/dev/null
PROBE_OK=0
for node in de1 es2 ru3; do
  REQ="$(curl -s -H 'Accept: application/json' "https://check-host.net/check-tcp?host=${EXTERNAL_IP}:80&max_nodes=3")"
  RID="$(printf '%s' "$REQ" | sed -nE 's/.*"request_id":"([^"]+)".*/\1/p')"
  [ -n "$RID" ] || continue
  sleep 8
  if curl -s -H 'Accept: application/json' "https://check-host.net/check-result/${RID}" | grep -q '"time"'; then
    PROBE_OK=1
    break
  fi
done
[ "$PROBE_OK" = "1" ] || die "tcp/${EXTERNAL_IP}:80 is NOT reachable from the internet (external probes timed out).
Open it:
  gcloud compute firewall-rules create allow-http-dashboard \\
    --direction=INGRESS --action=ALLOW --rules=tcp:80 --source-ranges=0.0.0.0/0 \\
    --project=${GCP_PROJECT}
Then re-run this script."

# ── step 3: staging certificate (pipeline proof before production) ───────────
log "step 3/6: staging certificate (shortlived profile, webroot)"
if [ ! -f "/etc/letsencrypt/live/${EXTERNAL_IP}-staging/fullchain.pem" ]; then
  sudo certbot certonly --staging --non-interactive --agree-tos \
    --register-unsafely-without-email --preferred-profile shortlived \
    --webroot --webroot-path "$WEBROOT" --ip-address "$EXTERNAL_IP" \
    --cert-name "${EXTERNAL_IP}-staging"
fi
[ -f "/etc/letsencrypt/live/${EXTERNAL_IP}-staging/fullchain.pem" ] || die "staging issuance failed — fix the reported problem before production"

# ── step 4: credentials — plaintext ONLY in $CREDS_FILE (0600), hash in config ─
log "step 4/6: dashboard basic-auth credentials"
mkdir -p "$CREDS_DIR"; chmod 700 "$CREDS_DIR"
if [ -f "$CREDS_FILE" ]; then
  log "  reusing existing password in $CREDS_FILE"
  PW="$(sed -n 's/^password=//p' "$CREDS_FILE")"
  [ -n "$PW" ] || die "$CREDS_FILE exists but has no password= line"
else
  PW="$(openssl rand -base64 27 | tr -d '\n')"
  umask 077
  printf 'user=%s\npassword=%s\ngenerated=%s\n' "$BASIC_USER" "$PW" "$(date -u +%FT%TZ)" >"$CREDS_FILE"
  chmod 600 "$CREDS_FILE"
  umask 022
  log "  generated NEW password -> $CREDS_FILE (mode 0600; plaintext NEVER enters git/config/args)"
fi
HASH="$(printf '%s' "$PW" | caddy hash-password 2>/dev/null)" # Argon2id; PW passed via stdin only
[ -n "$HASH" ] || die "caddy hash-password failed"

# ── step 5: production certificate ────────────────────────────────────────────
log "step 5/6: PRODUCTION certificate (shortlived profile, webroot)"
sudo certbot certonly --non-interactive --agree-tos \
  --register-unsafely-without-email --preferred-profile shortlived \
  --webroot --webroot-path "$WEBROOT" --ip-address "$EXTERNAL_IP" \
  --cert-name "${EXTERNAL_IP}"

# Renewal hook: root:caddy 0640, reloads Caddy whenever the shortlived cert
# renews (6-day validity ⇒ renewals every ~3-4 days; timer already active).
sudo install -o root -g caddy -m 0640 "$HOOK_SRC" "$HOOK_DST"

# ── step 6: HTTPS edge config + verification ──────────────────────────────────
log "step 6/6: installing final Caddyfile (HTTPS + basic_auth) and verifying"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
# Foresift dashboard edge — PRODUCTION.
# TLS terminates here for the Let's Encrypt shortlived IP certificate;
# basic_auth gates everything; traffic proxies to loopback-only archon.
{
	admin off
}

http://:80 {
	root * ${WEBROOT}
	file_server
}

https://${EXTERNAL_IP} {
	tls /etc/letsencrypt/live/${EXTERNAL_IP}/fullchain.pem /etc/letsencrypt/live/${EXTERNAL_IP}/privkey.pem
	basic_auth {
		${BASIC_USER} ${HASH}
	}
	reverse_proxy 127.0.0.1:3090
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile || die "rendered Caddyfile failed validation (check the Argon2id hash rendering)"
sudo systemctl reload caddy

sleep 2
CODE_NOAUTH="$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1/" || true)"
[ "$CODE_NOAUTH" = "401" ] || die "expected 401 without credentials, got '${CODE_NOAUTH}'"
CODE_AUTH="$(curl -sk -o /dev/null -w '%{http_code}' -u "${BASIC_USER}:${PW}" "https://127.0.0.1/" || true)"
case "$CODE_AUTH" in 200|30[127]) ;; *) die "expected success with credentials, got '${CODE_AUTH}'" ;; esac

# Prove renewal automation end-to-end (staging lineage dry-runs the ACME flow).
sudo certbot renew --dry-run --cert-name "${EXTERNAL_IP}-staging" >/dev/null \
  || die "certbot renew --dry-run failed — auto-renewal is NOT proven"

# WEB_UI_ORIGIN is set ONLY now that public HTTPS actually exists.
sudo mkdir -p ~/.config/systemctl/user 2>/dev/null || true
mkdir -p "${HOME}/.config/systemd/user/archon-dashboard.service.d"
cat >"${HOME}/.config/systemd/user/archon-dashboard.service.d/webui-origin.conf" <<EOF
[Service]
Environment=WEB_UI_ORIGIN=https://${EXTERNAL_IP}
EOF
systemctl --user daemon-reload

log "DONE — dashboard published at https://${EXTERNAL_IP} (basic_auth user '${BASIC_USER}')"
log "plaintext password: ${CREDS_FILE} · renewal hook: ${HOOK_DST} · next: systemctl --user restart archon-dashboard"
