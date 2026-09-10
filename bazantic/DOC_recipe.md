# Finch on Bazantic

Bazantic (`bazantic.com`) is a unified gateway for AI agents — one credential,
many APIs, pay-per-call via x402/MPP. Finch registers its HTTP API as a gateway;
agents then discover and call Finch through Bazantic without holding a Finch key.
Finch is a **peer, not a gatekeeper** — the same endpoint is open for direct
calls, and the Telegram bot / MCP server are other consumers of it.

`<BASE>` below = Finch's deployed https URL (`FINCH_PUBLIC_URL` in `.env`; the
live value and the registered gateway slug are in `DOC_box.local.md`).

## Status — done

Gateway **registered and active** — slug `ui7avlwzinb2bixwluy64t26ia`,
`https://ui7avlwzinb2bixwluy64t26ia.bazgateway.com`. Proxies real
Substreams-backed answers (Bazantic Fly infra → Caddy → box).

`/query` is priced at **1 MCENT = $0.00001** and issues a spec-compliant x402
challenge:

```
$ curl -s -i "$GW/query?wallet=0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0" | head
HTTP/2 402
payment-required: <base64>   # x402 v2 · scheme exact · network eip155:8453 (Base)
                             # · asset 0x833589fC… (USDC) · amount "10" · payTo 0xDE05E390…
www-authenticate: Payment id="…", realm="gateway", method="tempo", …
```

A bare `/query` (no params) is a no-op probe and passes through at 200 — send a
real param to see the 402.

**To actually settle** ($0.00001/call), the calling agent funds a payer: USDC on
Base in `baz wallet address`, or a `baz grant` off a Bazantic hosted balance.
That's the agent's concern, not the gateway operator's — the recipe ends at "the
gateway issues the challenge."

## Register (two operator steps)

Prereqs: `npm i -g @bazantic/cli`, `bazantic/openapi.json` written and served by
`bot/src/http.ts` at `/spec`.

Needs a human:

1. **Deploy `bot/src/http.ts` to a public https URL** — see `deploy/DOC_deploy.md`.
   Its `/spec` route then serves the OpenAPI doc with the real server URL filled
   in.

2. **`baz login`** — a browser device-approval flow (an agent cannot complete
   it; the `BAZANTIC_API_KEY` in `.env` is a *webapp* token and is NOT accepted
   by the CLI control plane — confirmed 401 against `/api/cli/gateways`).

Then:

```bash
baz gateway add \
  --spec-url  <BASE>/spec \
  --endpoint  <BASE> \
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
set the pricing on `finchQuery`, then activate.

**Pricing: x402 at amount `0` — not "free".** A $0.00 *metered* call still runs
the full handshake: the gateway issues `402 Payment Required` with an `accepts`
block, the agent signs a zero-value payment authorization, the gateway verifies
it and serves. "Free" skips the 402 entirely — which defeats the demo. Currency
USDC, chain **Base (`eip155:8453`)** — x402 settles on Base, not Robinhood Chain.
If the wizard rejects amount 0, use the smallest nonzero (e.g. `0.0001`) and fund
the `baz wallet` with a few cents of Base USDC.

Verify the route is metered (not skipped):
```bash
curl -i <BASE>/query        # via the GATEWAY url -> expect 402 + accepts block
```
`pricing: null` in `baz gateway list --json` means it was never set → plain 200.

## What agents get

- `baz gateway list --json` → `endpointUrl`; calls are `{endpointUrl}/query?wallet=0x…`
- Free discovery: `POST {endpointUrl}/mcp` `tools/list`, or probe a path for a `402`
- Paid call:
  ```bash
  baz curl "{endpointUrl}/query?wallet=0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0&q=why+NVDA" \
    --max-amount 0.02 --yes --json
  ```
- Bazantic forwards the paying agent's identity; Finch logs it at
  `GET {endpointUrl}/calls` (and streams it to Telegram when `/seeAgent` is on)

## What a `/query` answer contains

- `event` — the most recent classified transfer of that token to the wallet:
  amount, tx, `received_at` / `age_seconds`, `paid_by_contract`, recipient count
- `path` — present when the payer's `quoteToken()` is the received asset: the
  confirmed route (fee currency of a token's Uniswap V4 pool → Pons FeeEscrow →
  distributor → epoch batch). `recipient_selection` is stated as **not
  on-chain-readable** — epoch-batch membership is claim-gated and the
  distributor's logic contract is unverified source.
- `candidates` — only when `path` is null: correlational only, explicit caveat
- `confidence` — fixed string `"signal only - not a recommendation"` on every
  response

Answers age: `age_seconds` grows, and a newer distribution to the wallet
replaces the surfaced event.

## When NOT to call Finch

Buy/sell signals or scores — Finch never produces these. A confirmed *cause* for
why a specific wallet is in an epoch batch — Finch reports the token's route and
says plainly that the selection is off-chain. `confidence` is a fixed string on
every response; the calling agent owns the decision.
