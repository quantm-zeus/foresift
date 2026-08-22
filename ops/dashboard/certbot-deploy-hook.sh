#!/usr/bin/env bash
# certbot renewal deploy hook for the Foresift dashboard edge.
# Installed by ops/dashboard/deploy-public-dashboard.sh at:
#   /etc/letsencrypt/renewal-hooks/deploy/foresift-dashboard.sh  (root:caddy 0640)
# Shortlived certificates renew every ~3-4 days; this hook makes Caddy pick up
# each renewed certificate without operator action. Readable by the caddy group
# so its presence/behavior is auditable, writable by root only.
set -euo pipefail

# Only react to the dashboard's production certificate lineage.
case "${RENEWED_LINEAGE:-}" in
  */34.87.12.208) ;;
  *) exit 0 ;;
esac

logger -t foresift-dashboard "renewed certificate deployed, reloading caddy"
systemctl reload caddy
