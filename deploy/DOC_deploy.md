# Deploy Finch HTTP API to the AWS box

Target: `ec2-user@YOUR_BOX_IP` (Amazon Linux 2023, Stockholm). Runtime footprint
~300 MB / near-zero CPU — fine on t3.micro.

## 1. Sync the repo to ~/_Finch

The box holds the full repo tree at `/home/ec2-user/_Finch/`. From this repo root
(do NOT use `--delete` with a partial file list — it will wipe siblings):

```bash
rsync -avz \
  --exclude 'node_modules' \
  --exclude '.session.json' --exclude '.calls.jsonl' --exclude '.seemode' \
  --exclude '.git' --exclude '.env' --exclude '*.jpg' \
  -e "ssh -i YOUR_KEY.pem" \
  ./ ec2-user@YOUR_BOX_IP:/home/ec2-user/_Finch/
```

ec2-user owns its home dir, so this writes directly — no `/tmp` staging or `sudo`.

## 2. One-time setup on the box

```bash
ssh -i YOUR_KEY.pem ec2-user@YOUR_BOX_IP
sudo bash /home/ec2-user/_Finch/deploy/setup.sh
```

Installs Node 22 + Caddy, `npm ci` in `bot/`, writes `/etc/finch/finch.env`,
installs + starts `finch-api.service` (and `finch-bot.service` if you set
`TELEGRAM_BOT_TOKEN`), starts Caddy.

## 3. Hostname + TLS

- Point an A record (`finch.yourdomain`) at `YOUR_BOX_IP`.
- `sudo vi /etc/caddy/Caddyfile` → replace `finch.example.com`.
- `sudo systemctl restart caddy` — cert is fetched on first hit.
- Security group: allow inbound **443** (and 80 for the ACME challenge).

No domain yet? Uncomment the `:80 { reverse_proxy localhost:8787 }` block in the
Caddyfile and use `http://YOUR_BOX_IP/` for a smoke test.

## 4. Verify (from your laptop)

```bash
BASE=https://finch.yourdomain
curl -s $BASE/health
curl -s "$BASE/query?wallet=0x2a58fb44f78d7b600aec945ba8cb253896793ed3" | head -c 300
curl -s $BASE/SKILL.md | head -3
curl -s $BASE/spec | python3 -c 'import sys,json;print(json.load(sys.stdin)["servers"])'
curl -s -H 'x-payer: agent://smoke' "$BASE/query?wallet=0x2a58fb44f78d7b600aec945ba8cb253896793ed3" >/dev/null
curl -s $BASE/calls | python3 -c 'import sys,json;print(json.load(sys.stdin)["stats"]["by_caller"])'
```

## 5. Redeploy after code changes

```bash
# re-run the rsync from step 1, then:
ssh -i YOUR_KEY.pem ec2-user@YOUR_BOX_IP \
  'cd /home/ec2-user/_Finch/bot && npm install --omit=dev && sudo systemctl restart finch-api finch-bot'
```

## 6. Then wire Bazantic

`baz gateway add --spec-url https://finch.yourdomain/spec --endpoint https://finch.yourdomain --name Finch --auth-type x402-mpp --status draft --json`
— see `bazantic/DOC_recipe.md`.

## Logs

```bash
journalctl -u finch-api -f
journalctl -u finch-bot -f
tail -f /var/log/caddy/finch.log
```
