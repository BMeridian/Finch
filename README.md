# Finch

**Finch snitches on where your tokens really came from.**

A Telegram bot (`@FinchRH_bot`) backed by a Substreams pipeline that indexes
[Pons](https://pons.fun) launchpad activity and wallet transfers on **Robinhood
Chain** (`eip155:4663`, RPC `https://rpc.mainnet.chain.robinhood.com`). Finch
answers natural-language questions about a wallet's activity and new token
launches — factual, read-only, no trading logic. The same query API is
registered as a metered [Bazantic](https://bazantic.com) gateway (x402/MPP);
Finch is a **peer**, not a gatekeeper — other agents call it directly, the
Telegram bot is just one consumer of the same backend.

Built for ETHOnline 2026, Uniswap Foundation track — hackathon feedback
submitted in [`FEEDBACK.md`](FEEDBACK.md).

## What Finch does

On Robinhood Chain, wallets receive tokenized stocks — NVDA, COST, GLD — they
never bought. Here's how it happens: someone launches a memecoin on Pons; it
graduates to a Uniswap V4 pool paired against a stock; the creator's fee cut,
paid in that stock, is redirected to a holder-fee distributor, which pays it
out to holders. A wallet just sees "+0.09 NVDA from 0xe25e…" — no block
explorer says which memecoin that came from, or why that wallet. Finch
reconstructs the route:

1. **Finds the transfer** — the most recent transfer of that token into the
   wallet, from the Substreams-indexed Postgres store.
2. **Resolves the payer** — if the sender is a contract, Finch reads it
   on-chain (`token()`, `quoteToken()`) and cross-checks it against the
   official `PonsHolderFeeManager` registry — it never infers what a contract
   does just because a getter returns a value.
3. **Confirms the path** — if `quoteToken()` matches the received asset, the
   route is confirmed: creator-fee cut → Pons `FeeEscrow` → distributor → an
   epoch batch that included the wallet. Finch reports the **route**, never a
   per-holder distribution rate, and never who else is in the batch (that
   selection is claim-gated and not on-chain-readable).

Every response carries `confidence: "signal only - not a recommendation"`.
Finch does no buy/sell signals, scoring, weighting, or ranking of any kind.

## Uniswap V4 integration — exact contracts and code

Robinhood Chain **Uniswap V4 `PoolManager`** (singleton):
`0x8366a39CC670B4001A1121B8F6A443A643e40951`

Pons's **Meme Hook** (the hook every Pons-graduated pool is initialized with):
`0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`

V4 has no per-pool contract to watch — every pool multiplexes through the one
`PoolManager`, so Finch decodes its `Initialize` event directly and filters to
pools using Pons's hook:

- **Substreams decode + hook filter**:
  [`substreams/src/lib.rs:99-110`](substreams/src/lib.rs#L99-L110) — matches
  `PoolManager.Initialize`, discards anything not using the Meme Hook, and
  records `currency0`/`currency1` (sorted by address, not "token vs. quote" —
  the launched-token side is derived by checking against a known pairing-asset
  set, not read directly off the event).
- **On-chain PoolManager reference check**:
  [`bot/src/distributor.ts:59`](bot/src/distributor.ts#L59) (`POOL_MANAGER`
  constant) and [`bot/src/distributor.ts:82`](bot/src/distributor.ts#L82) —
  reads a distributor's own logic bytecode and confirms it references the V4
  `PoolManager`, rather than trusting an interface match.
- **Route confirmation** (the actual payoff — chaining "which V4 pool" to "why
  did this wallet get paid"):
  [`bot/src/distributor.ts:135-176`](bot/src/distributor.ts#L135-L176)
  (`resolveDistributors`) — reads `token()` / `quoteToken()` on the payer, and
  cross-checks it against the official `PonsHolderFeeManager` registry on-chain
  (`distributorOf(token) == payer`,
  [`bot/src/distributor.ts:160`](bot/src/distributor.ts#L160)) rather than
  inferring anything from a getter alone.

## Why Substreams, not a subgraph

Robinhood Chain isn't on The Graph's Subgraph Studio network. A Goldsky-hosted
subgraph, or Goldsky-seeded data, does **not** satisfy a Graph-track
requirement — confirmed directly with The Graph's dev-rel. The eligible path,
and what Finch runs, is **pure Substreams consumed from a Graph provider**:
StreamingFast's Robinhood endpoint, authenticated with a
[thegraph.market](https://thegraph.market) Substreams token.

## Architecture

```
substreams/  --sink postgres-->  Postgres (Aiven)  <--query-- bot/src/db.ts
 (map_bot module,                                                  |
  StreamingFast endpoint)                     +----------------------------+
                                               |                            |
                                     Telegram bot (@FinchRH_bot)     HTTP API (/query /ens
                                     - button UI + typed commands     /health /calls /SKILL.md)
                                     - live agent-call feed                 |
                                                                   Bazantic x402/MPP gateway
                                                                   (metered, wraps /query, /ens)
                                                                             |
                                                                     MCP stdio server
```

Pons lifecycle indexed end to end: launch (`TokenLaunched`) → curve trading →
graduation (`LaunchSwept` / `GraduationTokensPermanentlyLocked` /
`PoolGraduated`) → the post-graduation Uniswap V4 pool behind the Meme Hook.
The fee settlement itself is inside Multicall3 batches (`aggregate3` /
`tryAggregate`), not top-level `Transfer` events — the Substreams module
decodes these directly.

The sink doesn't hold full chain history (1 GB free-tier Postgres) — it starts
~150k blocks back and prunes pool-swap/liquidity tables hourly, keeping
transfers to a rolling window. Live data only; there is no synthetic or mocked
dataset anywhere in this project.

**Deployed as a live, always-on service.** The Telegram bot and HTTP API run
as systemd-managed services on an AWS box, behind Caddy for TLS.

## Bazantic integration

Finch's HTTP API is registered as a Bazantic gateway (x402/MPP, metered on
Base). Any agent can discover and pay-per-call through Bazantic with no Finch
API key, or call the same endpoint directly. Finch also verifies its own
settlements on-chain (`GET /x402/verify?tx=…`), since Bazantic doesn't forward
payment details upstream. A published Bazantic **Recipe**
(`FINCH_GRAPH_ENS`) chains two of Finch's own paid tools — wallet provenance
→ ENS name resolution — as one LLM-orchestrated call.

## Repo structure

```
/substreams  - Substreams module + finch.proto (published finch-substreams@v0.1.1)
/bot         - Telegram bot + NLI backend + HTTP API (independent processes)
  src/index.ts     - Telegram bot (grammy) — button menu + typed commands
  src/http.ts      - HTTP API: /query /ens /health /calls /x402/verify /SKILL.md
  src/db.ts        - pg pool + sql() helper against the sink Postgres
  src/answer.ts    - answer() prose / answerJson() structured
  src/ens.ts       - reverse 0x -> .eth via The Graph's canonical ENS subgraph
  src/x402.ts      - reads Finch's own Bazantic settlements off Base
  src/bazrecipe.ts - runs the published Bazantic Recipe FINCH_GRAPH_ENS
  src/mcp.ts       - MCP stdio server
/bazantic    - gateway.json (x402/MPP config) + DOC_recipe.md
/recipes     - ens-enrich.mjs: standalone chained-MCP demo (no Bazantic)
SKILL.md     - machine-readable manifest, also served at /SKILL.md
DOC_build.md - current build state, changelog, run/deploy/demo commands
```

## Run

Requires Node 22.x. Copy `.env.example` to `.env` and fill in `DATABASE_URL`
(the Substreams sink's Postgres), `TELEGRAM_BOT_TOKEN`, `GRAPH_QUERY_KEY` (ENS
subgraph), and `SUBSTREAMS_API_TOKEN` if you're running the sink yourself.

```bash
cd bot && npm install
npm start          # Telegram bot (long-polling)
npm run serve      # HTTP API, port FINCH_HTTP_PORT (default 8787)
npm run mcp        # MCP stdio server
npx tsc --noEmit   # typecheck
```

See `DOC_build.md` for the full run/deploy/demo command reference, and
`bazantic/DOC_recipe.md` for the Bazantic gateway + Recipe setup.

## Limitations — stated honestly, not hidden

- Finch indexes transfers of a fixed 15-token watch list (see `/finchTop`); a
  payout in any other asset isn't seen.
- Why a specific wallet, and not another holder, is in an epoch's batch is
  off-chain and claim-gated — not derivable from indexed on-chain data.
- Recurrence counts are within Finch's indexed range only; earlier receipts
  may exist before it.
- A project funding payouts by buying the asset with its own treasury, with no
  pool ever pairing it against that asset, is invisible to this method.
- Non-Pons launchpads are not yet indexed.

## License

[GNU Affero General Public License v3.0](LICENSE).
