#!/usr/bin/env bash
# certbot renewal deploy hook for the Foresift dashboard edge.
# Installed by ops/dashboard/deploy-public-dashboard.sh at:
#   /etc/letsencrypt/renewal-hooks/deploy/foresift-dashboard.sh  (root:caddy 0750)
#
# Shortlived IP certificates renew every ~3-4 days. /etc/letsencrypt/live is
# root-only (0700), which the unprivileged `caddy` user cannot traverse, so
# each renewed lineage is copied into a Caddy-readable store first:
#   /etc/caddy/certs/foresift/{fullchain.pem,privkey.pem}   root:caddy 0644/0640
# Only once both files sit in place is Caddy's configuration validated and,
# if valid, Caddy reloaded. Readable by the caddy group so its presence and
# behavior remain auditable; writable by root only.
set -euo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Only react to the dashboard's production certificate lineage.
case "${RENEWED_LINEAGE:-}" in
  */34.87.12.208) ;;
  *) exit 0 ;;
esac

DEST_DIR=/etc/caddy/certs/foresift

logger -t foresift-dashboard "renewed certificate deployed, staging for caddy"
install -d -o root -g caddy -m 0750 "$DEST_DIR"
install -o root -g caddy -m 0644 "${RENEWED_LINEAGE}/fullchain.pem" "$DEST_DIR/.fullchain.pem.new"
install -o root -g caddy -m 0640 "${RENEWED_LINEAGE}/privkey.pem" "$DEST_DIR/.privkey.pem.new"
mv -f "$DEST_DIR/.fullchain.pem.new" "$DEST_DIR/fullchain.pem"
mv -f "$DEST_DIR/.privkey.pem.new" "$DEST_DIR/privkey.pem"

caddy validate --config /etc/caddy/Caddyfile >/dev/null
# RESTART, not reload: the edge Caddyfile runs with `admin off`, so there is no
# admin endpoint for `caddy reload` to talk to — every reload attempt fails.
# A full restart re-reads the config; sub-second gap is acceptable at a ~3-4
# day renewal cadence.
systemctl restart caddy
logger -t foresift-dashboard "caddy restarted with renewed dashboard certificate"
