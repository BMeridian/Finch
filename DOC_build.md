# DOC_build.md — Finch build list (current state, for a Sonnet 5 session)

Supersedes `DOC_prompt.md` (that doc is the Phase-1 subgraph POC and is stale —
the pipeline pivoted off subgraphs entirely). Read `CLAUDE.md` first for the
architecture; this file is the task list and the "what's done / what's left".

Hackathon has three tracks. Finch targets all three:

| Track | What it needs | Status |
|---|---|---|
| The Graph / Substreams | Robinhood Chain data via **pure Substreams** consumed from a Graph provider (Goldsky does NOT qualify) | **DONE** |
| Bazantic x402 / MPP | a real x402 402 challenge + on-chain settlement | **DONE** |
| Bazantic Recipes | a published Recipe chaining gateway tools | **DONE** |

Everything is deployed and demo-ready on the AWS box. Remaining work is polish +
demo-hardening, listed at the bottom.

---

## 1. The Graph / Substreams track — DONE

- `substreams/` — module + `finch.proto`, published `finch-substreams@v0.1.1`
  on substreams.dev. Modules: `map_raw` (all events) and `map_bot` (drops
  `pool_swaps` / `pool_modify_liquidity`, which the bot never reads and which
  outran the DB on write volume).
- **Data source:** StreamingFast's Robinhood endpoint
  `mainnet.robinhood.streamingfast.io:443`, auth = a **thegraph.market**
  Substreams token (`SUBSTREAMS_API_TOKEN`, FREE tier, 5 parallel workers).
  Pinax's own free keys hit concurrent-stream quota walls — dead end.
- `substreams sink postgres` (relational mode, `map_bot`) → **Aiven** PostgreSQL
  free tier (1 GB, `DATABASE_URL`). Neon (512 MB) kept idle as
  `NEON_DATABASE_URL_FALLBACK`. Aiven uses a private CA → `bot/src/db.ts` strips
  `sslmode` from the URL and sets `ssl:{rejectUnauthorized:false}`.
- Box: `finch-sink.service` runs the sink `--start-block` near chain head (not
  full history — 1 GB is tight), `Restart=always`. `finch-prune.timer` hourly
  runs `bot/scripts/prune-neon.mjs`: TRUNCATE the two pool tables, vacuum
  `transfer`, keep `transfer` to `PRUNE_WINDOW_BLOCKS`.
- Bot / HTTP API / MCP all query the DB directly. `subgraph.ts` deleted;
  `query.ts` / `freshness.ts` / `candidates.ts` / `format.ts` / `serialize.ts` /
  `ens.ts` are GraphQL→SQL rewrites.
- ENS: `bot/src/ens.ts` `resolveEns()` hits **The Graph's canonical ENS
  subgraph** (mainnet, gateway key `GRAPH_QUERY_KEY`) — this is a second, real
  Graph-network dependency, surfaced as `/ens` and in `/traceENS`.

Demo wallets in range: `0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0`,
`0x36de68e810781dd7699d8fc7fe7def8aae51cec2` (= `daio.eth`). The canonical
fixture `0x2a58fb44…ed3` is out of the sink's block window.

## 2. Bazantic x402 / MPP track — DONE

- Gateway registered + published (slug in `DOC_box.local.md`,
  `<slug>.bazgateway.com`). Wraps `bot/src/http.ts`.
- `/query` and `/ens` priced at **1 MCENT = $0.00001** each — a nonzero amount
  is what engages the x402 v2 challenge (0 = free passthrough). `/health` +
  `/SKILL.md` free. A bare `/query` with no params is a 200 probe; a real param
  returns `402` with an x402 v2 / scheme `exact` / network `eip155:8453` (Base)
  / asset USDC `0x833589fC…` / `payTo 0xDE05E390e48c7a88B22dFE6B0005F70164F262aF`.
- Settlement verified end to end: `baz grant create --name finch` off the
  Bazantic hosted balance, then `baz curl` → real $0.00001 USDC transfer on Base
  (e.g. tx `0x58ccefd2…`). `bazDemo.sh` runs the whole flow
  (`BAZ_ACCOUNT=finch2 ./bazDemo.sh`).
- **Finch verifies its own settlement** — Bazantic doesn't forward payment
  details upstream, so `bot/src/x402.ts` reads the tx off Base
  (`verifyPayment`, `settlementsSince`, `latestSettlement`), exposed as
  `/x402/verify?tx=0x…`. The Telegram `/seeAgentFull` feed annotates paid calls
  with `💸 $0.00001 x402 · tx 0x…` (amount bold + shortened hash), consuming
  settlements in block order off a persisted cursor.

## 3. Bazantic Recipes track — DONE

