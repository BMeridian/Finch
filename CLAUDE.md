# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Pivoted off subgraphs.** The Graph dev-rel (Pedro) confirmed a Goldsky-hosted
subgraph does NOT satisfy the track ("must be consumed directly from The Graph's
network or Studio"), and Robinhood Chain (eip155:4663) is on neither. Pure
Substreams is the eligible path (Substreams bounty; whether Pinax-as-registry-
provider also counts for the main track is an open question out to Pedro).

**Live architecture: Substreams → Postgres → bot.**
- `substreams/` module streams from Pinax (`robinhood.substreams.pinax.network:443`).
- `substreams sink postgres` (relational mode on `map_events` / `finch.v1.Events`)
  writes tables `transfer`, `tokenlaunch`, `graduation`, `poolinitialize`,
  `poolswap`, `poolmodifyliquidity` to **Neon** managed Postgres (`DATABASE_URL`).
  No `db_out`/`graph_out`, no schema.sql, no Rust changes — the sink builds the
  schema from the proto.
- Bot queries Neon directly (`bot/src/db.ts`, `pg`). `bot/src/subgraph.ts` deleted;
  `query.ts` / `freshness.ts` / `candidates.ts` / `format.ts` / `serialize.ts` /
  `ens.ts` rewritten GraphQL→SQL.
- On the box: `finch-sink.service` (start-block 53505176, `-H
  'X-Substreams-Parallel-Workers: 1'` — Pinax caps concurrent streams — no stop
  block: backfills to head ~15h then tails live; `Restart=always` absorbs the
  intermittent `ResourceExhausted`).

Goldsky subgraphs still deployed (`SUBGRAPH_QUERY_URL` / `SUBGRAPH_LIVE_URL`) but
the bot no longer reads them. `bot/scripts/seed-from-goldsky.mjs` exists
(block-split seed for history breadth) but is NOT run — pure-Substreams
provenance kept clean pending Pedro. `DOC_prompt.md` build spec is superseded (canonical wallet
`0x2a58fb44…ed3`, 15-token watch list, terser answers).

## What Finch is

A Telegram bot (`@FinchBot`) backed by a Substreams pipeline that indexes Pons
launchpad activity and wallet transfers on Robinhood Chain (chain ID 4663, RPC
`https://rpc.mainnet.chain.robinhood.com`, explorer
`robinhoodchain.blockscout.com`). It answers natural-language questions about a
wallet's activity and new token launches. The query API is also registered
standalone in Bazantic; Finch is just one consumer of it, not a proxy other
agents call through.

## Structure

```
/subgraph    - Legacy AssemblyScript subgraph (Goldsky) — no longer read by the bot
/substreams  - LIVE data source: Substreams module (Pinax) + finch.proto + spkg
/bot         - Telegram bot (@FinchRH_bot) + NLI backend + HTTP API
  src/db.ts        - pg pool + SQL helpers against Neon (the Substreams sink target)
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
  `params.map_raw` `tokens=`, and `bot/src/tokens.ts`. 15 tokens currently
  (NVDA/AAPL/TSLA/AMZN/SPCX/cbBTC/GLD/SPY/QQQ/DJT/GME/RDDT/GOOGL/RBLX/HOOD).
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
- **Deploy target**: Subgraph Studio + The Graph decentralized network do NOT
  support Robinhood Chain (`eip155:4663` — registry lists it with an empty
  `subgraphs` service list). Data source is Pinax Substreams
  (`robinhood.substreams.pinax.network:443`), registry-listed Firehose/Substreams
  provider for this chain, sunk to Neon Postgres.
- **The box is openSUSE Leap 16.0** (`zypper`, not `dnf` — DOC_deploy.md is stale),
  t3.micro, ~935MB RAM with ~136MB free — which is why Postgres is Neon-managed,
  not on-box. Services: `finch-api`, `finch-bot`, `finch-sink`.
- **Live data only** — the sink streams the Pinax endpoint live, not mocked or
  static data. The canonical demo tx is a hardcoded test fixture with locked
  answer wording, but that is a fixture, not a data-source substitute.
- **Pinax concurrent-stream cap**: this key rejects parallel workers
  (`ResourceExhausted: Concurrent stream limit exceeded`). Always pass
  `-H 'X-Substreams-Parallel-Workers: 1'`; retries / `Restart=always` get through.

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
