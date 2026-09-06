# Deploy the Finch HTTP API (the Bazantic gateway upstream)

The service is `bot/src/http.ts` — one process, stateless except for two
gitignored files it writes (`bot/.calls.jsonl`, `bot/.seemode`). Needs a
persistent public URL (judges will poke at it after the demo), so a real host,
not a tunnel.

## Required env vars (set in the host dashboard)

| var | value |
|---|---|
| `SUBGRAPH_QUERY_URL` | `https://api.goldsky.com/api/public/project_cmtp3v04cmqa101vr9xgv7rvm/subgraphs/finch-rpc/0.4.0/gn` |
| `RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` |
| `OPENROUTER_API_KEY` | optional — prose rephrasing only |
| `FINCH_HTTP_PORT` | the host's injected `$PORT` (Railway/Render set this) |

Do NOT set `TELEGRAM_BOT_TOKEN` here — the HTTP API and the Telegram bot are
separate processes; this deploy is the HTTP API only.

## Option A — Railway (deploy from local, no GitHub push needed)

```
npm i -g @railway/cli
railway login
railway init                       # new project "finch-api"
railway up --detach                # uploads bot/ + repo root, builds via Dockerfile
railway variables set SUBGRAPH_QUERY_URL="…" RPC_URL="https://rpc.mainnet.chain.robinhood.com"
railway domain                     # -> https://finch-api-production.up.railway.app
```

Railway builds from `bot/Dockerfile`. Because the Dockerfile `COPY`s `SKILL.md`
from the repo root, run `railway up` from the **repo root**, or add a
`railway.json` with `"build": { "dockerfilePath": "bot/Dockerfile" }` and root
context.

## Option B — Render (needs the repo on GitHub)

`render.yaml` at repo root:

```yaml
services:
  - type: web
    name: finch-api
    runtime: docker
    dockerfilePath: ./bot/Dockerfile
    dockerContext: .
    healthCheckPath: /health
    envVars:
      - key: SUBGRAPH_QUERY_URL
        value: https://api.goldsky.com/api/public/project_cmtp3v04cmqa101vr9xgv7rvm/subgraphs/finch-rpc/0.4.0/gn
      - key: RPC_URL
        value: https://rpc.mainnet.chain.robinhood.com
```

Push repo → Render → New → Blueprint → pick the repo. URL:
`https://finch-api.onrender.com`.

## After deploy — wire Bazantic

1. In `bazantic/gateway.json`, set `upstream.base_url` to the deployed URL and
   `service.skill_manifest` to `<url>/SKILL.md`.
2. Register with `BAZANTIC_API_KEY` (see `bazantic/DOC_recipe.md`).
3. Live-path check:
   ```
   curl -s "<deployed-url>/health"                       # fresh?
   curl -s -H 'x-payer: agent://tester' "<bazantic-gateway-url>/query?wallet=0x2a58fb44f78d7b600aec945ba8cb253896793ed3"
   curl -s "<deployed-url>/calls"                         # caller: agent://tester present
   ```
