#!/usr/bin/env bash
# Finch deploy. Run on the box:  sudo bash ~/_Finch/deploy/setup.sh
# The full repo tree (bot/ subgraph/ bazantic/ deploy/ SKILL.md ...) must already
# be at $REPO (default /home/ec2-user/_Finch). Override with REPO=/path sudo -E bash ...
# Works on openSUSE (zypper) and Fedora/AL2023 (dnf).
set -euo pipefail

REPO=${REPO:-/home/ec2-user/_Finch}
APP="$REPO/bot"
RUN_USER=${RUN_USER:-ec2-user}
[ -f "$APP/package.json" ] || { echo "expected the app at $APP — set REPO= to the repo root"; exit 1; }

if command -v zypper >/dev/null; then PKG="zypper -n install"; NODE_PKG="nodejs22 npm22 caddy"
elif command -v dnf >/dev/null;   then PKG="dnf install -y";   NODE_PKG="caddy"; fi

echo "== packages =="
if command -v zypper >/dev/null; then
  $PKG $NODE_PKG
else
  command -v node >/dev/null && [[ "$(node -v)" == v22* ]] || { curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -; dnf install -y nodejs; }
  command -v caddy >/dev/null || { dnf install -y 'dnf-command(copr)'; dnf copr enable -y @caddy/caddy; dnf install -y caddy; }
fi
node -v; caddy version

echo "== env =="
mkdir -p /etc/finch
[ -f /etc/finch/finch.env ] || install -m 600 "$REPO/deploy/finch.env" /etc/finch/finch.env
chown "$RUN_USER:$RUN_USER" /etc/finch/finch.env
grep -q '^FINCH_SKILL_PATH=' /etc/finch/finch.env || echo "FINCH_SKILL_PATH=$REPO/SKILL.md"           >> /etc/finch/finch.env
grep -q '^FINCH_SPEC_PATH='  /etc/finch/finch.env || echo "FINCH_SPEC_PATH=$REPO/bazantic/openapi.json" >> /etc/finch/finch.env
grep -q '^FINCH_HOSTNAME=.\+' /etc/finch/finch.env || echo "  !! set FINCH_HOSTNAME in /etc/finch/finch.env (e.g. <ip-dashed>.sslip.io) then re-run"

echo "== deps =="
( cd "$APP" && sudo -u "$RUN_USER" npm ci --omit=dev )

echo "== caddy =="
mkdir -p /var/log/caddy
install -m 644 "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/10-finch-env.conf <<'DROPIN'
[Service]
EnvironmentFile=/etc/finch/finch.env
DROPIN

echo "== services =="
# WorkingDirectory in these units must match $APP — they ship pointing at
# /home/ec2-user/_Finch/bot. If REPO/RUN_USER differ, they are rewritten here.
for u in finch-api finch-bot; do
  sed -e "s|^WorkingDirectory=.*|WorkingDirectory=$APP|" \
      -e "s|^User=.*|User=$RUN_USER|" \
      "$REPO/deploy/$u.service" > "/etc/systemd/system/$u.service"
  chmod 644 "/etc/systemd/system/$u.service"
done
systemctl daemon-reload
systemctl enable --now finch-api
grep -q '^TELEGRAM_BOT_TOKEN=.\+' /etc/finch/finch.env && systemctl enable --now finch-bot || echo "  (finch-bot not started — no TELEGRAM_BOT_TOKEN)"
grep -q '^FINCH_HOSTNAME=.\+'     /etc/finch/finch.env && systemctl enable --now caddy || echo "  (caddy not started — no FINCH_HOSTNAME)"

echo
curl -s localhost:8787/health || echo "(api not up — journalctl -u finch-api -n 50)"
echo
echo "Done. Public URL = https://\$FINCH_HOSTNAME/  ->  /query /health /calls /SKILL.md /spec"
