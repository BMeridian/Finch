# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Pivoted off subgraphs.** The Graph dev-rel (Pedro) confirmed a Goldsky-hosted
subgraph does NOT satisfy the track, **and neither does Goldsky-seeded data** —
"we will not recognize Goldsky Subgraphs, that team is not affiliated with The
Graph." Robinhood Chain (eip155:4663) is not on The Graph's network or Studio.
The eligible path is **pure Substreams consumed from a Graph provider**.

**Live architecture: Substreams → Postgres → bot.**
- `substreams/` module, published as `finch-substreams@v0.1.0` on substreams.dev.
- **Data source: StreamingFast's Robinhood endpoint** (`mainnet.robinhood
  .streamingfast.io:443`), auth = a **thegraph.market** Substreams token
  (`SUBSTREAMS_API_TOKEN` — FREE tier, 5 parallel workers). Made this account at
  thegraph.market; its token also works against Pinax's endpoint.
  (Pinax's own free keys hit concurrent-stream quota walls — dead ends. The
  thegraph.market Hosted Sink portal is beta and was too buggy to use — identifier
  parser rejects `substreams-dev://`, config doesn't persist on restart.)
- `substreams sink postgres` (relational mode on **`map_raw`** / `finch.v1.Events`)
  writes `transfer`, `tokenlaunch`, `graduation`, `poolinitialize`, `poolswap`,
  `poolmodifyliquidity` to **Neon** free-tier Postgres (`DATABASE_URL`). No
  `db_out`, no schema.sql, no Rust — sink builds the schema from the proto.
  `map_raw` not `map_events`: `map_events` needs ~3.5M blocks of store
  backprocessing before it emits; `map_raw` starts at any block.
- Bot queries Neon directly (`bot/src/db.ts`, `pg`). `subgraph.ts` deleted;
  `query.ts` / `freshness.ts` / `candidates.ts` / `format.ts` / `serialize.ts` /
  `ens.ts` rewritten GraphQL→SQL.
- On the box: `finch-sink.service` (`--start-block` near chain head — see below),
  no stop block, `Restart=always`.

**Neon free tier is 512 MB and this chain overruns it.** `map_raw` emits every
Uniswap V4 swap (`poolswap` ~200 MB, unused by the bot) and Transfer volume is
~0.8 MB / 1000 blocks (fee-settlement multicalls). So:
- `finch-sink.service` starts near chain head (last ~1–2 days), NOT full history.
  The canonical demo wallet `0x2a58fb44…ed3` (last payout ~7 days back) is out of
  range — headline `0x2408ce75…` / `0x36de68e8…` instead. Full history needs
  paid Neon (~$19) or ClickHouse.
- `finch-prune.timer` (hourly) runs `bot/scripts/prune-neon.mjs`: TRUNCATE
  `poolswap` / `poolmodifyliquidity` every run, and keep `transfer` to a rolling
  `PRUNE_WINDOW_BLOCKS` (250k ≈ 3 days) window. Launches / graduations /
  poolinitialize are small, kept in full.

`DOC_prompt.md` build spec is superseded (canonical wallet `0x2a58fb44…ed3`,
15-token watch list, terser answers).

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
/substreams  - LIVE data source: Substreams module + finch.proto + spkg
               (published: finch-substreams@v0.1.0 on substreams.dev)
/bot         - Telegram bot (@FinchRH_bot) + NLI backend + HTTP API
  src/db.ts        - pg pool + SQL helpers against Neon (the Substreams sink target)
  scripts/prune-neon.mjs - hourly Neon size guard (finch-prune.timer)
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
  support Robinhood Chain (`eip155:4663`). Data source is Substreams via
  `mainnet.robinhood.streamingfast.io:443` (thegraph.market token), sunk to Neon.
- **The box is openSUSE Leap 16.0** (`zypper`, not `dnf` — DOC_deploy.md is stale),
  t3.micro, ~935MB RAM with ~136MB free — which is why Postgres is Neon-managed,
  not on-box. Services: `finch-api`, `finch-bot`, `finch-sink`, `finch-prune.timer`.
- **Live data only** — the sink streams the Substreams endpoint live, not mocked
  or static data. The canonical demo tx is a hardcoded test fixture with locked
  answer wording, but that is a fixture, not a data-source substitute.

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
