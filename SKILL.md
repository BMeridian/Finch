# Finch — Robinhood Chain wallet-provenance & Pons launch data

**What it does:** answers factual questions about where a Robinhood Chain
(EVM chain 4663) wallet's tokens came from, and about Pons launchpad activity.
Backed by a subgraph (The Graph's schema + AssemblyScript mappings) hosted on
Goldsky, indexing the Pons launch factory, the Uniswap V4 PoolManager (pools
behind Pons's Meme Hook), and stock-token transfers. Read-only. No trading,
scoring, or recommendations — data only.

## When to call Finch

- A wallet received a Robinhood tokenized-stock token and you want to know the
  source (fee settlement, direct transfer, batched payout) and whether it is a
  recurring entitlement.
- You want candidate tokens that *might* be economically linked to a wallet's
  fee payout — explicitly correlational, never a confirmed cause.
- You want recent Pons token launches, or whether a specific token graduated to
  a Uniswap V4 pool.

## Endpoint

`GET|POST {BASE}/query`

| param | where | meaning |
|---|---|---|
| `wallet` | query or JSON body | 0x address to look up |
| `q` | query or JSON body | natural-language question (optional; defaults to "why did I get NVDA" when only a wallet is given) |
| `format` | query or JSON body | `json` (default) or `prose` |

Other routes: `GET /health` (subgraph freshness vs chain head), `GET /calls`
(who has called Finch), `GET /SKILL.md` (this file). Operator toggles for the
call log: `GET /seeAgent` (full record — caller, question, latency),
`GET /seeAgentMin` (terse), `GET /agentOff`.

## JSON response shape (wallet provenance)

Two parts: `event` + `recurring` are the **fact** (what the chain says happened);
`distributor` + `candidates` are the **frame** (context for interpreting it).

```json
{
  "wallet": "0x…",
  "event": { "token_received": "NVDA", "amount": "0.0121", "tx": "0x…",
             "from_distributor": "0xe25e9bc3…", "recipients_in_tx": 105,
             "source_label": "Pons fee claim contract" },
  "recurring": { "count": 2, "first_seen_block": 53505176, "most_recent_block": 53599582 },
  "distributor": {
    "address": "0xe25e9bc3…",
    "declared_token": { "symbol": "microduck", "address": "0x…", "description": null },
    "quote_token": "0x…(NVDA)", "holds_quote_token": "65.6871",
    "exposes": ["claim()", "distribute()", "rollOver()", "hasClaimed()"],
    "epoch_count": 897, "wallet_excluded": false
  },
  "candidates": [
    { "symbol": "microduck", "address": "0x…", "description": null,
      "basis": "the distributor's declared token()" },
    { "symbol": "PONS", "address": "0x…", "description": "100% of fees go back to Pons",
      "basis": "NVDA-paired Uniswap V4 pool; this wallet has transferred it" }
  ],
  "note": "Candidates are why this wallet MIGHT be a recipient — not a resolved cause. …",
  "data_source": "…",
  "confidence": "signal only - not a recommendation"
}
```

`confidence` is always `"signal only - not a recommendation"`. `candidates[]` are
**not ranked causes** — why a wallet is on a distributor's recipient list is not
readable on-chain. `description` is the launcher's own claim (`description()`,
written at launch, immutable). Finch supplies data; the calling agent decides.

## Examples

```
# wallet provenance
curl "{BASE}/query?wallet=0x2a58fb44f78d7b600aec945ba8cb253896793ed3"

# recent Pons launches, optionally filtered by pairing token
curl "{BASE}/query?q=what+launched+on+pons+recently+NVDA&format=prose"

# has a specific token graduated to a Uniswap V4 pool?
curl "{BASE}/query?q=has+0x…+graduated&format=prose"
```

## MCP server

Finch is also an MCP stdio server (`bot/src/mcp.ts`) — for Claude Code, Claude
Desktop, Cursor. It calls this same HTTP API. Tools:

- `finch_wallet_provenance` — `{ wallet, question?, format? }` → provenance
- `finch_pons_activity` — `{ question }` → recent launches / graduation status
- `finch_health` — `{}` → subgraph freshness

Run: `FINCH_HTTP_BASE={BASE} npm run mcp` (from `bot/`).

## Discovery loop (cold agent)

1. `GET {BASE}/SKILL.md` (this file) or `GET {BASE}/spec` (OpenAPI)
2. `GET {BASE}/query?wallet=0x…`
3. `GET {BASE}/calls` — confirm the call was logged (proof of a real agent call)

`bot/src/testagent.ts` runs exactly this loop and asserts the response invariants.

## Limitations — an agent acting on Finch's output should know

- **Candidate tokens are correlational, never causal.** They reflect trading-history
  overlap with Uniswap V4 pools paired against the received token. `caveat` states this.
- **The true source token may be absent from the candidate list entirely.** A project
  can collect fees in ETH, have its treasury *buy* the payout asset on the market, and
  airdrop it to holders — with no pool ever pairing that project against the asset.
- **Off-chain / other-rollup treasuries are invisible.** e.g. a perp position on Lighter.
- **Only Pons is indexed.** Tokens launched on other Robinhood-Chain launchpads
  (lunch.fun, Longbow/LONG, …) are not in the data.
- **The deep-history subgraph is still backfilling.** `GET /health` reports
  `history_lag_blocks`; recent activity is served fresh from the live-window subgraph,
  older activity may be incomplete until backfill completes.

## Auth / payment

Direct calls are open. The metered path is a Bazantic x402/MPP Gateway that
wraps this same endpoint — see `bazantic/DOC_recipe.md` for the cold-start recipe.
