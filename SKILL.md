# Finch — Robinhood Chain wallet-provenance & Pons launch data

**What it does:** answers factual questions about where a Robinhood Chain
(EVM chain 4663) wallet's tokens came from, and about Pons launchpad activity.
Backed by a Goldsky-hosted subgraph (The Graph protocol). Read-only. No trading,
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
call log: `GET /seeAgent` (min — timestamp + caller), `GET /seeAgentFull`
(full record), `GET /agentOff`.

## JSON response shape

```json
{
  "wallet": "0x…",
  "event": { "token_received": "NVDA", "amount": "0.0074", "tx": "0x…",
             "source_label": "Pons fee claim contract",
             "mechanism": "batched Multicall3 payout, 1 of 100 recipients" },
  "recurring": { "count": 2, "first_seen_block": 53505176, "most_recent_block": 53599582 },
  "candidate_tokens": [ { "symbol": "AI", "address": "0x…", "confidence": "correlational only" } ],
  "caveat": "Candidate tokens reflect trading-history overlap … Not a confirmed causal mechanism.",
  "data_source": "Goldsky-hosted subgraph (Graph protocol), Robinhood Chain 4663",
  "confidence": "signal only - not a recommendation"
}
```

`confidence` is always `"signal only - not a recommendation"`. `caveat` is always
present when `candidate_tokens` is non-empty. Finch supplies data; the calling
agent decides.

## Example

```
curl "{BASE}/query?wallet=0x2a58fb44f78d7b600aec945ba8cb253896793ed3"
```

## Auth / payment

Direct calls are open. The metered path is a Bazantic x402/MPP Gateway that
wraps this same endpoint — see `bazantic/`.
