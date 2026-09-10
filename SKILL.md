# Finch — Robinhood Chain wallet provenance & Pons launch data

**What it does:** answers factual questions about where a Robinhood Chain
(EVM chain 4663) wallet's tokens came from, and about Pons launchpad activity.
The Graph Network doesn't index Robinhood Chain; Finch does — a pure Substreams
pipeline (Pinax Firehose → `substreams sink postgres` → Postgres) indexing the
Pons launch factory, the Uniswap V4 PoolManager (pools behind Pons's Meme Hook),
and tokenized-stock transfers — plus live on-chain contract reads. Pons lifecycle: launch → graduation → the Uniswap V4 pool the token lands
in; Finch decodes the last hop, the hard part — V4's singleton PoolManager and
per-pool hooks are opaque to generic indexers and block explorers. Read-only.

## When to call Finch

- A wallet received a Robinhood tokenized-stock token and you want the route it
  took: which memecoin's fee stream it came from, through which contracts, and
  how often this wallet has received from that source.
- You want recent Pons token launches, or whether a specific token graduated to
  a Uniswap V4 pool.

## Endpoint

`GET|POST {BASE}/query`

| param | where | meaning |
|---|---|---|
| `wallet` | query or JSON body | 0x address to look up |
| `q` | query or JSON body | natural-language question (optional; defaults to "why did I get NVDA" when only a wallet is given) |
| `format` | query or JSON body | `json` (default) or `prose` |

Other routes: `GET /health` (index freshness vs chain head), `GET /calls`
(who has called Finch), `GET /x402/verify?tx=0x…` (reads a Bazantic x402
settlement off Base and decodes the USDC transfer), `GET /SKILL.md` (this file),
`GET /spec` (OpenAPI).
Operator toggles for the call log: `GET /seeAgent` (full record — caller,
question, latency), `GET /seeAgentMin` (terse), `GET /agentOff`.

## JSON response shape (wallet provenance)

- `event` + `recurring` — the **fact**: what the chain says happened.
- `path` — the **confirmed route**, present when the payer's `quoteToken()` is
  the asset received. `null` otherwise.
- `candidates` — correlational only, present **only when `path` is null**.

```json
{
  "wallet": "0x…",
  "event": {
    "token_received": "NVDA",
    "amount": "0.0915",
    "tx": "0x…",
    "block": 57901577,
    "received_at": "2026-09-08T18:23:32.000Z",
    "age_seconds": 1506,
    "paid_by_contract": "0xe25e9bc31d24bb652fb6e2e466d7c9c89701173e",
    "recipients_in_tx": 73,
    "source_label": "Pons fee claim contract"
  },
  "recurring": { "count": 302, "first_seen_block": 53488824, "most_recent_block": 57901577 },
  "path": {
    "type": "pons_holder_fee_distribution",
    "distributes": "NVDA",
    "fee_pool_token": { "symbol": "microduck", "address": "0x…", "description": null },
    "distributor_registered_in_manager": true,
    "route": [
      "microduck / NVDA Uniswap V4 pool (Pons Meme Hook) — microduck's creator-fee cut is taken in NVDA",
      "Pons FeeEscrow 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
      "Pons holder-fee distributor 0xe25e9bc3… (PonsHolderFeeManager.distributorOf(microduck) == this; quoteToken()=NVDA, epochCount()=924)",
      "epoch batch → this wallet + 73 others"
    ],
    "epoch_count": 924,
    "distributor_functions": ["claim()", "claim(uint256,address,uint256,uint256,bytes32[])", "hasClaimed(uint256,address)", "rollOver(uint256)"],
    "references_v4_pool_manager": true,
    "recipient_selection": "not on-chain-readable — claim-gated, per epoch; distributor's distribution logic is unverified source"
  },
  "candidates": [],
  "note": "Route confirmed on-chain: the payer distributes the received asset, which is the fee currency of the named token's Uniswap V4 pool. Why this wallet is in this epoch's batch is not on-chain-readable.",
  "data_source": "…",
  "confidence": "signal only - not a recommendation"
}
```

When the path can't be confirmed, `path` is `null` and `candidates[]` lists
tokens the wallet holds that also have a Uniswap V4 pool paired against the
received asset — `confidence: "correlational only"`, never a ranked cause.

`confidence` is always `"signal only - not a recommendation"`. Finch supplies
data; the calling agent decides.

## What Finch verifies

Given the transfer's literal `from` address D:

1. `D.token()` -> one token T, `D.quoteToken()` -> the asset paid out.
2. `PonsHolderFeeManager(0x70e95CC5…).distributorOf(T) == D` — D is T's unique
   registered holder-fee distributor (`distributor_registered_in_manager`).
3. If `quoteToken()` == the asset received, the route is confirmed: T's
   creator-fee cut, taken in the currency T's V4 pool is paired against, flows
   through the Pons FeeEscrow to D, then to a per-epoch batch of holders.

Not verified: which addresses land in a given epoch's batch (the distributor's
distribution logic is unverified source; entry is claim-gated).

## Examples

```
# wallet provenance (confirmed-path example)
curl "{BASE}/query?wallet=0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0"

# prose, with a question
curl "{BASE}/query?wallet=0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0&q=trace+NVDA&format=prose"

# recent Pons launches, optionally filtered by pairing token
curl "{BASE}/query?q=what+launched+on+pons+recently+NVDA&format=prose"

# has a specific token graduated to a Uniswap V4 pool?
curl "{BASE}/query?q=has+0x…+graduated&format=prose"
```

## MCP server

Finch is also an MCP stdio server (`bot/src/mcp.ts`) — for Claude Code, Claude
Desktop, Cursor. It calls this same HTTP API. Tools:

- `finch_wallet_provenance` — `{ wallet, question?, format? }` -> provenance
- `finch_pons_activity` — `{ question }` -> recent launches / graduation status
- `finch_health` — `{}` -> index freshness

Run: `FINCH_HTTP_BASE={BASE} npm run mcp` (from `bot/`).

## Discovery loop (cold agent)

1. `GET {BASE}/SKILL.md` (this file) or `GET {BASE}/spec` (OpenAPI)
2. `GET {BASE}/query?wallet=0x…`
3. `GET {BASE}/calls` — confirm the call was logged (proof of a real agent call)

`bot/src/testagent.ts` runs exactly this loop and asserts the response invariants.

## Limitations — an agent acting on Finch's output should know

- **Finch indexes transfers of 15 tokenized stocks**
  (NVDA AAPL TSLA AMZN SPCX cbBTC GLD SPY QQQ DJT GME RDDT GOOGL RBLX HOOD).
  A payout in any other asset is not seen.
- **Epoch-batch membership is off-chain.** Finch confirms the route the asset
  took, not why this wallet, and not another holder, is in a given batch.
- **Treasury-funded payouts are invisible.** A project can collect fees in ETH,
  have its treasury *buy* the payout asset, and airdrop it — with no pool ever
  pairing that project against the asset. `quoteToken()` won't match; `path`
  is `null` and only correlational candidates are returned.
- **Off-chain / other-rollup treasuries are invisible.** e.g. a perp position on
  Lighter.
- **Only Pons is indexed.** Tokens launched on other Robinhood-Chain launchpads
  (lunch.fun, Longbow/LONG, …) are not in the data.

## Auth / payment

Direct calls are open. The metered path is a Bazantic x402/MPP Gateway that
wraps this same endpoint — see `bazantic/DOC_recipe.md` for the cold-start recipe.
