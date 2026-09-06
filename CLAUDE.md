# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phase 1 done: subgraph live on Goldsky (`finch-rpc/0.4.0`, chain `robinhood-mainnet`;
`SUBGRAPH_QUERY_URL` in `.env`). Bot + NLI + HTTP API built. Track B substreams
module built, subgraph sink still open (Goldsky does not do substreams-powered
subgraphs). `DOC_prompt.md` is the build spec — but the demo fixture, watch list,
and answer wording in it have been superseded by later chat instructions
(canonical wallet `0x2a58fb44…ed3`, 14-token watch list, terser bot answers).

## What Finch is

A Telegram bot (`@FinchBot`) backed by a subgraph that indexes Pons launchpad
activity and wallet transfers on Robinhood Chain (chain ID 4663, RPC
`https://rpc.mainnet.chain.robinhood.com`, explorer
`robinhoodchain.blockscout.com`). It answers natural-language questions about a
wallet's activity and new token launches. The subgraph-backed query API is also
registered standalone in Bazantic; Finch is just one consumer of it, not a
proxy other agents call through.

## Structure

```
/subgraph    - The Graph subgraph (schema, subgraph.yaml, AssemblyScript mappings)
/substreams  - Track B: Substreams-powered subgraph (Pinax source) — sink still open
/bot         - Telegram bot (@FinchRH_bot) + NLI backend + HTTP API
  src/answer.ts    - answer() prose / answerJson() structured — shared extract+query
  src/http.ts      - HTTP API (the endpoint Bazantic wraps): /query /health /calls /SKILL.md
  src/calllog.ts   - every Gateway/agent call logged (in-memory ring + .calls.jsonl)
  src/freshness.ts - subgraph head vs chain head staleness check (/health)
/bazantic    - gateway.json (x402/MPP config) + DOC_recipe.md
SKILL.md     - machine-readable manifest, also served at /SKILL.md
```

Run: `cd bot && npm start` (Telegram) and `npm run serve` (HTTP API, port
`FINCH_HTTP_PORT`, default 8787). The two are independent processes over the
same `answer()`/`answerJson()` backend.

## Architecture notes that span multiple files

- **Index the full Pons lifecycle**, not just launch+swap: launch
  (`TokenLaunched`) -> curve trading (`CurveBuy`/`CurveSell`) -> graduation
  (`LaunchSwept` / `GraduationTokensPermanentlyLocked` / `PoolGraduated`) ->
  post-graduation Uniswap V4 pool behind the Meme Hook. `graduated` is a
  first-class schema field the NLI layer depends on.
- **Subgraph mappings must decode Multicall3 batch calls** (`aggregate3` /
  `tryAggregate`), not only top-level `Transfer` events — the real fee
  settlement (many tokens, many recipients) happens inside one multicall tx.
- **The `Launchpad` entity is generalized on purpose** — do not hardcode "Pons".
  Pons is the primary worked example; Pools.trade is an optional second source.
- **Token watch list** is defined in THREE places that must stay in sync:
  `subgraph/src/constants.ts` `WATCHED`, `substreams/substreams.yaml`
  `params.map_raw` `tokens=`, and `bot/src/tokens.ts`. 14 tokens currently
  (NVDA/AAPL/TSLA/AMZN/SPCX/cbBTC/GLD/SPY/QQQ/DJT/GME/RDDT/GOOGL/RBLX).
  WETH + USDG are NOT watched for Transfers but ARE pool pairing assets —
  `constants.ts` `PAIRING_EXTRA` / substreams `pairing=` param.
  Each watch-list change needs a subgraph data-source edit + redeploy.
- **Distributor topology is an open investigation** (see DOC_prompt.md
  "Distributor topology"): confirm whether recipient contracts are an
  EIP-1167 clone/factory pattern before finalizing the schema. If confirmed,
  index the factory deploy event as an entity; if not, model direct
  FeeEscrow -> recipient payouts with no intermediary.
- **Two-layer NLI responses**: a normalization/classification layer maps known
  address categories (FeeEscrow, claim contract, factory, user's own wallet) to
  plain labels before the LLM formats. The default answer never shows a bare hex
  address; the technical trace is drill-down only, shown on explicit request.
- **Verify before hardcoding**: only three contract addresses in DOC_prompt.md
  are independently verified (Pons V2 factory, Meme Hook, V1 legacy factory).
  Check every other address (PoolManager, PositionManager, FeeEscrow, stock
  tokens, demo fixture addresses) on Blockscout first.
- **Deploy target**: Subgraph Studio does NOT support Robinhood Chain (confirmed
  — The Graph networks registry lists `eip155:4663` with an empty `subgraphs`
  service list; Studio deploy returns "network not supported"). Use Goldsky or
  Pinax (registry-listed Substreams/Firehose provider for this chain). The
  `GRAPH_QUERY_KEY` gateway keys in `.env` cannot query a non-network subgraph.
- **Live data only** — the subgraph must query the Goldsky/Pinax endpoint live,
  not mocked or static data (Graph requirement). The canonical demo tx is
  hardcoded as a test fixture with locked answer wording, but that is a fixture,
  not a data-source substitute.

## Hard constraints

- **No trading logic anywhere**: no buy/sell signals, scoring, weighting,
  ranking, or "should I buy" logic. Strictly data indexing and factual
  retrieval.
- Do not go further on parent-token attribution than DOC_prompt.md's completed
  trace — full lineage resolution is explicitly out of scope.
- Build in the specified order: subgraph Phase 1 POC must return the demo tx in
  Studio's playground and be confirmed working before anything else is built.
- Do not `git commit`/`push` until explicitly told to. Keep commit history
  incremental (judges flag single-commit dumps).

## Code style

- Compact: fit logic on one line where reasonable; align `=` and `return` in
  adjacent lines.
- Python: no `from typing import ...` imports at all. Check what stdlib/packages
  are already installed before assuming.
- Leave commented-out code in place when rewriting; don't delete it.
- Prefix any new markdown file with `DOC_`.
- If a requirement is ambiguous, state the assumption and proceed.
