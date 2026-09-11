# Finch on Bazantic

Bazantic (`bazantic.com`) is a unified gateway for AI agents — one credential,
many APIs, pay-per-call via x402/MPP. Finch registers its HTTP API as a gateway;
agents then discover and call Finch through Bazantic without holding a Finch key.
Finch is a **peer, not a gatekeeper** — the same endpoint is open for direct
calls, and the Telegram bot / MCP server are other consumers of it.

`<BASE>` below = Finch's deployed https URL (`FINCH_PUBLIC_URL` in `.env`; the
live value and the registered gateway slug are in `DOC_box.local.md`).

## Status — done

Gateway **registered and active** — slug in `DOC_box.local.md`
(`<slug>.bazgateway.com`). Proxies real Substreams-backed answers (Bazantic Fly
infra → Caddy → box). Tools exposed: `finchQuery` (GET /query), `finchQueryPost`
(POST /query), **`ensResolve` (GET /ens — reverse 0x→.eth via The Graph's ENS
subgraph)**, `finchHealth` (GET /health).

> Re-syncing the spec: `baz gateway add` on an existing name creates a **new
> slug**, it does not update in place. To pick up a spec change: re-add, set the
> pricing + publish the new gateway, delete the old. `bazDemo.sh` resolves by
> name so it follows automatically; the `payTo` is unchanged.

`/query` and `/ens` are priced at **1 MCENT = $0.00001** each and issue a
spec-compliant x402 challenge:

```
$ curl -s -i "$GW/query?wallet=0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0" | head
HTTP/2 402
payment-required: <base64>   # x402 v2 · scheme exact · network eip155:8453 (Base)
                             # · asset 0x833589fC… (USDC) · amount "10" · payTo 0xDE05E390…
www-authenticate: Payment id="…", realm="gateway", method="tempo", …
```

A bare `/query` (no params) is a no-op probe and passes through at 200 — send a
real param to see the 402.

**Settlement — the calling agent's side, verified working:**

```bash
baz grant create --name finch --cap 0.10      # authorize this device off the
                                              # Bazantic hosted balance (browser approve)
baz curl "$GW/query?wallet=0x2408ce75…&format=prose" --account finch --yes --json
```
→
```json
{ "ok": true, "status": 200,
  "paid": { "amountUsd": "0.00001", "network": "base",
            "transaction": "0x58ccefd2…3752848",
            "explorerUrl": "https://basescan.org/tx/0x58ccefd2…" },
  "body": { "answer": "This wallet received 0.0647 NVDA … 1 of 50 recipients …" } }
```

A real $0.00001 USDC transfer on Base, on-chain, from the hosted balance. Finch
logs it at `/calls` as `bazantic:<id>` and streams it to Telegram under
`/seeAgent`. `bazDemo.sh` runs the whole flow — `BAZ_ACCOUNT=finch ./bazDemo.sh`.

**Finch verifies its own settlement.** Bazantic doesn't forward payment details
upstream, so Finch reads the tx off Base directly:

```
GET {BASE}/x402/verify?tx=<paid.transaction>
-> { "verified": true, "amount_usdc": "0.000010", "network": "base",
     "from": "0x…", "to": "0x…", "block": 51141772,
     "explorer": "https://basescan.org/tx/0x58ccefd2…" }
```

It reads `eth_getTransactionReceipt` on Base, finds the USDC (`0x833589fC…`)
`Transfer` log, and decodes it. `bazDemo.sh` chains this after every paid call.

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

Finish in the **dashboard** (Gateways → the gateway → Resources): set a price on
each route, then **Publish**.

**Price must be nonzero.** `0` = free, the gateway skips the 402 entirely (plain
200) — confirmed. Use `1` MCENT ($0.00001); the gateway then issues the x402
challenge (USDC on Base, `eip155:8453`). Set `/health` to `0` so probes stay
free. After changing prices you must hit **Publish** (a plain Save only drafts).

Verify the route is metered:
```bash
curl -i <BASE>/query?wallet=0x…     # via the GATEWAY url -> expect 402
```

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

## Recipe: FINCH_GRAPH_ENS (published)

A Bazantic **Recipe** — an LLM workflow with a prompt + a whitelist of paid
gateway tools. `bazantic.com/dashboard/recipes/finch-graph-ens`.

**One paid tool call**, `finchQuery` with `ens=1` — provenance and ENS names
resolved together server-side, in-process (no second LLM-mediated round trip):

```
finchQuery (Finch / Substreams + The Graph ENS subgraph, ens=1)
  wallet -> provenance + event.ens_names (address -> .eth names)
```

This used to be two chained tool calls (finchQuery -> ensResolve). Bazantic's
recipe gateway enforces a **hard 30s reverse-proxy timeout** on the whole run —
confirmed directly: `curl` to the recipe-mcp gateway returned `504 "upstream
timeout"` at ~30.1–30.3s, 3/3 tries. Two sequential tool calls, each a network
hop the model waits on and then re-reads a large JSON result from, was
consistently going over that ceiling once `event.batch_recipients` (~50
addresses) was added. Folding the ENS lookup into `/query` itself removes the
second round trip and the second big JSON the model has to read — the
resolution work happens in one Finch process instead of two LLM-mediated hops.

**If the gateway's finchQuery tool doesn't show an `ens` param**: the gateway's
tool schema is generated from `openapi.json` at the time it was last
added/published — re-`baz gateway add` (or re-publish) to pick up the new
`ens=1` parameter (see the re-sync note above).

**Inputs:** `wallet` (required), `symbol` (optional, default NVDA).

**Prompt** (verbatim):

```
Inputs: a wallet address {{inputs.wallet}} and a token symbol {{inputs.symbol}}
(default NVDA if not given).

1. Call finchQuery with wallet=<that address>, q="why did I get {{inputs.symbol}}",
   format=json, ens=1. Take: token received (event.token_received, event.amount),
   the paying contract (event.paid_by_contract), the route (path.route — strings
   with 0x addresses), the epoch batch (event.batch_recipients — 0x addresses of
   every wallet paid in the same tx, including this one), and event.ens_names
   (address -> .eth names, only addresses that resolved — anything not a key
   here has no ENS name). If event is null, say the wallet has no
   {{inputs.symbol}} in Finch's indexed range and stop.
2. Answer, nothing else: one line "<wallet .eth or short 0x> received <amount>
   <token>, routed through <payer .eth or short 0x>", then each route address ->
   its name(s) from event.ens_names or "no ENS name", then a line "ENS names
   found in the batch:" listing every OTHER address from event.batch_recipients
   that is a key in event.ens_names (name -> short 0x); omit that line entirely
   if none are. No preamble, no notes, no confidence or disclaimer paragraph —
   Finch's JSON already carries that and the caller strips it.

Never give trading advice.
```

**Verified run** — `wallet=0x36de68e810781dd7699d8fc7fe7def8aae51cec2`:
`daio.eth received 0.0117 NVDA, routed through the Pons holder-fee distributor
(no ENS name)`, with the FeeEscrow / distributor / pool addresses all shown as
Robinhood Chain contracts with no `.eth`.

The standalone script version is `recipes/ens-enrich.mjs` (same chain, run
locally; uses The Graph's subgraph MCP for discovery).
