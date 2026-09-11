# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

`DOC_build.md` is the current build list + changelog + run/deploy/demo commands —
**read it first.** Summary: all three hackathon tracks (The Graph / Substreams,
Bazantic x402/MPP, Bazantic Recipes) are done and deployed on the AWS box.

**Pivoted off subgraphs.** The Graph dev-rel confirmed a Goldsky-hosted subgraph
does NOT satisfy the track, and neither does Goldsky-seeded data ("we will not
recognize Goldsky Subgraphs"). Robinhood Chain (`eip155:4663`) is not on The
Graph's network or Studio. The eligible path — and what Finch runs — is **pure
Substreams consumed from a Graph provider**.

**Live architecture: Substreams → Postgres → bot.**
- `substreams/` — module + `finch.proto`, published `finch-substreams@v0.1.1`
  on substreams.dev. Sink runs the **`map_bot`** module (= `map_raw` minus
  `pool_swaps` / `pool_modify_liquidity`, which the bot never reads and whose
  write volume outran the DB). `substreams/DOC_substreams.md` is the sink runbook.
- **Data source: StreamingFast's Robinhood endpoint**
  (`mainnet.robinhood.streamingfast.io:443`), auth = a **thegraph.market**
  Substreams token (`SUBSTREAMS_API_TOKEN`, free tier, 5 parallel workers).
  Pinax's own free keys hit concurrent-stream quota walls — dead end.
- `substreams sink postgres` (relational mode, schema built from the proto — no
  `db_out`, no schema.sql, no Rust) → **Aiven** PostgreSQL free tier (1 GB,
  `DATABASE_URL`). Neon (512 MB) kept idle as `NEON_DATABASE_URL_FALLBACK`.
- `bot/src/db.ts` (`pg`) queries the DB directly. Managed PG uses a private CA,
  so `db.ts` strips `sslmode` from the URL and sets `ssl:{rejectUnauthorized:false}`
  (still TLS). `bot/src/subgraph.ts` is deleted; `query.ts` / `freshness.ts` /
  `candidates.ts` / `format.ts` / `serialize.ts` / `ens.ts` are GraphQL→SQL rewrites.
- Box: `finch-sink.service` (`--start-block` near chain head, no stop block,
  `Restart=always`).

**1 GB is tight for this chain**, so the sink does NOT hold full history:
- `finch-sink.service` starts ~150k blocks back (last ~1–2 days). The canonical
  fixture wallet `0x2a58fb44…ed3` is out of range — demo with `0x2408ce75…` /
  `0x36de68e8…` (= `daio.eth`). Full history needs a paid tier or a bigger box.
- `finch-prune.timer` (hourly) runs `bot/scripts/prune-neon.mjs`: TRUNCATE
  `poolswap` / `poolmodifyliquidity`, `vacuum transfer`, keep `transfer` to
  `PRUNE_WINDOW_BLOCKS` (box sets **120k**). Launches / graduations /
  poolinitialize are small, kept in full.

`DOC_prompt.md` (Phase-1 subgraph POC) is fully superseded — ignore it.

## What Finch is

A Telegram bot (`@FinchRH_bot`) backed by a Substreams pipeline that indexes Pons
launchpad activity and wallet transfers on Robinhood Chain (chain ID 4663, RPC
`https://rpc.mainnet.chain.robinhood.com`, explorer
`robinhoodchain.blockscout.com`). It answers natural-language questions about a
wallet's activity and new token launches. The query API is also registered
standalone in Bazantic; Finch is one consumer of it, not a proxy other agents
call through.

## Structure

```
/substreams  - LIVE data source: Substreams module + finch.proto + spkg
               (published: finch-substreams@v0.1.1). map_bot is the sunk module.
/bot         - Telegram bot + NLI backend + HTTP API (independent processes)
  src/index.ts     - Telegram bot (grammy); /start /trace /traceENS /bazRep /seeAgent …
  src/http.ts      - HTTP API (the endpoint Bazantic wraps): /query /ens /health /calls /x402/verify /SKILL.md
  src/db.ts        - pg pool + sql() helper against the sink DB (Aiven/Neon)
  src/answer.ts    - answer() prose / answerJson() structured — shared extract+query
  src/query.ts / candidates.ts / format.ts / serialize.ts - SQL query + response shaping
  src/ens.ts       - reverse 0x -> .eth via The Graph's canonical ENS subgraph
  src/x402.ts      - reads Finch's own Bazantic settlement off Base
  src/bazrecipe.ts - runs the published Bazantic Recipe FINCH_GRAPH_ENS (/bazRep)
  src/freshness.ts - index head vs chain head staleness check (/health)
  src/calllog.ts   - every gateway/agent call logged (in-memory ring + .calls.jsonl)
  src/mcp.ts       - MCP stdio server (finch_wallet_provenance / _pons_activity / _health)
  scripts/prune-neon.mjs - hourly DB size guard (finch-prune.timer)
/bazantic    - gateway.json (x402/MPP config) + DOC_recipe.md (recipe + x402 flow)
/recipes     - ens-enrich.mjs: standalone chained-MCP demo (no Bazantic)
SKILL.md     - machine-readable manifest, also served at /SKILL.md
DOC_build.md - current build state, changelog, run/deploy/demo commands
```

Run: `cd bot && npm start` (Telegram), `npm run serve` (HTTP API, port
`FINCH_HTTP_PORT`, default 8787), `npm run mcp` (MCP). Deploy = rsync to the box +
`sudo systemctl restart` — see `DOC_build.md`. The box has no `tsc`; run
`npx tsc --noEmit` locally before deploying.

## Architecture notes that span multiple files

- **Index the full Pons lifecycle**, not just launch+swap: launch
  (`TokenLaunched`) → curve trading → graduation (`LaunchSwept` /
  `GraduationTokensPermanentlyLocked` / `PoolGraduated`) → post-graduation
  Uniswap V4 pool behind the Meme Hook. `graduated` is a first-class field the
  NLI layer depends on.
- **The fee settlement is inside Multicall3 batches** (`aggregate3` /
  `tryAggregate`), not top-level `Transfer` events — one multicall tx pays many
  tokens to many recipients. The Substreams module decodes these.
- **Verify the payer on-chain, don't infer from getters.** `token()` /
  `quoteToken()` returning a value is not proof of what the contract does —
  cross-check the payer against `PonsHolderFeeManager.distributorOf(T)`. If
  `quoteToken()` doesn't match the received asset, Finch says "not confirmed"
  and returns correlational candidates, never a ranked cause.
- **Provenance = the path a token took**, never a per-holder distribution rate.
  Epoch-batch membership is claim-gated and not on-chain-readable — Finch
  confirms the route, not why this wallet is in a given batch.
- **Two-layer NLI responses**: a normalization layer maps known address
  categories (FeeEscrow, claim contract, factory, user's own wallet) to plain
  labels before the LLM formats. The default answer never shows a bare hex
  address; the technical trace is drill-down only.
- **`Launchpad` is generalized on purpose** — don't hardcode "Pons". Pons is the
  primary worked example.
- **Token watch list** — 15 tokens
  (NVDA/AAPL/TSLA/AMZN/SPCX/cbBTC/GLD/SPY/QQQ/DJT/GME/RDDT/GOOGL/RBLX/HOOD),
  kept in sync in **two** live places: `substreams/substreams.yaml`
  (`params` `tokens=` / `pairing=`) and `bot/src/tokens.ts`. WETH + USDG are
  pool pairing assets, not watched for Transfers (`pairing=`). A watch-list
  change needs a `substreams.yaml` edit + re-publish + sink restart.
- **Verify before hardcoding addresses.** Only the Pons V2 factory, Meme Hook,
  and V1 legacy factory are independently verified. Check every other address
  (PoolManager, PositionManager, FeeEscrow, stock tokens) on Blockscout first.
- **The box is openSUSE Leap 16.0** (`zypper`, not `dnf` — `deploy/DOC_deploy.md`
  is stale, `deploy/DOC_fresh_live.md` is current), t3.micro, ~136 MB free RAM —
  which is why Postgres is a managed service, not on-box. Services: `finch-api`,
  `finch-bot`, `finch-sink`, `finch-prune.timer`.
- **Live data only** — the sink streams the endpoint live. The canonical demo tx
  is a hardcoded test fixture with locked answer wording; that's a fixture, not a
  data-source substitute.

## Hard constraints

- **No trading logic anywhere**: no buy/sell signals, scoring, weighting,
  ranking, or "should I buy" logic. Strictly data indexing and factual
  retrieval. Every response carries `confidence: "signal only - not a
  recommendation"`.
- Do not go further on parent-token attribution than the completed trace — full
  lineage resolution is out of scope.
- Do not `git commit` / `push` until explicitly told to. Keep commit history
  incremental (judges flag single-commit dumps).

## Code style

- Compact: fit logic on one line where reasonable; align `=` and `return` in
  adjacent lines.
- Python: no `from typing import ...` imports at all. Check what stdlib/packages
  are already installed before assuming.
- Leave commented-out code in place when rewriting; don't delete it.
- Prefix any new markdown file with `DOC_`.
- If a requirement is ambiguous, state the assumption and proceed.