- Recipe **`FINCH_GRAPH_ENS`** published — `api.bazantic.com/v1/recipes/finch-graph-ens`.
  An LLM workflow (claude-haiku-4.5) that chains two of Finch's own paid gateway
  tools: `finchQuery` (Substreams provenance) → `ensResolve` (The Graph ENS
  subgraph). Inputs: `Wallet` (required), `Symbol` (optional, default NVDA).
  Prompt is verbatim in `bazantic/DOC_recipe.md`.
- Called from Telegram via **`/bazRep`** — guided flow (prompts Wallet, then
  Symbol) or one-liner `/bazRep 0x… NVDA`. Implementation:
  `bot/src/bazrecipe.ts` (`runFinchGraphEns` — MCP `initialize` on
  `api.bazantic.com/mcp` → `_meta` gateway_mcp_url → `tools/call`, with retry
  for the gateway's flaky upstream timeout) + guided state machine in
  `bot/src/index.ts` (`getBazrep`/`setBazrep` in `session.ts`).
- `tidy()` in `bazrecipe.ts` strips the recipe LLM's chatter (a "Perfect!…"
  preamble, a trailing confidence / "Important note" paragraph). The recipe
  prompt was also edited to stop emitting the confidence paragraph. The
  `Summary:` / `Route details:` section layout is KEPT — that's the wanted
  format.
- The recipe's internal `finchQuery` hop shows as caller `::1` — filtered out of
  the `/seeAgentFull` feed so a `/bazRep` run doesn't dump raw JSON.

---

## Run / deploy / demo

```bash
# local dev
cd bot && npm start        # Telegram bot
cd bot && npm run serve    # HTTP API (port FINCH_HTTP_PORT, default 8787)
cd bot && npm run mcp      # MCP stdio server
cd bot && npx tsc --noEmit # typecheck (box has no tsc — check locally only)

# box (access + paths in DOC_box.local.md — gitignored)
KEY=<AmznWillow.pem>  BOX=ec2-user@16.171.61.0
rsync -az -e "ssh -i $KEY" bot/src/<file> "$BOX":/home/ec2-user/_Finch/bot/src/
ssh -i "$KEY" "$BOX" 'sudo systemctl restart finch-bot finch-api'
# services: finch-api  finch-bot  finch-sink  finch-prune.timer
# box is openSUSE Leap 16.0 (zypper, not dnf); Postgres is off-box (Aiven)

# x402 demo
BAZ_ACCOUNT=finch2 ./bazDemo.sh

# standalone chained-MCP demo (no Bazantic)
node recipes/ens-enrich.mjs   # wallet 0x36de68e8… → daio.eth
```

Telegram: `@FinchRH_bot`. Public URL `https://16-171-61-0.sslip.io` (Caddy →
:8787). Health: `/health` should show `fresh: true` (threshold is 600s of lag —
Aiven write throughput leaves a persistent ~3–4k block offset).

## Changelog — what changed / was added since the subgraph pivot

Ordered by area. Commit `ca5871f` ("deploy + demo tooling") is roughly the last
subgraph-era commit; everything below is the pivot and after.

### Pipeline: subgraph → pure Substreams
- `62669d9` query layer moved from subgraph GraphQL to SQL against a
  Substreams-sink Postgres. `bot/src/subgraph.ts` deleted;
  `query.ts` / `freshness.ts` / `candidates.ts` / `format.ts` / `serialize.ts` /
  `ens.ts` rewritten GraphQL→SQL against `bot/src/db.ts` (`pg` pool + `sql()`).
- `05188a5` `deploy/finch-sink.service` + `substreams/DOC_substreams.md`
  (sink runbook — note: do NOT truncate the `_sink_info_` meta tables, drop them).
- `009619b` → `5d714f3` brief two-source phase (Substreams sink + a Goldsky
  seed for history) then **Goldsky dropped entirely** — dev-rel confirmed
  Goldsky-seeded data does not qualify for the Graph track. Sink is now pure
  Substreams via the thegraph.market token.
- `1c3f77b` / `5d714f3` endpoint: Pinax free keys hit concurrent-stream walls →
  switched to **StreamingFast's Robinhood endpoint** with a thegraph.market
  Substreams token.
- `1d44072` **`map_bot`** Substreams module (v0.1.1) — drops `pool_swaps` /
  `pool_modify_liquidity` at the source (the bot never reads them and their
  write volume outran the DB). Published `finch-substreams@v0.1.1`.
- `d38c899` `db.ts` — strip `sslmode` from the URL, `ssl:{rejectUnauthorized:false}`
  for managed PG private CAs; sink `--start-block` near chain head.

