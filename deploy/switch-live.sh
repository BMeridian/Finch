#!/usr/bin/env bash
# switch-live.sh — repoint SUBGRAPH_LIVE_URL on the box to a fresh Goldsky deploy.
#
# Use when the current Goldsky account's free credits are exhausted and finch-live
# is paused. Deep-history (SUBGRAPH_QUERY_URL / finch-rpc) is left as-is — its
# indexed range is complete and historical payouts don't move.
#
#   ./deploy/switch-live.sh 'https://api.goldsky.com/api/public/project_XXX/subgraphs/finch-live/0.3.0/gn'
#   ./deploy/switch-live.sh --query 'https://…/finch-rpc/1.0.0/gn'   # also swap history
#
# Box coords come from $FINCH_SSH_KEY / $FINCH_BOX, or a gitignored
# deploy/.box.local file (KEY=… / BOX=… lines).

set -euo pipefail

[ -f "$(dirname "$0")/.box.local" ] && . "$(dirname "$0")/.box.local"
KEY="${FINCH_SSH_KEY:-${KEY:-$HOME/path/to/deploy-key.pem}}"
BOX="${FINCH_BOX:-${BOX:-ec2-user@YOUR_BOX_IP}}"
ENVFILE="/etc/finch/finch.env"

VAR="SUBGRAPH_LIVE_URL"
if [ "${1:-}" = "--query" ]; then VAR="SUBGRAPH_QUERY_URL"; shift; fi

URL="${1:-}"
case "$URL" in
  https://*/gn) ;;
  *) echo "usage: $0 [--query] 'https://api.goldsky.com/.../subgraphs/<name>/<ver>/gn'"; exit 1 ;;
esac

echo "box:  $BOX"
echo "var:  $VAR"
echo "new:  $URL"
echo

ssh -i "$KEY" "$BOX" "
  set -e
  sudo cp $ENVFILE ${ENVFILE}.bak.\$(date +%s)
  sudo sed -i 's#^${VAR}=.*#${VAR}=${URL}#' $ENVFILE
  echo '--- $ENVFILE now ---'
  sudo grep SUBGRAPH $ENVFILE
  sudo systemctl restart finch-api finch-bot
  sleep 3
  echo '--- services ---'
  systemctl is-active finch-api finch-bot
  echo '--- /health ---'
  curl -s localhost:8787/health
"
