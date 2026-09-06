# Finch on Bazantic

Bazantic (`bazantic.com`) is a unified gateway for AI agents — one credential,
many APIs, pay-per-call via x402/MPP. Finch registers its HTTP API as a gateway;
agents then discover and call Finch through Bazantic without holding a Finch key.
Finch is a **peer, not a gatekeeper** — the same endpoint is open for direct
calls, and the Telegram bot / MCP server are other consumers of it.

## Register (two operator steps)

Prereqs done: `npm i -g @bazantic/cli` (installed), `bazantic/openapi.json`
written and served by `bot/src/http.ts` at `/spec`.

Still needs a human:

1. **Deploy `bot/src/http.ts` to a public https URL** — see `bot/DOC_deploy.md`.
   Its `/spec` route then serves the OpenAPI doc with the real server URL filled
   in.

2. **`baz login`** — a browser device-approval flow (an agent cannot complete
   it; the `BAZANTIC_API_KEY` in `.env` is a *webapp* token and is NOT accepted
   by the CLI control plane — confirmed 401 against `/api/cli/gateways`).

Then:

```bash
baz gateway add \
  --spec-url  https://<deployed>/spec \
  --endpoint  https://<deployed> \
  --name      "Finch" \
  --auth-type x402-mpp \
  --status    draft \
  --json
# -> { ok, id, slug, mcpUrl }
```

`--auth-type x402-mpp` because Finch needs no upstream credential — direct
`/query` calls are free; the gateway meters. (Do NOT use `--auth-type jwt` — the
CLI offers it but the gateway has no jwt branch and silently drops the service.)

Finish in the dashboard wizard (`/gateways/new`, ANALYZE → REVIEW → ACTIVATE):
set per-method price on `finchQuery`, then activate.

## What agents get

- `baz gateway list --json` → `endpointUrl`; calls are `{endpointUrl}/query?wallet=0x…`
- Free discovery: `POST {endpointUrl}/mcp` `tools/list`, or probe a path for a `402`
- Paid call: `baz curl {endpointUrl}/query?wallet=0x2a58fb44f78d7b600aec945ba8cb253896793ed3 --max-amount 0.02 --yes --json`
- Bazantic forwards the paying agent's identity; Finch logs it at `GET {endpointUrl}/calls`

## When NOT to call Finch

Buy/sell signals or scores — Finch never produces these. Parent-token fee
attribution to certainty — Finch gives correlational candidates with an explicit
caveat, never a confirmed cause. `confidence` is a fixed string on every
response; the calling agent owns the decision.