### Database: Neon → Aiven
- Neon (512 MB) blew its size limit (Uniswap V4 swap volume). Migrated to
  **Aiven** free tier (1 GB, `DATABASE_URL`). Neon kept idle as
  `NEON_DATABASE_URL_FALLBACK`.
- `7bc4fbd` / `87dbf72` / `1e7eed5` **prune job** — `bot/scripts/prune-neon.mjs`
  + `deploy/finch-prune.{service,timer}` (hourly): TRUNCATE the two pool tables,
  `vacuum transfer`, keep `transfer` to `PRUNE_WINDOW_BLOCKS` (box: 120k).
- `c11fd2f` `/health` `fresh` threshold loosened to 600s — Aiven write
  throughput leaves a persistent ~3–4k block offset.

### x402 / MPP (new)
- `95eab28` x402 402 challenge went live — a nonzero price (1 MCENT) is what
  engages it; `0` = free passthrough.
- `590f255` `bazantic/gateway.json` pricing reflects the live 1 MCENT config.
- `828c471` / `d538d47` settlement verified — `baz grant create --name finch`
  off the Bazantic hosted balance; `bazDemo.sh` gained `BAZ_ACCOUNT`.
- `b961d94` **`bot/src/x402.ts`** + `/x402/verify?tx=0x…` — Finch reads its own
  settlement off Base (Bazantic doesn't forward payment details upstream).
- `5990e54` / `aad1c1f` `/seeAgentFull` feed annotates paid calls with the x402
  settlement (amount bold + short tx hash), consuming settlements in block order
  off a persisted cursor (fixes back-to-back calls showing the same tx).
- `f88397b` `bazDemo.sh` verify step hits Finch directly, not the gateway.

### Bazantic Recipes (new)
- `cc046cb` **`GET /ens`** — reverse-resolve 0x → .eth via The Graph's canonical
  ENS subgraph (`bot/src/ens.ts` `resolveEns`); added to `openapi.json` as
  `ensResolve`.
- `60841f4` Recipe **`FINCH_GRAPH_ENS`** published + a new gateway slug (re-`add`
  creates a new slug, doesn't update in place) + real pricing on `/query`+`/ens`.
- `faf1949` → `302a1c4` **`/bazRep`** Telegram command — `bot/src/bazrecipe.ts`
  (`runFinchGraphEns` via `api.bazantic.com/mcp` → recipe-mcp gateway, with
  retry) + guided Wallet→Symbol state machine (`getBazrep`/`setBazrep` in
  `session.ts`).
- `c6b7600` recipe's internal `finchQuery` hop (caller `::1`) filtered out of
  the feed.
- `58df8fb` / `9a7244f` / `18a9a55` `tidy()` — strips the recipe LLM's "Perfect!…"
  preamble and trailing confidence / "Important note" paragraph; the recipe
  prompt itself was edited to stop emitting the confidence paragraph. The
  `Summary:` / `Route details:` layout is deliberately KEPT.

### Telegram / agent-facing copy
- `9190f5a` command menu; `8b4d872` / `e3dde2a` live `/seeAgent` feed.
- `246bd96` / `7269879` payer cross-checked on-chain against
  `PonsHolderFeeManager`; name the creator-fee route.
- `4dfc424` / `18a6e9b` / `3ead71f` report the fee-distribution *path*, not a
  per-holder rate; show + bold when a payout landed.
- `8bd1eb4` / `28e6c85` `/trace` + `/traceENS` commands; ENS enrichment
  drill-down.
- `1e342ef` / `90375a6` all "subgraph" / "Pinax" wording → "index" /
  "StreamingFast" across `/forAgents`, `/health`, `mcp.ts`, `SKILL.md`,
  `openapi.json`.
- `cd33084`…`8b61787` `/start` + `/forAgents` layout: `/bazRep` in its own
  `BAZANTIC RECIPE` section and under gateway section 3; assorted whitespace /
  ellipsis / wording trims.

## Remaining work — polish only

- [ ] Recipe run billing: `paid: null` at the recipe-mcp layer (public MCP
      endpoint, no caller auth) — currently free or billed to the author. Check
      Bazantic Balances; decide if the recipe path needs metering for the demo.
- [ ] `/bazRep` takes ~40s (LLM + 2 tool calls) — cut the dead time in the demo
      video edit.
- [ ] `deploy/DOC_deploy.md` still says Amazon Linux / `dnf` — stale, box is
      openSUSE. (`deploy/DOC_fresh_live.md` is current.)
- [ ] `/health` route price in the Bazantic dashboard — confirm it's `0` so
      uptime probes stay free.
- [ ] `DOC_prompt.md` — mark superseded or delete (kept for now as history).
- [ ] `substreams/finch-substreams-v0.1.0.spkg` — old package still in the tree,
      can be removed (live is `v0.1.1`).
